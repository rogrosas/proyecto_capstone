/* =========================================================
   CAPA DE NEGOCIO · Qué dato del cliente va en cada marca del Word.

   DATOS: los datos que la app sabe completar. La clave es el nombre del
   campo de combinación que ya usan los contratos (RAZON_SOCIAL, RUT…), así
   esas plantillas se reconocen solas; los sinónimos permiten reconocer
   marcas escritas a mano, como [RAZÓN SOCIAL DE LA EMPRESA] o [RUT EMPRESA].

   Cada marca de la plantilla tiene una fuente (plantillas_documento.mapa_campos):
     <CLAVE>      un dato de DATOS
     _tienda      lo responde el comprador en la tienda
     _ejecutivo   lo completa el personal al generar
     _ignorar     queda tal cual en el documento
   ========================================================= */

const SERVICIOS_EN_PLANTILLA = 3;   // la plantilla de contrato trae SERVICIO_1..3

// 'Razón Social de la Empresa' / '[RAZON_SOCIAL]' -> 'RAZON SOCIAL DE LA EMPRESA'
const normal = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/^\[|\]$/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();

const mayus = (s) => (s === null || s === undefined ? '' : String(s).toLocaleUpperCase('es-CL'));
// 'Región Metropolitana' -> 'METROPOLITANA' (el contrato ya dice "región ...")
const region = (s) => mayus(String(s || '').replace(/^regi[oó]n\s+(de\s+la\s+|de\s+los\s+|del\s+|de\s+)?/i, ''));
const miles = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('es-CL'));

/* ---------- Monto en palabras (pesos chilenos) ---------- */
const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece',
  'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos',
  'ochocientos', 'novecientos'];

function hasta999(n) {
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100), r = n % 100;
  const resto = r < 30 ? UNIDADES[r] : DECENAS[Math.floor(r / 10)] + (r % 10 ? ' y ' + UNIDADES[r % 10] : '');
  return [CENTENAS[c], resto].filter(Boolean).join(' ');
}
// 'uno' -> 'un' delante de "mil", "millón" y "pesos"
const apocope = (s) => s.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');

function enPalabras(monto) {
  let n = Math.round(Number(monto));
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'cero pesos';
  if (n === 1) return 'un peso';
  const partes = [];
  const millones = Math.floor(n / 1e6); n %= 1e6;
  const miles_ = Math.floor(n / 1000); const resto = n % 1000;
  if (millones) partes.push(millones === 1 ? 'un millón' : `${apocope(hasta999(millones))} millones`);
  if (miles_) partes.push(miles_ === 1 ? 'mil' : `${apocope(hasta999(miles_))} mil`);
  if (resto) partes.push(apocope(hasta999(resto)));
  return `${partes.join(' ')}${!miles_ && !resto && millones ? ' de' : ''} pesos`;
}

