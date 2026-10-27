/* =========================================================
   CAPA DE NEGOCIO · Plantillas Word y contratos generados.
   Reemplaza el paso "Excel + combinar correspondencia": las marcas de la
   plantilla (campos MERGEFIELD y textos entre corchetes) se llenan con los
   datos del contrato (v_datos_contrato) según plantillas_documento.mapa_campos,
   y el .docx se guarda en la carpeta de contratos; la BD solo guarda su
   ubicación (documentos.url_archivo).
   Reglas: no se regenera un documento que ya está en revisión, aprobado,
   enviado a firma o firmado (hay que anularlo antes), ni uno que el cliente
   ya aceptó. Si la plantilla se entrega en forma automática y no falta ningún
   dato, el borrador queda publicado al cliente para que lo revise.
   ========================================================= */
const crypto = require('crypto');
const { conUsuario } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const archivos = require('../../datos/archivos');
const word = require('../../datos/word');
const contratosRepo = require('../../datos/repositorios/contratos.repositorio');
const documentosRepo = require('../../datos/repositorios/documentos.repositorio');
const plantillasRepo = require('../../datos/repositorios/plantillas.repositorio');
const catalogoRepo = require('../../datos/repositorios/catalogo.repositorio');
const campos = require('../camposDocumento');
const { archivos: cfg } = require('../../config');
const v = require('../validacion');

const REGENERABLES = ['borrador', 'rechazado'];

// Datos que el contrato debería tener y faltan (para avisar antes de enviarlo a revisión)
const OBLIGATORIOS = { RAZON_SOCIAL: 'razón social', RUT: 'RUT', REPRESENTANTE_LEGAL: 'representante legal', RUT_REP_LEGAL: 'RUT del representante',
  DOMIC_REP_LEGAL: 'domicilio del representante', MAIL: 'correo', SUCURSAL: 'dirección de la sucursal', ROL_PROPIEDAD: 'rol de la propiedad', BANCOLINK: 'medio de pago',
  FECHA_ESCRITURAESTATUTO_ACTUALIZADO: 'fecha de escritura/estatuto', SITIONOTARIA: 'sitio o notaría' };

const nombreSeguro = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);

// { marca: texto } recibido de la tienda o del CRM: solo textos, sin vacíos
function leerRespuestas(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return {};
  return Object.fromEntries(Object.entries(r)
    .filter(([k, x]) => k.length <= 100 && x !== null && x !== undefined && String(x).trim())
    .slice(0, 100)
    .map(([k, x]) => [k, String(x).trim().slice(0, 1000)]));
}

/*
 * Genera (o versiona) el documento Word de un contrato con una plantilla, dentro de la
 * transacción que recibe: la del usuario del CRM o la del sistema (compra en la tienda).
 * respuestas: valores de las marcas que no salen de la base (las de _tienda y _ejecutivo).
 */
