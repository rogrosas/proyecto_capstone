/* =========================================================
   CAPA DE NEGOCIO · Documentos y firmas.
   Regla: solo se aprueba un documento que está "en revisión"; quien
   aprueba queda registrado (la BD exige revisado_por para firmarlo).
   ========================================================= */
const { conUsuario } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const documentosRepo = require('../../datos/repositorios/documentos.repositorio');

const LIMITE = 300;
const TIPOS = { revision: true, automatico: false };

async function listar(usuario, { tipo }) {
  const revision = tipo in TIPOS ? TIPOS[tipo] : null;
  return conUsuario(usuario, async (db) => ({
    etapas: await documentosRepo.contarPorEstado(db),
    documentos: await documentosRepo.listar(db, { revision }, LIMITE)
  }));
}

async function aprobar(usuario, id) {
  id = Number(id);
  if (!Number.isInteger(id)) throw errores.solicitudInvalida('Documento inválido.');
  const ok = await conUsuario(usuario, (db) => documentosRepo.aprobar(db, id));
  if (!ok) throw errores.conflicto('El documento no está en revisión o no pertenece a su cartera.');
  return { ok: true };
}

/* ---------- Detalle, alta y ciclo de vida ---------- */

const crypto = require('crypto');
const v = require('../validacion');

/*
 * Transiciones permitidas. La aprobación (en_revision -> aprobado) va por aprobar(),
 * que registra al revisor. La base de datos además impide aprobar, enviar a firma
 * o firmar un documento que requiere revisión si no tiene revisado_por.
 */
