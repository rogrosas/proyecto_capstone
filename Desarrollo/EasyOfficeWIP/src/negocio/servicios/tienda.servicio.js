/* =========================================================
   CAPA DE NEGOCIO · Compra en la tienda (/contratar).

   Al comprar un plan:
     1. Cliente: si el RUT ya existe se usa (el correo debe estar vinculado a él);
        si no, se crea con origen 'web' (persona natural o empresa con su representante).
     2. Contrato 'pendiente' con el servicio del plan (servicios.codigo = id del plan;
        si el plan aún no tiene servicio en la base, se crea desde el catálogo).
     3. Pago 'pendiente': el cobro en línea es de demostración, lo confirma el personal.
     4. Documentos: cada plantilla vinculada al plan se genera con los datos del cliente
        y las respuestas del comprador. Con entrega automática queda publicada para que
        el cliente la revise; con revisión, espera al personal.
     5. Si el comprador aún no tiene contraseña del portal, se le envía el enlace para crearla.
   ========================================================= */
const config = require('../../config');
const { conSistema } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const archivos = require('../../datos/archivos');
const word = require('../../datos/word');
const catalogoRepo = require('../../datos/repositorios/catalogo.repositorio');
const tiendaRepo = require('../../datos/repositorios/tienda.repositorio');
const contratosRepo = require('../../datos/repositorios/contratos.repositorio');
const pagosRepo = require('../../datos/repositorios/pagos.repositorio');
const plantillasRepo = require('../../datos/repositorios/plantillas.repositorio');
const documentosRepo = require('../../datos/repositorios/documentos.repositorio');
const portalRepo = require('../../datos/repositorios/portal.repositorio');
const direccionesRepo = require('../../datos/repositorios/direcciones.repositorio');
const archivosServicio = require('./archivos.servicio');
const entregaServicio = require('./entrega.servicio');
const portalServicio = require('./portal.servicio');
const campos = require('../camposDocumento');
const v = require('../validacion');

const DURACION = { anual: 12, semestral: 6 };          // otros planes: 12 meses
const CICLO = { anual: 'ANUAL', semestral: 'SEMESTRAL', mensual: 'MENSUAL' };
const PASARELA = { tbk: 'transbank', mp: 'mercado_pago' };
const REGION = { metropolitana: 'Metropolitana', valparaiso: 'Valparaíso' };

/* ---------- límite de compras por IP ---------- */
const compras = new Map(); // ip -> { n, desde }
function excedido(ip) {
  const ahora = Date.now();
  const r = compras.get(ip);
  if (!r || ahora - r.desde > config.cliente.ventanaMs) { compras.set(ip, { n: 1, desde: ahora }); return false; }
  return ++r.n > 10;
}

function planDeTienda(codigo) {
  const plan = catalogoRepo.plan(String(codigo || ''));
  if (!plan) throw errores.solicitudInvalida('El plan elegido no existe.');
  return plan;
}

// Preguntas que el comprador responde para completar los documentos del plan
async function preguntas(codigo) {
  const plan = planDeTienda(codigo);
  const plantillas = await conSistema((db) => plantillasRepo.porPlan(db, plan.id));
  const vistas = new Map();
  for (const p of plantillas) {
    try {
      const marcas = word.marcas(await archivos.leer(p.archivo_base));
      campos.preguntas(marcas, p.mapa_campos, '_tienda').forEach((q) => vistas.has(q.marca) || vistas.set(q.marca, q));
    } catch (err) {
      console.warn(`[tienda] plantilla ${p.id} sin archivo legible:`, err.message);
    }
  }
  return {
    plan: { codigo: plan.id, nombre: plan.name, familia: plan.fam },
    documentos: plantillas.map((p) => p.tipo_documento),
    preguntas: [...vistas.values()].map(({ marca, etiqueta }) => ({ marca, etiqueta }))
  };
}