async function generarEnTransaccion(db, { plantilla, contratoId, respuestas = {}, ejecutivoId = null }) {
  if (!plantilla || !plantilla.activo) throw errores.noEncontrado('La plantilla no existe o está inactiva.');
  if (!plantilla.archivo_base) throw errores.conflicto('La plantilla no tiene archivo Word asociado (Administración → Documentos de la tienda).');
  const fuente = await contratosRepo.impresion(db, contratoId);
  if (!fuente) throw errores.noEncontrado('Contrato no encontrado o fuera de su cartera.');

  // Documento al que pertenece esta versión (se conservan las respuestas anteriores)
  const k = fuente.datos;
  let doc = await documentosRepo.generadoVigente(db, contratoId, plantilla.id);
  if (doc && doc.estado_cliente === 'aceptado') {
    throw errores.conflicto('El cliente ya aceptó este documento. Anúlelo si necesita generar uno nuevo.');
  }
  if (doc && !REGENERABLES.includes(doc.estado)) {
    throw errores.conflicto(`El documento de este contrato está "${doc.estado.replace('_', ' ')}". Anúlelo si necesita generar uno nuevo.`);
  }
  const anteriores = doc ? ((await documentosRepo.obtener(db, doc.id))?.datos?.respuestas || {}) : {};
  respuestas = { ...anteriores, ...leerRespuestas(respuestas) };

  const base = await archivos.leer(plantilla.archivo_base);
  const marcas = word.marcas(base);
  if (!marcas.length) throw errores.conflicto('El archivo de la plantilla no tiene campos ni marcas entre corchetes: no hay nada que completar.');
  const val = campos.valores(fuente);
  const { valor, pendientes, fuentes } = campos.resolver(marcas, plantilla.mapa_campos, val, respuestas);
  const { buffer, desconocidos } = word.combinar(base, valor);

  const datos = { origen: 'word', plantilla: plantilla.archivo_base, respuestas };
  if (!doc) {
    const id = await documentosRepo.crear(db, {
      cliente_id: (await contratosRepo.obtener(db, contratoId)).cliente_id,
      contrato_id: contratoId, servicio_id: null, plantilla_id: plantilla.id,
      tipo: plantilla.tipo_documento, lugar: k.lugar_celebracion, fecha_documento: null,
      datos, ejecutivo_id: ejecutivoId
    });
    doc = { id, estado: 'borrador', url_archivo: null };
  } else {
    await db.query('UPDATE documentos SET datos = $2 WHERE id = $1', [doc.id, datos]);
  }
  const version = (await documentosRepo.ultimaVersion(db, doc.id, doc.url_archivo)) + 1;
  const anio = (/-(\d{4})$/.exec(k.folio) || [0, new Date().getFullYear()])[1];
  const rel = `${cfg.generados}/${anio}/${nombreSeguro(`${k.folio} ${plantilla.tipo_documento}`)}_v${version}.docx`;

  await archivos.guardar(rel, buffer);
  try {
    await documentosRepo.guardarArchivo(db, doc.id, rel);
    await documentosRepo.registrarVersion(db, doc.id, version, rel, crypto.createHash('sha256').update(buffer).digest('hex'));
    // Entrega: automática solo si no falta ningún dato; si no, espera la revisión del personal
    const publicado = plantilla.entrega === 'automatica' && !pendientes.length;
    await documentosRepo.fijarEntrega(db, doc.id, publicado ? 'por_revisar' : null);

    const usados = [...fuentes.values()].map((f) => f.dato);
    return {
      documento_id: doc.id, version, archivo: rel, publicado,
      pendientes: pendientes.map((m) => ({ marca: m, etiqueta: fuentes.get(m).etiqueta || campos.etiquetaDe(m) })),
      sin_dato: Object.entries(OBLIGATORIOS).filter(([c]) => usados.includes(c) && !val[c]).map(([, et]) => et),
      campos_desconocidos: desconocidos.filter((m) => !pendientes.includes(m) && fuentes.get(m)?.dato !== '_ignorar'),
      servicios_omitidos: Math.max(0, fuente.servicios.length - campos.SERVICIOS_EN_PLANTILLA)
    };
  } catch (err) {
    await archivos.eliminar(rel);   // sin registro en la BD no queda archivo huérfano
    throw err;
  }
}

/* ---------- Generar desde el CRM ---------- */
async function generarContrato(usuario, contratoId, d = {}) {
  contratoId = v.id(contratoId, 'Contrato');
  const plantillaId = v.id(d.plantilla_id, 'Plantilla');
  return conUsuario(usuario, async (db) => generarEnTransaccion(db, {
    plantilla: await plantillasRepo.obtener(db, plantillaId),
    contratoId, respuestas: d.valores, ejecutivoId: usuario.id
  }));
}

