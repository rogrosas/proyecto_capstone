/* =========================================================
   CAPA DE DATOS · Combinación de correspondencia en archivos Word.
   Reemplaza por texto fijo:
     - los campos MERGEFIELD de la plantilla (los mismos que hoy se
       llenan desde el Excel), y
     - las marcas entre corchetes escritas en el texto ([RUT EMPRESA]).
   y quita el enlace al Excel, así el .docx generado abre como un
   documento normal.
   ========================================================= */
const PizZip = require('pizzip');
const { errores } = require('../comun/errores');

const PARTES = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

const escaparXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textoDe = (xml) => xml.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// ' MERGEFIELD "REGIÓN_SUCURSAL" \* MERGEFORMAT ' -> 'REGIÓN_SUCURSAL'
function nombreCampo(instr) {
  const m = /^\s*MERGEFIELD\s+(?:"([^"]+)"|(\S+))/i.exec(instr);
  return m ? (m[1] || m[2]) : null;
}

// Un run de Word con el texto (los saltos de línea pasan a <w:br/>)
function run(rPr, valor) {
  const lineas = String(valor).split(/\r?\n/);
  return `<w:r>${rPr}${lineas.map((l) => `<w:t xml:space="preserve">${escaparXml(l)}</w:t>`).join('<w:br/>')}</w:r>`;
}

/*
 * Recorre los runs de una parte XML y ubica cada campo complejo
 * (begin → instrucción → separate → resultado → end). Devuelve los campos
 * MERGEFIELD de primer nivel que no cruzan párrafos, con su formato.
 */
function camposComplejos(xml) {
  const encontrados = [];
  const pila = [];
  const reRun = /<w:r[ >][\s\S]*?<\/w:r>/g;
  let m;
  while ((m = reRun.exec(xml))) {
    const r = m[0];
    const rPr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r) || [''])[0];
    if (r.includes('w:fldCharType="begin"')) {
      if (pila.length) pila[pila.length - 1].anidado = true;
      pila.push({ inicio: m.index, instr: '', separado: false, rPr, rPrResultado: null, anidado: false });
      continue;
    }
    const f = pila[pila.length - 1];
    if (!f) continue;
    if (!f.separado && r.includes('<w:instrText')) f.instr += textoDe((r.match(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g) || []).join(''));
    if (r.includes('w:fldCharType="separate"')) f.separado = true;
    else if (r.includes('w:fldCharType="end"')) {
      pila.pop();
      const fin = m.index + r.length;
      const nombre = nombreCampo(f.instr);
      if (nombre && !f.anidado && !pila.length && !xml.slice(f.inicio, fin).includes('</w:p>')) {
        encontrados.push({ inicio: f.inicio, fin, nombre, rPr: f.rPrResultado ?? f.rPr });
      }
    } else if (f.separado && f.rPrResultado === null && r.includes('<w:t')) f.rPrResultado = rPr;
  }
  return encontrados;
}

const reSimple = /<w:fldSimple\b[^>]*w:instr="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/w:fldSimple>)/g;

function abrir(buffer) {
  try {
    const zip = new PizZip(buffer);
    if (!zip.file('word/document.xml')) throw new Error('sin word/document.xml');
    return zip;
  } catch {
    throw errores.solicitudInvalida('El archivo no es un documento Word (.docx) válido.');
  }
}

const partes = (zip) => Object.keys(zip.files).filter((n) => PARTES.test(n));

// Nombres de los campos MERGEFIELD de la plantilla, sin repetir y en orden de aparición
function campos(buffer) {
  const zip = abrir(buffer);
  const nombres = [];
  for (const p of partes(zip)) {
    const xml = zip.file(p).asText();
    camposComplejos(xml).forEach((c) => nombres.push(c.nombre));
    for (const s of xml.matchAll(reSimple)) { const n = nombreCampo(textoDe(s[1])); if (n) nombres.push(n); }
  }
  return [...new Set(nombres)];
}

/* ---------- Marcas entre corchetes: [RAZÓN SOCIAL DE LA EMPRESA] ---------- */
// Con al menos una letra y sin saltos de línea; "[X]" también es una marca (puede ignorarse)
const RE_CORCHETE = /\[([^[\]\n]{1,80})\]/g;
const esMarca = (interior) => /\p{L}/u.test(interior);

/*
 * Word divide el texto de un párrafo en varios runs (<w:t>), así que una marca
 * puede quedar repartida. Se arma el texto del párrafo, se ubican las marcas
 * y el reemplazo queda en el primer <w:t> que toca cada marca (con su formato).
 */
function textosDelParrafo(p) {
  const nodos = [];
  let texto = '';
  for (const m of p.matchAll(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>/g)) {
    if (m[1] === undefined) continue;
    const t = textoDe(m[2]);
    nodos.push({ ini: m.index, fin: m.index + m[0].length, desde: texto.length, txt: t });
    texto += t;
  }
  return { nodos, texto };
}

