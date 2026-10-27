/* =========================================================
   CAPA DE DATOS · Combinación de correspondencia en archivos Word.
   Reemplaza los campos MERGEFIELD de la plantilla (los mismos que hoy
   se llenan desde el Excel) por texto fijo y quita el enlace al Excel,
   así el .docx generado abre como un documento normal.
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

/*
 * valor(nombre) devuelve el texto del campo, '' para dejarlo vacío,
 * o undefined si no se conoce (queda como [NOMBRE] y se informa).
 */
function combinar(buffer, valor) {
  const zip = abrir(buffer);
  const desconocidos = new Set();
  const texto = (nombre) => {
    const v = valor(nombre);
    if (v === undefined) { desconocidos.add(nombre); return `[${nombre}]`; }
    return v ?? '';
  };

  for (const p of partes(zip)) {
    let xml = zip.file(p).asText();
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

module.exports = { campos, combinar };