function leerCompra(d = {}) {
  const plan = planDeTienda(d.plan);
  const tipo = v.opcion(d.tipo, ['persona', 'empresa', 'nueva'], 'Tipo de contratación');
  const t = d.titular || {};
  const titular = {
    nombre: v.texto(t.nombre, 'Nombre completo', { max: 150 }),
    rut: v.rut(t.rut, 'RUT del titular'),
    email: v.email(t.email, 'Correo', { opcional: false }),
    celular: v.celular(t.celular)
  };
  const e = d.empresa || {};
  const empresa = tipo === 'empresa' ? {
    rut: v.rut(e.rut, 'RUT de la empresa'),
    razon_social: v.texto(e.razon_social, 'Razón social', { max: 200 }),
    giro: v.texto(e.giro, 'Giro', { opcional: true, max: 200 })
  } : null;
  if (empresa && empresa.rut === titular.rut) throw errores.solicitudInvalida('El RUT de la empresa debe ser distinto del RUT del titular.');
  // Domicilio del titular (persona) o del representante legal (empresa): lo pide la comparecencia del contrato
  const dir = d.direccion || {};
  const direccion = {
    calle: v.texto(dir.calle, 'Calle del domicilio', { max: 150 }),
    numero: v.texto(dir.numero, 'Número del domicilio', { max: 20 }),
    complemento: v.texto(dir.complemento, 'Depto u oficina', { opcional: true, max: 60 }),
    comuna_id: v.id(dir.comuna_id, 'Comuna del domicilio')
  };
  return {
    plan, tipo, titular, empresa, direccion,
    nombre_empresa_nueva: tipo === 'nueva' ? v.texto(e.razon_social, 'Nombre que desea para su empresa', { opcional: true, max: 200 }) : null,
    region: v.opcion(d.region, Object.keys(REGION), 'Región', { opcional: true }) || 'metropolitana',
    modo: v.opcion(d.pago?.modo || 'total', ['total', 'split', 'susc'], 'Modalidad de pago'),
    medio: v.opcion(d.pago?.medio || 'tbk', Object.keys(PASARELA), 'Medio de pago'),
    respuestas: archivosServicio.leerRespuestas(d.respuestas)
  };
}