const RE_PARRAFO = /<w:p[ >][\s\S]*?<\/w:p>/g;

function marcasDe(xml) {
  const marcas = [];
  for (const [p] of xml.matchAll(RE_PARRAFO)) {
    const { texto } = textosDelParrafo(p);
    for (const m of texto.matchAll(RE_CORCHETE)) if (esMarca(m[1])) marcas.push(m[0]);
  }
  return marcas;
}

function reemplazarCorchetes(xml, valor) {
  return xml.replace(RE_PARRAFO, (p) => {
    const { nodos, texto } = textosDelParrafo(p);
    if (!texto.includes('[')) return p;
    const cambios = [];
    for (const m of texto.matchAll(RE_CORCHETE)) {
      if (!esMarca(m[1])) continue;
      const v = valor(m[0]);
      if (v !== undefined && v !== null) cambios.push({ a: m.index, b: m.index + m[0].length, v: String(v) });
    }
    if (!cambios.length) return p;
    let salida = p;
    for (const n of nodos.slice().reverse()) {
      let nuevo = '';
      for (let i = n.desde; i < n.desde + n.txt.length; i++) {
        const c = cambios.find((x) => i >= x.a && i < x.b);
        if (!c) nuevo += texto[i];
        else if (i === c.a) nuevo += c.v;
      }
      if (nuevo === n.txt) continue;
      salida = salida.slice(0, n.ini) + `<w:t xml:space="preserve">${escaparXml(nuevo)}</w:t>` + salida.slice(n.fin);
    }
    return salida;
  });
}

/*
 * Todo lo que se puede completar en la plantilla, en orden de aparición y sin repetir:
 * [{ marca: 'RAZON_SOCIAL', tipo: 'campo' }, { marca: '[RUT EMPRESA]', tipo: 'corchete' }]
 */
function marcas(buffer) {
  const zip = abrir(buffer);
  const vistas = new Map();
  for (const p of partes(zip)) {
    const xml = zip.file(p).asText();
    camposComplejos(xml).forEach((c) => vistas.has(c.nombre) || vistas.set(c.nombre, 'campo'));
    for (const s of xml.matchAll(reSimple)) { const n = nombreCampo(textoDe(s[1])); if (n && !vistas.has(n)) vistas.set(n, 'campo'); }
    marcasDe(xml).forEach((m) => vistas.has(m) || vistas.set(m, 'corchete'));
  }
  return [...vistas].map(([marca, tipo]) => ({ marca, tipo }));
}

/*
 * valor(marca) devuelve el texto, '' para dejarlo vacío, o undefined si no se conoce:
 * un campo de combinación queda como [NOMBRE] y se informa; una marca entre corchetes
 * queda tal cual en el documento.
 */
function combinar(buffer, valor) {
  const zip = abrir(buffer);
  const desconocidos = new Set();
  const texto = (nombre) => {
    const v = valor(nombre);
    if (v === undefined) { desconocidos.add(nombre); return `[${nombre}]`; }
    return v ?? '';
  };
  const corchete = (marca) => {
    const v = valor(marca);
    if (v === undefined) desconocidos.add(marca);
    return v;
  };

  for (const p of partes(zip)) {
    // Primero los corchetes: así un campo desconocido que queda como [NOMBRE] no se confunde con una marca
    let xml = reemplazarCorchetes(zip.file(p).asText(), corchete);
    for (const c of camposComplejos(xml).reverse()) {
      xml = xml.slice(0, c.inicio) + run(c.rPr, texto(c.nombre)) + xml.slice(c.fin);
    }
    xml = xml.replace(reSimple, (todo, instr, interior = '') => {
      const nombre = nombreCampo(textoDe(instr));
      if (!nombre) return todo;
      const rPr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(interior) || [''])[0];
      return run(rPr, texto(nombre));
    });
    zip.file(p, xml);
  }

  // Desvincula la combinación: sin esto Word pide reconectar con el Excel al abrir.
  const settings = zip.file('word/settings.xml');
  if (settings) zip.file('word/settings.xml', settings.asText().replace(/<w:mailMerge>[\s\S]*?<\/w:mailMerge>/g, ''));
  const rels = zip.file('word/_rels/settings.xml.rels');
  if (rels) {
    zip.file('word/_rels/settings.xml.rels', rels.asText()
      .replace(/<Relationship\b[^>]*Type="[^"]*\/(mailMergeSource|recipientData)"[^>]*\/>/g, ''));
  }

  return {
    buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    desconocidos: [...desconocidos]
  };
}

module.exports = { campos, marcas, combinar };