// Marcas que el personal debe completar al generar (con lo que ya respondió el comprador, si lo hay)
async function preguntasGeneracion(usuario, plantillaId, contratoId) {
  plantillaId = v.id(plantillaId, 'Plantilla');
  contratoId = v.id(contratoId, 'Contrato', { opcional: true });
  return conUsuario(usuario, async (db) => {
    const p = await plantillasRepo.obtener(db, plantillaId);
    if (!p || !p.archivo_base) throw errores.noEncontrado('La plantilla no tiene archivo Word.');
    const marcas = word.marcas(await archivos.leer(p.archivo_base));
    const previo = contratoId ? await documentosRepo.generadoVigente(db, contratoId, plantillaId) : null;
    const respuestas = previo ? ((await documentosRepo.obtener(db, previo.id))?.datos?.respuestas || {}) : {};
    return {
      entrega: p.entrega,
      preguntas: campos.preguntas(marcas, p.mapa_campos, '_ejecutivo').map((q) => ({ ...q, valor: respuestas[q.marca] || '' }))
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
    try { a.campos = word.marcas(await archivos.leer(a.archivo)).length; } catch { a.campos = null; }
  }
  return { carpeta: archivos.carpeta(), archivos: lista };
}

async function subirArchivo(usuario, { nombre, reemplazar }, contenido) {
  exigirAdmin(usuario);
  const n = nombreSeguro(String(nombre || '').split(/[\\/]/).pop());
  if (!/\.docx$/i.test(n) || n.startsWith('~$')) throw errores.solicitudInvalida('Solo se aceptan archivos .docx.');
  if (!Buffer.isBuffer(contenido) || !contenido.length) throw errores.solicitudInvalida('El archivo está vacío.');
  const marcas = word.marcas(contenido);   // también valida que sea un .docx
  const rel = `plantillas/${n}`;
  await archivos.guardar(rel, contenido, { reemplazar: reemplazar === '1' || reemplazar === 'true' });
  return { archivo: rel, campos: marcas.length };
}

/* ---------- Documentos de la tienda (solo administradores) ---------- */

// Lista para Administración: cada plantilla con archivo, sus planes, su entrega y cuántas marcas quedan por definir
async function documentosTienda(usuario) {
  exigirAdmin(usuario);
  const lista = await conUsuario(usuario, (db) => plantillasRepo.deTienda(db));
  for (const p of lista) {
    try {
      const marcas = word.marcas(await archivos.leer(p.archivo_base));
      p.marcas = marcas.length;
      p.manuales = campos.preguntas(marcas, p.mapa_campos, '_ejecutivo').length;
      p.configurada = !!p.mapa_campos;
    } catch (err) {
      p.marcas = null;
      p.error = err.message;
    }
    delete p.mapa_campos;
  }
  return { plantillas: lista, planes: planesTienda() };
}

const planesTienda = () => catalogoRepo.todos().map((f) => ({
  familia: f.tab, planes: f.plans.map((p) => ({ codigo: p.id, nombre: p.name, precio: p.price }))
}));

// Marcas detectadas en el Word con la fuente guardada o sugerida, para el formulario de configuración
async function camposPlantilla(usuario, id) {
  exigirAdmin(usuario);
  id = v.id(id, 'Plantilla');
  const p = await conUsuario(usuario, (db) => plantillasRepo.obtener(db, id));
  if (!p || !p.archivo_base) throw errores.noEncontrado('La plantilla no tiene archivo Word.');
  const marcas = word.marcas(await archivos.leer(p.archivo_base));
  return {
    plantilla: { id: p.id, tipo_documento: p.tipo_documento, version: p.version, archivo_base: p.archivo_base, entrega: p.entrega, planes: p.planes },
    marcas: marcas.map(({ marca, tipo }) => {
      const sugerida = campos.sugerir(marca);
      const guardada = p.mapa_campos?.[marca];
      return { marca, tipo, ...(guardada || sugerida), sugerida: sugerida.dato, guardada: !!guardada };
    }),
    datos: campos.DATOS,
    planes: planesTienda()
  };
}

/** d = { entrega: 'automatica'|'revision', planes: ['dom-anual'], mapa: { marca: { dato, etiqueta } } } */
async function configurarTienda(usuario, id, d = {}) {
  exigirAdmin(usuario);
  id = v.id(id, 'Plantilla');
  const entrega = v.opcion(d.entrega, ['automatica', 'revision'], 'Entrega');
  const codigos = new Set(catalogoRepo.todos().flatMap((f) => f.plans.map((p) => p.id)));
  const planes = [...new Set(Array.isArray(d.planes) ? d.planes : [])];
  const desconocido = planes.find((c) => !codigos.has(c));
  if (desconocido) throw errores.solicitudInvalida(`El plan "${desconocido}" no existe en la tienda.`);

  return conUsuario(usuario, async (db) => {
    const p = await plantillasRepo.obtener(db, id);
    if (!p || !p.archivo_base) throw errores.noEncontrado('La plantilla no tiene archivo Word.');
    const marcas = word.marcas(await archivos.leer(p.archivo_base));
    const mapa = {};
    for (const { marca } of marcas) {
      const f = d.mapa?.[marca] || campos.sugerir(marca);
      if (!campos.esFuenteValida(f.dato)) throw errores.solicitudInvalida(`Dato no válido para ${marca}.`);
      mapa[marca] = { dato: f.dato };
      if (f.dato === '_tienda' || f.dato === '_ejecutivo') {
        mapa[marca].etiqueta = v.texto(f.etiqueta || campos.etiquetaDe(marca), `Pregunta para ${marca}`, { max: 100 });
      }
    }
    // Entrega automática a la tienda: nada puede depender del personal
    const delPersonal = Object.entries(mapa).filter(([, f]) => f.dato === '_ejecutivo').map(([m]) => m);
    if (entrega === 'automatica' && delPersonal.length) {
      throw errores.solicitudInvalida(`Para entregar en forma automática, ningún dato puede quedar para el personal: ${delPersonal.slice(0, 5).join(', ')}${delPersonal.length > 5 ? '…' : ''}. Páselos a "lo responde el cliente en la tienda" o elija revisión.`);
    }
    await plantillasRepo.guardarTienda(db, id, { entrega, mapa_campos: mapa, planes });
    return { ok: true };
  });
}

module.exports = {
  generarEnTransaccion, generarContrato, preguntasGeneracion, archivoDocumento, archivoPlantilla, plantillas, listarArchivos, subirArchivo,
  documentosTienda, camposPlantilla, configurarTienda, planesTienda, leerRespuestas
};