async function comprar(datos, ip) {
  if (excedido(ip)) throw errores.demasiadosIntentos('Demasiadas compras seguidas desde esta conexión. Espere unos minutos.');
  const c = leerCompra(datos);
  const { plan } = c;
  if (plan.price === null) {
    return { cotizacion: true, mensaje: 'Este servicio se cotiza: un ejecutivo lo contactará para agendar la asesoría.' };
  }
  const tipoCliente = c.empresa ? 'juridica' : 'natural';
  const rutCliente = c.empresa ? c.empresa.rut : c.titular.rut;
  const monto = c.modo === 'split' ? Math.round(plan.price / 2) : plan.price;

  const r = await conSistema(async (db) => {
    // 1. Servicio del plan
    const servicio = await tiendaRepo.servicioDePlan(db, plan.id) || await tiendaRepo.crearServicioDePlan(db, {
      codigo: plan.id, nombre: `${plan.fam} · ${plan.name}`.toLocaleUpperCase('es-CL').slice(0, 150),
      precio_lista: plan.price, ciclo: CICLO[plan.recur] || 'UNICO', descripcion: (plan.detalle || plan.feats || []).join('\n')
    });

    // 2. Cliente
    let cliente = await tiendaRepo.clientePorRut(db, rutCliente);
    if (cliente) {
      const vinculado = [cliente.email, cliente.rep_email].filter(Boolean).map((x) => x.toLowerCase()).includes(c.titular.email)
        || (await portalRepo.contactos(cliente.id)).includes(c.titular.email);
      if (!vinculado) {
        throw errores.conflicto('Ese RUT ya es cliente de Easy Office con otro correo. Use el correo registrado o escríbanos a info@easyoffice.cl.');
      }
    } else {
      const direccionId = await direccionesRepo.obtenerOCrear(db, c.direccion);
      const repId = c.empresa ? await tiendaRepo.representante(db, {
        rut: c.titular.rut, nombre_completo: c.titular.nombre, email: c.titular.email, direccion_id: direccionId
      }) : null;
      const id = await tiendaRepo.crearCliente(db, {
        rut: rutCliente, tipo_persona: tipoCliente,
        razon_social: c.empresa ? c.empresa.razon_social : c.titular.nombre,
        giro_principal: c.empresa?.giro || null, email: c.titular.email, celular: c.titular.celular, representante_legal_id: repId,
        direccion_id: c.empresa ? null : direccionId
      });
      cliente = { id, tipo_persona: tipoCliente };
    }

    // 3. Contrato, servicio y pago
    const punto = await tiendaRepo.puntoDeVenta(db, REGION[c.region]);
    if (!punto) throw errores.sinBaseDatos('La tienda no está configurada: falta una empresa emisora con sucursal activa.');
    const contrato = await tiendaRepo.crearContrato(db, {
      empresa_id: punto.empresa_id, cliente_id: cliente.id, sucursal_id: punto.sucursal_id,
      cuenta_recaudacion_id: punto.cuenta_id, link_pago: punto.cuenta_id ? null : 'Pago en línea (tienda)',
      duracion_meses: DURACION[plan.recur] || 12,
      datos_formulario: { tienda: { plan: plan.id, tipo: c.tipo, titular: c.titular, empresa: c.empresa,
        nombre_empresa_nueva: c.nombre_empresa_nueva, region: c.region, pago: { modo: c.modo, medio: c.medio } }, respuestas: c.respuestas }
    });
    await contratosRepo.agregarServicio(db, contrato.id, { servicio_id: servicio.id, precio: plan.price, ciclo_pago: null, descripcion: null });
    await pagosRepo.crear(db, { contrato_id: contrato.id, documento_id: null, monto, estado: 'pendiente', pasarela: PASARELA[c.medio],
      fecha_pago: null, cuota: 1, total_cuotas: c.modo === 'split' ? 2 : 1 });

    // 4. Documentos del plan
    const documentos = [];
    for (const p of await plantillasRepo.porPlan(db, plan.id)) {
      const g = await archivosServicio.generarEnTransaccion(db, { plantilla: { ...p, activo: true }, contratoId: contrato.id, respuestas: c.respuestas });
      documentos.push({ id: g.documento_id, tipo: p.tipo_documento, publicado: g.publicado });
    }
    return { cliente, contrato, documentos };
  });

  // Después de confirmar: avisos por correo y enlace para crear la contraseña del portal
  for (const d of r.documentos.filter((x) => x.publicado)) {
    const doc = await conSistema((db) => documentosRepo.entregaDe(db, d.id));
    await entregaServicio.avisarPublicado(doc);
  }
  let cuenta = 'con_clave';
  try {
    const tieneClave = (await portalRepo.vinculos(c.titular.email, tipoCliente, rutCliente)).some((x) => x.password_hash && x.activo);
    if (!tieneClave) {
      await portalServicio.solicitarClave({ tipo: c.empresa ? 'empresa' : 'persona', rut: rutCliente, email: c.titular.email }, ip);
      cuenta = 'enlace_enviado';
    }
  } catch (err) {
    console.warn('[tienda] no se pudo enviar el enlace de contraseña:', err.message);
    cuenta = 'sin_enlace';
  }

  return {
    orden: r.contrato.folio, plan: plan.name, familia: plan.fam, monto, total: plan.price, modo: c.modo,
    pasarela: PASARELA[c.medio], email: c.titular.email, cuenta,
    documentos: r.documentos.map(({ tipo, publicado }) => ({ tipo, publicado }))
  };
}

// Comunas para el formulario de la tienda
async function comunas() {
  return { comunas: await conSistema((db) => tiendaRepo.comunas(db)) };
}

module.exports = { preguntas, comprar, comunas };
