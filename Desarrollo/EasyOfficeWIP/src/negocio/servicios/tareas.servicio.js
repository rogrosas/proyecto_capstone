/* =========================================================
   CAPA DE NEGOCIO · Tareas diarias sobre los contratos.
     1. Renovación automática: un contrato activo con "renovación automática"
        (cláusula QUINTO) que vence hoy o venció hace pocos días se renueva solo
        con los mismos servicios a precio vigente; se avisa al cliente y a su ejecutivo.
        Los que vencieron hace más días no se renuevan solos: quedan para el personal.
     2. Vencidos: un contrato activo cuya fecha de término ya pasó queda "vencido".
   Las dos son idempotentes (se pueden correr varias veces el mismo día): las
   lanza la programación diaria de los avisos y el botón de Renovaciones.
   ========================================================= */
const config = require('../../config');
const { conSistema } = require('../../datos/conexion');
const correo = require('../../datos/correo');
const contratosRepo = require('../../datos/repositorios/contratos.repositorio');
const portalRepo = require('../../datos/repositorios/portal.repositorio');
const personal = require('./personal.servicio');
const { esc, boton, cuerpo, titulo, pie, fechaCl } = require('../../comun/correos');

const DIAS_GRACIA_RENOVACION = 7;

async function renovarAutomaticos() {
  const lista = await conSistema((db) => contratosRepo.porRenovarAutomatico(db, DIAS_GRACIA_RENOVACION));
  const renovados = [];
  for (const k of lista) {
    let nuevo;
    try {
      nuevo = await conSistema((db) => contratosRepo.renovar(db, k.id));
    } catch (err) {
      console.warn('[tareas] no se pudo renovar', k.folio, err.message);
      continue;
    }
    renovados.push({ folio: k.folio, nuevo: nuevo.folio, cliente: k.cliente });
    for (const para of await portalRepo.contactos(k.cliente_id).catch(() => [])) {
      await correo.enviar({
        para, asunto: `Su contrato ${k.folio} se renovó`,
        texto: `Su contrato ${k.folio} se renovó automáticamente: el nuevo folio es ${nuevo.folio}, vigente hasta el ${fechaCl(nuevo.vence)}.`,
        html: cuerpo(`${titulo('Su contrato se renovó')}
          <p>Según la cláusula de renovación automática, su contrato <b>${esc(k.folio)}</b> se renovó con los mismos servicios.</p>
          <p>Nuevo folio: <b>${esc(nuevo.folio)}</b> · vigente hasta el <b>${fechaCl(nuevo.vence)}</b>.</p>
          <p>Si no desea continuar, responda a su ejecutivo.</p>${boton(`${config.appUrl}/mi-cuenta`, 'Ver en Mi cuenta')}${pie}`)
      }).catch((err) => console.warn('[tareas] aviso de renovación a', para, err.message));
    }
    await personal.avisar(k.cliente_id, {
      asunto: `Renovación automática: ${k.folio} → ${nuevo.folio}`,
      titulo: 'Contrato renovado automáticamente',
      lineas: [`${k.cliente}: el contrato ${k.folio} se renovó con el folio ${nuevo.folio} (vigente hasta el ${fechaCl(nuevo.vence)}).`,
        'Revise el cobro del nuevo período.'],
      seccion: 'contratos'
    });
  }
  return renovados;
}

async function ejecutar() {
  const renovados = await renovarAutomaticos();   // primero renovar: después el contrato anterior queda vencido
  const vencidos = await conSistema((db) => contratosRepo.marcarVencidos(db));
  if (renovados.length || vencidos.length) console.log(`[tareas] ${renovados.length} contrato(s) renovado(s), ${vencidos.length} marcado(s) como vencido(s).`);
  return { renovados, vencidos };
}

module.exports = { ejecutar, DIAS_GRACIA_RENOVACION };