/* ---------- Diccionario de datos ---------- */
// [clave, etiqueta, grupo, sinónimos, valor(d, servicios)]
const D = [
  ['RAZON_SOCIAL', 'Razón social o nombre del cliente', 'Cliente',
    ['RAZON SOCIAL DE LA EMPRESA', 'NOMBRE O RAZON SOCIAL', 'NOMBRE DE LA EMPRESA', 'NOMBRE EMPRESA', 'EMPRESA', 'CLIENTE', 'NOMBRE DEL CLIENTE'],
    (d) => mayus(d.cliente_razon_social)],
  ['RUT', 'RUT del cliente', 'Cliente', ['RUT EMPRESA', 'RUT DE LA EMPRESA', 'RUT CLIENTE', 'RUT DEL CLIENTE'], (d) => d.cliente_rut],
  ['GIRO_PRINCIPAL', 'Giro', 'Cliente', ['GIRO'], (d) => mayus(d.cliente_giro)],
  ['MAIL', 'Correo del cliente', 'Cliente', ['CORREO', 'CORREO ELECTRONICO', 'EMAIL', 'E MAIL'], (d) => d.cliente_email || ''],
  ['CELULAR_8_DIGITOS', 'Celular del cliente', 'Cliente', ['CELULAR', 'TELEFONO'], (d) => d.cliente_celular || ''],
  ['DOMICILIO_CLIENTE', 'Domicilio del cliente', 'Cliente',
    ['DOMICILIO EMPRESA', 'DOMICILIO DE LA EMPRESA', 'DOMICILIO CLIENTE', 'DIRECCION EMPRESA', 'DIRECCION CLIENTE'], (d) => mayus(d.cliente_domicilio)],
  ['COMUNA_CLIENTE', 'Comuna del cliente', 'Cliente', ['COMUNA EMPRESA', 'COMUNA DE LA EMPRESA'], (d) => mayus(d.cliente_comuna)],
  ['REGION_CLIENTE', 'Región del cliente', 'Cliente', ['REGION EMPRESA', 'REGION DE LA EMPRESA'], (d) => region(d.cliente_region)],
  ['COMPARECENCIA', 'Comparecencia completa del cliente', 'Cliente', ['COMPARECENCIA CLIENTE'], (d) => d.cliente_comparecencia || ''],
  ['FECHA_ESCRITURAESTATUTO_ACTUALIZADO', 'Fecha de escritura o estatuto', 'Cliente', ['FECHA ESCRITURA', 'FECHA DE ESCRITURA'], (d) => d.cliente_fecha_escritura || ''],
  ['SITIONOTARIA', 'Sitio web o notaría', 'Cliente', ['NOTARIA', 'SITIO NOTARIA'], (d) => d.cliente_sitio_notaria || ''],

  ['REPRESENTANTE_LEGAL', 'Nombre del representante legal', 'Representante legal',
    ['NOMBRE REPRESENTANTE', 'NOMBRE REPRESENTANTE LEGAL', 'NOMBRE DEL REPRESENTANTE', 'REPRESENTANTE'], (d) => mayus(d.cliente_rep_nombre)],
  ['RUT_REP_LEGAL', 'RUT del representante', 'Representante legal', ['RUT REPRESENTANTE', 'RUT REPRESENTANTE LEGAL', 'RUT DEL REPRESENTANTE'], (d) => d.cliente_rep_rut || ''],
  ['DOMIC_REP_LEGAL', 'Domicilio del representante', 'Representante legal', ['DOMICILIO REPRESENTANTE', 'DOMICILIO DEL REPRESENTANTE'], (d) => mayus(d.cliente_rep_domicilio)],
  ['COMUNA_REP_LEGAL', 'Comuna del representante', 'Representante legal', ['COMUNA REPRESENTANTE'], (d) => mayus(d.cliente_rep_comuna)],
  ['REGION_REP_LEGAL', 'Región del representante', 'Representante legal', ['REGION REPRESENTANTE'], (d) => region(d.cliente_rep_region)],

  ['FOLIO', 'Folio del contrato', 'Contrato', ['NUMERO DE CONTRATO', 'N CONTRATO'], (d) => d.folio],
  ['FECHA_CONTRATO', 'Fecha del contrato', 'Contrato', ['FECHA', 'FECHA DEL CONTRATO', 'FECHA DE CELEBRACION'], (d) => d.fecha_celebracion || ''],
  ['LUGAR', 'Lugar de celebración', 'Contrato', ['CIUDAD', 'COMUNA', 'LUGAR DE CELEBRACION'], (d) => d.lugar_celebracion || ''],
  ['FECHA_DE_INICIO', 'Fecha de inicio', 'Contrato', ['FECHA INICIO', 'INICIO'], (d) => d.fecha_inicio],
  ['VENCIMIENTO', 'Fecha de vencimiento', 'Contrato', ['FECHA TERMINO', 'FECHA DE TERMINO', 'FECHA VENCIMIENTO', 'TERMINO'], (d) => d.fecha_vencimiento],
  ['DURACION', 'Duración ("(12 MESES)")', 'Contrato', ['PLAZO', 'DURACION DEL CONTRATO'], (d) => d.duracion],
  ['SERVICIOS', 'Servicios contratados', 'Contrato', ['SERVICIOS CONTRATADOS'], (d) => mayus(d.servicios)],
  ['MONTO_TOTAL', 'Monto total ($ con puntos)', 'Contrato', ['MONTO', 'VALOR', 'PRECIO', 'TOTAL', 'PRECIO TOTAL', 'VALOR TOTAL'],
    (d, s) => miles(s.reduce((t, x) => t + Number(x.precio || 0), 0))],
  ['MONTO_EN_PALABRAS', 'Monto total en palabras', 'Contrato', ['MONTO EN PALABRAS', 'VALOR EN PALABRAS'],
    (d, s) => enPalabras(s.reduce((t, x) => t + Number(x.precio || 0), 0))],
  ['BANCOLINK', 'Medio de pago', 'Contrato', ['MEDIO DE PAGO', 'FORMA DE PAGO', 'TRANSFERENCIA BANCARIA OTRO MEDIO'], (d) => d.medio_pago || ''],

  ['SUCURSAL', 'Dirección de la sucursal', 'Sucursal', ['DIRECCION SUCURSAL'], (d) => mayus(d.sucursal_direccion)],
  ['COMUNA_SUCURSAL', 'Comuna de la sucursal', 'Sucursal', [], (d) => mayus(d.sucursal_comuna)],
  ['REGION_SUCURSAL', 'Región de la sucursal', 'Sucursal', [], (d) => region(d.sucursal_region)],
  ['ROL_PROPIEDAD', 'Rol de la propiedad', 'Sucursal', ['ROL'], (d) => d.rol_propiedad || ''],

  ['EMISORA_RAZON_SOCIAL', 'Razón social de Easy Office', 'Easy Office', [], (d) => mayus(d.emisora_razon_social)],
  ['EMISORA_RUT', 'RUT de Easy Office', 'Easy Office', [], (d) => d.emisora_rut || ''],
  ['EMISORA_REPRESENTANTE', 'Representante de Easy Office', 'Easy Office', [], (d) => mayus(d.emisora_rep_nombre)],
  ['EMISORA_RUT_REPRESENTANTE', 'RUT del representante de Easy Office', 'Easy Office', [], (d) => d.emisora_rep_rut || '']
];