const TRANSICIONES = {
  borrador: ['en_revision', 'enviado_firma', 'anulado'],
  en_revision: ['rechazado', 'anulado'],
  aprobado: ['enviado_firma', 'anulado'],
  enviado_firma: ['firmado', 'rechazado', 'anulado'],
  rechazado: ['borrador', 'anulado'],
  firmado: [],
  anulado: []
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// '2026-10-22' -> '22 de octubre de 2026'
function fechaLarga(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

// Reemplaza {variable} por su valor; las que falten quedan marcadas
function completar(texto, valores) {
  return String(texto || '').replace(/\{(\w+)\}/g, (_, k) =>
    (valores[k] !== undefined && valores[k] !== null && valores[k] !== '' ? String(valores[k]) : `[${k}]`));
}

async function detalle(usuario, id) {
  id = v.id(id, 'Documento');
  return conUsuario(usuario, async (db) => {
    const doc = await documentosRepo.obtener(db, id);
    if (!doc) throw errores.noEncontrado('Documento no encontrado o fuera de su cartera.');
    const partes = await documentosRepo.partes(db, id);
    const clausulas = await documentosRepo.clausulas(db, id);
    const valores = { ...(doc.datos || {}), lugar: doc.lugar, fecha: fechaLarga(doc.fecha_documento) };
    const texto = [completar(doc.contenido_plantilla, valores)]
      .concat(clausulas.map((c, i) => `${i + 1}. ${c.titulo}. ${completar(c.texto_plantilla, { ...valores, ...(c.valores || {}) })}`))
      .filter(Boolean).join('\n\n');
    const siguientes = TRANSICIONES[doc.estado].filter((e) =>
      !(e === 'en_revision' && !doc.requiere_revision) && !(e === 'enviado_firma' && doc.estado === 'borrador' && doc.requiere_revision));
    return { documento: doc, partes, clausulas, texto, siguientes, puedeAprobar: doc.estado === 'en_revision' };
  });
}

function validarParte(p, i) {
  const et = `Parte ${i + 1}`;
  const juridica = p.tipo_persona === 'juridica';
  return {
    rol: v.texto(p.rol, `${et}: rol`, { max: 60 }),
    tipo_persona: v.opcion(p.tipo_persona || 'natural', ['natural', 'juridica'], `${et}: tipo de persona`),
    nombre: v.texto(p.nombre, `${et}: nombre`),
    rut: v.rut(p.rut, `${et}: RUT`, { opcional: true }),
    nacionalidad: v.texto(p.nacionalidad, `${et}: nacionalidad`, { opcional: true }),
    estado_civil: v.texto(p.estado_civil, `${et}: estado civil`, { opcional: true }),
    profesion: v.texto(p.profesion, `${et}: profesión`, { opcional: true }),
    email: v.email(p.email, `${et}: correo`),
    telefono: v.texto(p.telefono, `${et}: teléfono`, { opcional: true, max: 30 }),
    representante_nombre: juridica ? v.texto(p.representante_nombre, `${et}: representante`, { opcional: true }) : null,
    representante_rut: juridica ? v.rut(p.representante_rut, `${et}: RUT del representante`, { opcional: true }) : null,
    cantidad_acciones: v.entero(p.cantidad_acciones, `${et}: acciones`, { opcional: true, min: 0 })
  };
}

async function crear(usuario, d = {}) {
  const doc = {
    cliente_id: v.id(d.cliente_id, 'Cliente'),
    contrato_id: v.id(d.contrato_id, 'Contrato', { opcional: true }),
    servicio_id: v.id(d.servicio_id, 'Servicio', { opcional: true }),
    plantilla_id: v.id(d.plantilla_id, 'Plantilla'),
    tipo: v.texto(d.tipo, 'Tipo de documento', { opcional: true }),
    lugar: v.texto(d.lugar, 'Lugar', { opcional: true, max: 100 }) || 'Santiago',
    fecha_documento: v.fecha(d.fecha_documento, 'Fecha del documento', { opcional: true }),
    datos: v.json(d.datos, 'Datos') || {},
    ejecutivo_id: usuario.admin ? v.id(d.ejecutivo_id, 'Ejecutivo', { opcional: true }) ?? usuario.id : usuario.id
  };
  const partes = (Array.isArray(d.partes) ? d.partes : []).filter((p) => p && p.nombre).map(validarParte);
  const clausulas = (Array.isArray(d.clausulas) ? d.clausulas : []).map((c) => ({
    clausula_id: v.id(c.clausula_id, 'Cláusula'), valores: v.json(c.valores, 'Valores de la cláusula') || {}
  }));

  return conUsuario(usuario, async (db) => {
    if (!doc.tipo) {
      doc.tipo = await documentosRepo.tipoDePlantilla(db, doc.plantilla_id);
      if (!doc.tipo) throw errores.solicitudInvalida('La plantilla no existe.');
    }
    const id = await documentosRepo.crear(db, doc);
    for (const [i, p] of partes.entries()) await documentosRepo.agregarParte(db, id, i + 1, p);
    for (const [i, c] of clausulas.entries()) await documentosRepo.agregarClausula(db, id, i + 1, c);
    return { id };
  });
}

async function cambiarEstado(usuario, id, d = {}) {
  id = v.id(id, 'Documento');
  const nuevo = v.opcion(d.estado, Object.keys(TRANSICIONES), 'Estado');
  return conUsuario(usuario, async (db) => {
    const actual = await documentosRepo.estadoActual(db, id);
    if (!actual) throw errores.noEncontrado('Documento no encontrado o fuera de su cartera.');
    if (!TRANSICIONES[actual.estado].includes(nuevo)) {
      throw errores.conflicto(`No se puede pasar de "${actual.estado}" a "${nuevo}".`);
    }
    if (nuevo === 'en_revision' && !actual.requiere_revision) throw errores.conflicto('Este documento no requiere revisión: envíelo directamente a firma.');
    if (nuevo === 'enviado_firma' && actual.requiere_revision && !actual.revisado_por) {
      throw errores.conflicto('Este documento requiere aprobación humana antes de enviarse a firma.');
    }
    const cambios = { estado: nuevo };
    if (nuevo === 'enviado_firma' && d.firma_id_externo) cambios.firma_id_externo = v.texto(d.firma_id_externo, 'Id de firma', { max: 200 });
    if (nuevo === 'firmado') {
      cambios.firmado_en = true;
      if (!actual.codigo_verificacion) {
        const h = crypto.randomBytes(4).toString('hex').toUpperCase();
        cambios.codigo_verificacion = `EO-${h.slice(0, 4)}-${h.slice(4)}`;
      }
      if (d.url_archivo) cambios.url_archivo = v.texto(d.url_archivo, 'URL del archivo', { max: 500 });
    }
    if (!(await documentosRepo.cambiarEstado(db, id, actual.estado, cambios))) {
      throw errores.conflicto('El documento cambió mientras tanto; recargue e intente de nuevo.');
    }
    return { ok: true, estado: nuevo };
  });
}

module.exports = { listar, aprobar, detalle, crear, cambiarEstado };
