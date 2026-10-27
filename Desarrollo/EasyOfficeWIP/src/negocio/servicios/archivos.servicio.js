/* =========================================================
   CAPA DE NEGOCIO · Plantillas Word y contratos generados.
   Reemplaza el paso "Excel + combinar correspondencia": los campos
   MERGEFIELD de la plantilla se llenan con los datos del contrato
   (v_datos_contrato) y el .docx se guarda en la carpeta de contratos;
   la BD solo guarda su ubicación (documentos.url_archivo).
   Regla: no se regenera un documento que ya está en revisión,
   aprobado, enviado a firma o firmado (hay que anularlo antes).
   ========================================================= */
const crypto = require('crypto');
const { conUsuario } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const archivos = require('../../datos/archivos');
const word = require('../../datos/word');
const contratosRepo = require('../../datos/repositorios/contratos.repositorio');
const documentosRepo = require('../../datos/repositorios/documentos.repositorio');
const plantillasRepo = require('../../datos/repositorios/plantillas.repositorio');
const { archivos: cfg } = require('../../config');
const v = require('../validacion');

const REGENERABLES = ['borrador', 'rechazado'];
const SERVICIOS_EN_PLANTILLA = 3;   // la plantilla trae SERVICIO_1..3

// 'REGIÓN_SUCURSAL' y 'REGION_SUCURSAL' son el mismo campo
const clave = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const mayus = (s) => (s === null || s === undefined ? '' : String(s).toLocaleUpperCase('es-CL'));
// 'Región Metropolitana' -> 'METROPOLITANA' (el contrato ya dice "región ...")
const region = (s) => mayus(String(s || '').replace(/^regi[oó]n\s+(de\s+la\s+|de\s+los\s+|del\s+|de\s+)?/i, ''));
const miles = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('es-CL'));

/*
 * Campos de la combinación actual (FORMULARIO EASY OFFICE 2026 / MUESTRA DE CAMPOS BB DD)
 * -> datos de la base. Mismo formato que el Excel: mayúsculas y fechas en texto largo.
 */
function valoresContrato({ datos: d, servicios }) {
  const val = {
    FOLIO: d.folio,
    FECHA_DE_INICIO: d.fecha_inicio,
    VENCIMIENTO: d.fecha_vencimiento,
    DURACION: d.duracion,
    RAZON_SOCIAL: mayus(d.cliente_razon_social),
    RUT: d.cliente_rut,
    GIRO_PRINCIPAL: mayus(d.cliente_giro),
    MAIL: d.cliente_email || '',
    CELULAR_8_DIGITOS: d.cliente_celular || '',
    REPRESENTANTE_LEGAL: mayus(d.cliente_rep_nombre),
    RUT_REP_LEGAL: d.cliente_rep_rut || '',
    DOMIC_REP_LEGAL: mayus(d.cliente_rep_domicilio),
    COMUNA_REP_LEGAL: mayus(d.cliente_rep_comuna),
    REGION_REP_LEGAL: region(d.cliente_rep_region),
    FECHA_ESCRITURAESTATUTO_ACTUALIZADO: d.cliente_fecha_escritura || '',
    SITIONOTARIA: d.cliente_sitio_notaria || '',
    SUCURSAL: mayus(d.sucursal_direccion),
    COMUNA_SUCURSAL: mayus(d.sucursal_comuna),
    REGION_SUCURSAL: region(d.sucursal_region),
    ROL_PROPIEDAD: d.rol_propiedad || '',
    BANCOLINK: d.medio_pago || ''
  };
  for (let i = 1; i <= SERVICIOS_EN_PLANTILLA; i++) {
    const s = servicios[i - 1];
    val[`SERVICIO_${i}`] = s ? mayus(s.servicio) : '';
    val[`PRECIO_SS_${i}`] = s ? miles(s.precio) : '';
    val[`CICLO_PAGO_SS_${i}`] = s ? s.ciclo : '';
    val[`DESCRIPCION_SS_${i}`] = s ? (s.contenido || '') : '';
  }
  return val;
}

// Datos que el contrato debería tener y faltan (para avisar antes de enviarlo a revisión)
const OBLIGATORIOS = { RAZON_SOCIAL: 'razón social', RUT: 'RUT', REPRESENTANTE_LEGAL: 'representante legal', RUT_REP_LEGAL: 'RUT del representante',
  DOMIC_REP_LEGAL: 'domicilio del representante', MAIL: 'correo', SUCURSAL: 'dirección de la sucursal', ROL_PROPIEDAD: 'rol de la propiedad', BANCOLINK: 'medio de pago',
  FECHA_ESCRITURAESTATUTO_ACTUALIZADO: 'fecha de escritura/estatuto', SITIONOTARIA: 'sitio o notaría' };

const nombreSeguro = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);

