/* =========================================================
   CAPA DE NEGOCIO · Avisos automáticos de vencimiento (HU-14).

   Una vez al día (desde la hora configurada) busca las alertas de vencimiento
   que ya tocan (60/30/15/7 días antes, según config_alertas) y:
     1. envía al cliente un correo con el contrato que vence;
     2. marca esas alertas como enviadas por correo;
     3. envía a cada ejecutivo (o a los administradores, si el contrato no tiene
        ejecutivo) un resumen con lo avisado y los clientes sin correo, para llamarlos.
   Cada ejecución queda en ejecuciones_avisos. El personal también puede lanzarlo
   a mano desde Renovaciones.
   ========================================================= */
const config = require('../../config');
const { conSistema, conUsuario } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const correo = require('../../datos/correo');
const portalRepo = require('../../datos/repositorios/portal.repositorio');
const avisosRepo = require('../../datos/repositorios/avisos.repositorio');
const { esc, boton, cuerpo, titulo, pie, fechaCl } = require('../../comun/correos');

const REVISAR_CADA_MS = 15 * 60 * 1000;
let corriendo = false;
let reloj = null;

const plazo = (dias) => (dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`);

function correoCliente(c) {
  const renov = c.renovacion_automatica
    ? 'Su contrato tiene renovación automática: si no nos indica lo contrario, se renovará por el mismo período.'
    : 'Si desea continuar con el servicio, responda a su ejecutivo o renueve desde nuestra tienda en línea.';
  return {
    asunto: `Su contrato ${c.folio} vence ${plazo(c.dias)}`,
    texto: `Su contrato ${c.folio} (${c.servicios || 'servicios de Easy Office'}) vence el ${fechaCl(c.vence)}. ${renov}`,
    html: cuerpo(`${titulo('Aviso de vencimiento')}
      <p>Estimado(a) <b>${esc(c.cliente)}</b>:</p>
      <p>Le recordamos que su contrato <b>${esc(c.folio)}</b> vence el <b>${fechaCl(c.vence)}</b> (${plazo(c.dias)}).</p>
      <p style="background:#F4F6F7;padding:10px 14px;border-left:3px solid #24D356;">${esc(c.servicios || 'Servicios de Easy Office')}</p>
      <p>${esc(renov)}</p>
      ${boton(`${config.appUrl}/mi-cuenta`, 'Ver mi contrato')}${pie}`)
  };
}

function correoResumen(lista) {
  const fila = (x) => `<tr><td style="padding:4px 8px;">${esc(x.folio)}</td><td style="padding:4px 8px;">${esc(x.cliente)}</td>
    <td style="padding:4px 8px;">${fechaCl(x.vence)}</td><td style="padding:4px 8px;">${esc(x.resultado)}</td></tr>`;
  const sin = lista.filter((x) => x.estado !== 'enviado').length;
  return {
    asunto: `Avisos de vencimiento: ${lista.length} contrato(s)${sin ? `, ${sin} para llamar` : ''}`,
    texto: lista.map((x) => `${x.folio} · ${x.cliente} · vence ${fechaCl(x.vence)} · ${x.resultado}`).join('\n'),
    html: cuerpo(`${titulo('Avisos de vencimiento de hoy')}
      <p>Estos contratos de su cartera llegaron a su fecha de aviso.${sin ? ' Los marcados "sin correo" o con error necesitan un llamado.' : ''}</p>
      <table style="border-collapse:collapse;font-size:13px;"><tr style="background:#F4F6F7;"><th style="padding:4px 8px;text-align:left;">Folio</th>
        <th style="padding:4px 8px;text-align:left;">Cliente</th><th style="padding:4px 8px;text-align:left;">Vence</th><th style="padding:4px 8px;text-align:left;">Aviso</th></tr>
        ${lista.map(fila).join('')}</table>
      ${boton(`${config.appUrl}/crm#renovaciones`, 'Abrir Renovaciones')}${pie}`)
  };
}

/** Envía los avisos pendientes. origen: 'automatico' | 'manual' (usuarioId obligatorio en manual). */
async function ejecutar({ origen = 'automatico', usuarioId = null } = {}) {
  if (corriendo) throw errores.conflicto('Ya se están enviando los avisos. Intente en un minuto.');
  corriendo = true;
  try {
    const iniciado = new Date();
    const pendientes = await conSistema((db) => avisosRepo.pendientes(db));
    const detalle = [];
    let correos = 0;

    for (const c of pendientes) {
      const destinos = await portalRepo.contactos(c.cliente_id);
      const fila = { folio: c.folio, cliente: c.cliente, vence: c.vence, ejecutivo_email: c.ejecutivo_email };
      if (!destinos.length) {
        detalle.push({ ...fila, estado: 'sin_correo', resultado: 'Sin correo: llamar al cliente' });
        continue;
      }
      try {
        const m = correoCliente(c);
        for (const para of destinos) await correo.enviar({ para, ...m });
        correos += destinos.length;
        await conSistema((db) => avisosRepo.marcarEnviadas(db, c.alertas));
        detalle.push({ ...fila, estado: 'enviado', resultado: `Enviado a ${destinos.join(', ')}` });
      } catch (err) {
        console.warn('[avisos] no se pudo avisar el contrato', c.folio, err.message);
        detalle.push({ ...fila, estado: 'error', resultado: 'Error al enviar: reintentará en el próximo envío' });
      }
    }

    // Resumen para el personal: cada ejecutivo recibe lo suyo; lo que no tiene ejecutivo va a los administradores
    if (detalle.length) {
      const admins = await conSistema((db) => avisosRepo.correosAdministradores(db, config.rolesAdmin));
      const porDestino = new Map();
      for (const d of detalle) {
        for (const para of d.ejecutivo_email ? [d.ejecutivo_email] : admins) {
          if (!porDestino.has(para)) porDestino.set(para, []);
          porDestino.get(para).push(d);
        }
      }
      for (const [para, lista] of porDestino) {
        try { await correo.enviar({ para, ...correoResumen(lista) }); } catch (err) { console.warn('[avisos] resumen a', para, err.message); }
      }
    }

    const resumen = {
      origen, usuarioId, iniciado, contratos: detalle.filter((d) => d.estado === 'enviado').length, correos,
      sinCorreo: detalle.filter((d) => d.estado === 'sin_correo').length,
      errores: detalle.filter((d) => d.estado === 'error').length,
      detalle: detalle.map(({ ejecutivo_email, ...d }) => d)   // eslint-disable-line no-unused-vars
    };
    resumen.id = await conSistema((db) => avisosRepo.registrar(db, resumen));
    if (detalle.length) console.log(`[avisos] ${resumen.contratos} contrato(s) avisado(s), ${resumen.sinCorreo} sin correo, ${resumen.errores} con error.`);
    return resumen;
  } finally {
    corriendo = false;
  }
}

/* ---------- Casos de uso del CRM (solo administradores) ---------- */
async function enviarAhora(usuario) {
  if (!usuario.admin) throw errores.sinPermiso('Solo un administrador puede enviar los avisos.');
  const r = await ejecutar({ origen: 'manual', usuarioId: usuario.id });
  return { contratos: r.contratos, correos: r.correos, sin_correo: r.sinCorreo, errores: r.errores, detalle: r.detalle };
}

async function historial(usuario) {
  if (!usuario.admin) throw errores.sinPermiso();
  return conUsuario(usuario, async (db) => ({
    automatico: config.avisos.activo, hora: config.avisos.hora,
    pendientes: (await avisosRepo.pendientes(db)).length,
    ejecuciones: await avisosRepo.ultimas(db, 15, config.bd.zonaHoraria)
  }));
}

/* ---------- Programación diaria ---------- */
const horaChile = () => Number(new Intl.DateTimeFormat('es-CL', { timeZone: config.bd.zonaHoraria, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));

async function revisar() {
  try {
    if (horaChile() < config.avisos.hora) return;
    if (await conSistema((db) => avisosRepo.ejecutadoHoy(db, config.bd.zonaHoraria))) return;
    await ejecutar({ origen: 'automatico' });
  } catch (err) {
    console.warn('[avisos] el envío automático falló:', err.message);
  }
}

function iniciar() {
  if (!config.avisos.activo || reloj) return;
  setTimeout(revisar, 20 * 1000).unref();
  reloj = setInterval(revisar, REVISAR_CADA_MS);
  reloj.unref();
  console.log(`Avisos de vencimiento automáticos: todos los días desde las ${config.avisos.hora}:00.`);
}

function detener() {
  if (reloj) clearInterval(reloj);
  reloj = null;
}

module.exports = { ejecutar, enviarAhora, historial, iniciar, detener };