for (let i = 1; i <= SERVICIOS_EN_PLANTILLA; i++) {
  const s = (lista) => lista[i - 1];
  D.push(
    [`SERVICIO_${i}`, `Servicio ${i}: nombre`, 'Servicios', [], (d, l) => (s(l) ? mayus(s(l).servicio) : '')],
    [`PRECIO_SS_${i}`, `Servicio ${i}: precio`, 'Servicios', [], (d, l) => (s(l) ? miles(s(l).precio) : '')],
    [`CICLO_PAGO_SS_${i}`, `Servicio ${i}: ciclo de pago`, 'Servicios', [], (d, l) => (s(l) ? s(l).ciclo : '')],
    [`DESCRIPCION_SS_${i}`, `Servicio ${i}: descripción`, 'Servicios', [], (d, l) => (s(l) ? (s(l).contenido || '') : '')]
  );
}

const DATOS = D.map(([clave, etiqueta, grupo, sinonimos, valor]) => ({ clave, etiqueta, grupo, sinonimos, valor }));
const POR_NOMBRE = new Map();
for (const d of DATOS) [d.clave, ...d.sinonimos].forEach((n) => POR_NOMBRE.set(normal(n), d.clave));

const FUENTES = ['_tienda', '_ejecutivo', '_ignorar'];
const esFuenteValida = (dato) => FUENTES.includes(dato) || DATOS.some((d) => d.clave === dato);

// Fuente sugerida para una marca: el dato con ese nombre o sinónimo; si no, lo completa el personal
function sugerir(marca) {
  const dato = POR_NOMBRE.get(normal(marca));
  return dato ? { dato } : { dato: '_ejecutivo', etiqueta: etiquetaDe(marca) };
}

// '[FECHA TÉRMINO]' -> 'Fecha término'
function etiquetaDe(marca) {
  const t = String(marca).replace(/^\[|\]$/g, '').replace(/_/g, ' ').trim().toLocaleLowerCase('es-CL');
  return t.charAt(0).toLocaleUpperCase('es-CL') + t.slice(1);
}

// Todos los datos de un contrato (fuente = { datos: v_datos_contrato, servicios: v_datos_contrato_servicios })
// Una persona natural comparece por sí: en las plantillas pensadas para empresas, los datos
// del "representante" son los suyos (así no quedan en blanco).
function valores({ datos, servicios }) {
  const d = { ...datos };
  if (d.cliente_tipo_persona === 'natural' && !d.cliente_rep_nombre) {
    Object.assign(d, {
      cliente_rep_nombre: d.cliente_razon_social, cliente_rep_rut: d.cliente_rut, cliente_rep_domicilio: d.cliente_domicilio,
      cliente_rep_comuna: d.cliente_comuna, cliente_rep_region: d.cliente_region
    });
  }
  return Object.fromEntries(DATOS.map((x) => [x.clave, x.valor(d, servicios) ?? '']));
}

/*
 * Arma la función que entrega el texto de cada marca del Word.
 *   marcas:     [{ marca, tipo }] de word.marcas()
 *   mapa:       plantillas_documento.mapa_campos (lo que no está, se sugiere)
 *   val:        valores(fuente)
 *   respuestas: { marca: texto } de la tienda o del personal
 * pendientes: marcas que necesitan un dato que nadie entregó (el documento no se puede entregar solo).
 */
function resolver(marcas, mapa, val, respuestas = {}) {
  const fuentes = new Map(marcas.map(({ marca, tipo }) => [marca, { tipo, ...(mapa?.[marca] || sugerir(marca)) }]));
  const pendientes = [];
  for (const [marca, f] of fuentes) {
    if ((f.dato === '_tienda' || f.dato === '_ejecutivo') && !String(respuestas[marca] ?? '').trim()) pendientes.push(marca);
  }
  const valor = (marca) => {
    const f = fuentes.get(marca);
    if (!f) return undefined;
    if (f.dato === '_ignorar') return f.tipo === 'campo' ? '' : undefined;
    if (f.dato === '_tienda' || f.dato === '_ejecutivo') {
      const r = String(respuestas[marca] ?? '').trim();
      return r || undefined;
    }
    return val[f.dato] ?? '';
  };
  return { valor, pendientes, fuentes };
}

// Marcas que se preguntan (en la tienda o al personal), con su etiqueta
function preguntas(marcas, mapa, fuente) {
  return marcas
    .map(({ marca, tipo }) => ({ marca, tipo, ...(mapa?.[marca] || sugerir(marca)) }))
    .filter((m) => m.dato === fuente || (fuente === '_ejecutivo' && m.dato === '_tienda'))
    .map((m) => ({ marca: m.marca, etiqueta: m.etiqueta || etiquetaDe(m.marca), fuente: m.dato }));
}

module.exports = {
  DATOS: DATOS.map(({ clave, etiqueta, grupo }) => ({ clave, etiqueta, grupo })),
  SERVICIOS_EN_PLANTILLA, FUENTES, normal, sugerir, etiquetaDe, esFuenteValida, valores, resolver, preguntas, enPalabras
};