/* ---------- Generar el contrato Word ---------- */
async function generarContrato(usuario, contratoId, d = {}) {
  contratoId = v.id(contratoId, 'Contrato');
  const plantillaId = v.id(d.plantilla_id, 'Plantilla');

  return conUsuario(usuario, async (db) => {
    const plantilla = await plantillasRepo.obtener(db, plantillaId);
    if (!plantilla || !plantilla.activo) throw errores.noEncontrado('La plantilla no existe o está inactiva.');
    if (!plantilla.archivo_base) throw errores.conflicto('La plantilla no tiene archivo Word asociado (Administración → Plantillas de documento).');
    const fuente = await contratosRepo.impresion(db, contratoId);
    if (!fuente) throw errores.noEncontrado('Contrato no encontrado o fuera de su cartera.');

    const base = await archivos.leer(plantilla.archivo_base);
    const val = valoresContrato(fuente);
    const usados = word.campos(base).map(clave);
    if (!usados.length) throw errores.conflicto('El archivo de la plantilla no tiene campos de combinación (MERGEFIELD): no hay nada que completar.');
    const { buffer, desconocidos } = word.combinar(base, (n) => val[clave(n)]);

    // Documento al que pertenece esta versión
    const k = fuente.datos;
    let doc = await documentosRepo.generadoVigente(db, contratoId, plantillaId);
    if (doc && !REGENERABLES.includes(doc.estado)) {
      throw errores.conflicto(`El documento de este contrato está "${doc.estado.replace('_', ' ')}". Anúlelo si necesita generar uno nuevo.`);
    }
    if (!doc) {
      const id = await documentosRepo.crear(db, {
        cliente_id: (await contratosRepo.obtener(db, contratoId)).cliente_id,
        contrato_id: contratoId, servicio_id: null, plantilla_id: plantillaId,
        tipo: plantilla.tipo_documento, lugar: k.lugar_celebracion, fecha_documento: null,
        datos: { origen: 'word', plantilla: plantilla.archivo_base },
        ejecutivo_id: usuario.id
      });
      doc = { id, estado: 'borrador', url_archivo: null };
    }
    const version = (await documentosRepo.ultimaVersion(db, doc.id, doc.url_archivo)) + 1;
    const anio = (/-(\d{4})$/.exec(k.folio) || [0, new Date().getFullYear()])[1];
    const rel = `${cfg.generados}/${anio}/${nombreSeguro(`${k.folio} ${plantilla.tipo_documento}`)}_v${version}.docx`;

    await archivos.guardar(rel, buffer);
    try {
      await documentosRepo.guardarArchivo(db, doc.id, rel);
      await documentosRepo.registrarVersion(db, doc.id, version, rel, crypto.createHash('sha256').update(buffer).digest('hex'));
    } catch (err) {
      await archivos.eliminar(rel);   // sin registro en la BD no queda archivo huérfano
      throw err;
    }

    return {
      documento_id: doc.id, version, archivo: rel,
      sin_dato: Object.entries(OBLIGATORIOS).filter(([c]) => usados.includes(c) && !val[c]).map(([, et]) => et),
      campos_desconocidos: desconocidos,
      servicios_omitidos: Math.max(0, fuente.servicios.length - SERVICIOS_EN_PLANTILLA)
    };
  });
}

/* ---------- Descargas ---------- */
async function archivoDocumento(usuario, id) {
  id = v.id(id, 'Documento');
  const doc = await conUsuario(usuario, (db) => documentosRepo.archivoDe(db, id));
  if (!doc) throw errores.noEncontrado('Documento no encontrado o fuera de su cartera.');
  if (!doc.url_archivo) throw errores.noEncontrado('Este documento aún no tiene archivo.');
  if (/^https?:\/\//i.test(doc.url_archivo)) throw errores.conflicto('El archivo de este documento es un enlace externo.');
  return { nombre: doc.url_archivo.split('/').pop(), contenido: await archivos.leer(doc.url_archivo) };
}

async function archivoPlantilla(usuario, id) {
  id = v.id(id, 'Plantilla');
  const p = await conUsuario(usuario, (db) => plantillasRepo.obtener(db, id));
  if (!p || !p.archivo_base) throw errores.noEncontrado('La plantilla no tiene archivo Word.');
  return { nombre: p.archivo_base.split('/').pop(), contenido: await archivos.leer(p.archivo_base) };
}

async function plantillas(usuario) {
  return { plantillas: await conUsuario(usuario, (db) => plantillasRepo.conArchivo(db)) };
}

/* ---------- Administración de la carpeta (solo administradores) ---------- */
function exigirAdmin(usuario) {
  if (!usuario.admin) throw errores.sinPermiso('Solo los administradores gestionan las plantillas.');
}

async function listarArchivos(usuario) {
  exigirAdmin(usuario);
  const uso = await conUsuario(usuario, (db) => plantillasRepo.usoDeArchivos(db));
  const lista = await archivos.listarPlantillas();
  for (const a of lista) {
    a.plantillas = uso[a.archivo] || null;
    try { a.campos = word.campos(await archivos.leer(a.archivo)).length; } catch { a.campos = null; }
  }
  return { carpeta: archivos.carpeta(), archivos: lista };
}

async function subirArchivo(usuario, { nombre, reemplazar }, contenido) {
  exigirAdmin(usuario);
  const n = nombreSeguro(String(nombre || '').split(/[\\/]/).pop());
  if (!/\.docx$/i.test(n) || n.startsWith('~$')) throw errores.solicitudInvalida('Solo se aceptan archivos .docx.');
  if (!Buffer.isBuffer(contenido) || !contenido.length) throw errores.solicitudInvalida('El archivo está vacío.');
  const campos = word.campos(contenido);   // también valida que sea un .docx
  const rel = `plantillas/${n}`;
  await archivos.guardar(rel, contenido, { reemplazar: reemplazar === '1' || reemplazar === 'true' });
  return { archivo: rel, campos: campos.length };
}

module.exports = { generarContrato, archivoDocumento, archivoPlantilla, plantillas, listarArchivos, subirArchivo, valoresContrato };
