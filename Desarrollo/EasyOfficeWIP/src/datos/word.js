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

/* ---------- Marca de agua (borrador que se envía por correo) ---------- */
const NS_VML = {
  'xmlns:v': 'urn:schemas-microsoft-com:vml',
  'xmlns:o': 'urn:schemas-microsoft-com:office:office',
  'xmlns:w10': 'urn:schemas-microsoft-com:office:word',
  'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
};
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const T_HEADER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';

// La misma forma que usa Word en "Diseño → Marca de agua": texto diagonal detrás del contenido, centrado en la página
function runMarca(texto, n) {
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:pict><v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype><v:shape id="BorradorEasyOffice${n}" o:spid="_x0000_s${2049 + n}" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:468pt;height:117pt;rotation:315;z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="#C83232" stroked="f"><v:fill opacity=".22"/><v:textpath style="font-family:&quot;Arial&quot;;font-size:1pt;font-weight:bold" string="${escaparXml(texto)}"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>`;
}

// Declara en la raíz de la parte los espacios de nombres VML que falten
function conNamespaces(xml, raiz) {
  return xml.replace(new RegExp(`<${raiz}\\b[^>]*>`), (tag) => {
    const faltan = Object.entries(NS_VML).filter(([k]) => !tag.includes(`${k}=`)).map(([k, v]) => ` ${k}="${v}"`).join('');
    return tag.replace(/>$/, `${faltan}>`);
  });
}

/*
 * Copia del Word con una marca de agua diagonal en todas las páginas (en los encabezados).
 * Si una sección no tiene encabezado, se le crea uno solo con la marca.
 */
function marcaDeAgua(buffer, texto = 'BORRADOR') {
  const zip = abrir(buffer);
  let doc = zip.file('word/document.xml').asText();
  const relsF = 'word/_rels/document.xml.rels';
  let rels = zip.file(relsF)?.asText() || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const objetivo = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(([r]) => [
    (/\bId="([^"]+)"/.exec(r) || [])[1], { tipo: (/\bType="([^"]+)"/.exec(r) || [])[1], destino: (/\bTarget="([^"]+)"/.exec(r) || [])[1] }]));

  // La primera sección sin encabezado propio: se le crea uno (las siguientes heredan el anterior)
  const sectPrs = doc.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g) || [];
  if (sectPrs.length && !/<w:headerReference\b/.test(sectPrs[0])) {
    const id = 'rIdBorradorEO';
    zip.file('word/headerBorradorEO.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${NS_W}"${Object.entries(NS_VML).map(([k, v]) => ` ${k}="${v}"`).join('')}><w:p></w:p></w:hdr>`);
    rels = rels.replace('</Relationships>', `<Relationship Id="${id}" Type="${T_HEADER}" Target="headerBorradorEO.xml"/></Relationships>`);
    objetivo[id] = { tipo: T_HEADER, destino: 'headerBorradorEO.xml' };
    const tipos = zip.file('[Content_Types].xml').asText();
    if (!tipos.includes('/word/headerBorradorEO.xml')) {
      zip.file('[Content_Types].xml', tipos.replace('</Types>',
        '<Override PartName="/word/headerBorradorEO.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'));
    }
    doc = doc.replace(sectPrs[0], sectPrs[0].replace(/(<w:sectPr\b[^>]*>)/, `$1<w:headerReference w:type="default" r:id="${id}"/>`));
    doc = conNamespaces(doc, 'w:document');
    zip.file('word/document.xml', doc);
    zip.file(relsF, rels);
  }

  // Todas las partes de encabezado que usa el documento llevan la marca, dentro de su primer párrafo
  const partes = new Set([...doc.matchAll(/<w:headerReference\b[^>]*r:id="([^"]+)"/g)]
    .map(([, id]) => objetivo[id]).filter((o) => o && o.tipo === T_HEADER).map((o) => 'word/' + o.destino.replace(/^\/?word\//, '')));
  let n = 0;
  for (const parte of partes) {
    const f = zip.file(parte);
    if (!f) continue;
    let xml = conNamespaces(f.asText(), 'w:hdr');
    const marca = runMarca(texto, n++);
    // Primer párrafo del encabezado: <w:p …/> vacío o <w:p …>[<w:pPr>…</w:pPr>]
    const primero = /<w:p(\s[^>]*?)?(\/?)>((?:<w:pPr>[\s\S]*?<\/w:pPr>)?)/.exec(xml);
    if (!primero) xml = xml.replace('</w:hdr>', `<w:p>${marca}</w:p></w:hdr>`);
    else {
      const [todo, attrs = '', cerrado, pPr] = primero;
      const nuevo = cerrado ? `<w:p${attrs}>${marca}</w:p>${pPr}` : `<w:p${attrs}>${pPr}${marca}`;
      xml = xml.slice(0, primero.index) + nuevo + xml.slice(primero.index + todo.length);
    }
    zip.file(parte, xml);
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/* ---------- Hoja anexa al final del documento (constancia de firma electrónica) ----------
   parrafos: [{ texto, negrita, tamano (pt), centrado }]. Se agregan tras un salto de página. */
function anexar(buffer, parrafos) {
  const zip = abrir(buffer);
  let xml = zip.file('word/document.xml').asText();
  const p = (x) => `<w:p><w:pPr>${x.centrado ? '<w:jc w:val="center"/>' : ''}<w:spacing w:after="120"/></w:pPr>`
    + `<w:r><w:rPr>${x.negrita ? '<w:b/>' : ''}${x.tamano ? `<w:sz w:val="${x.tamano * 2}"/>` : ''}</w:rPr>`
    + `<w:t xml:space="preserve">${escaparXml(x.texto)}</w:t></w:r></w:p>`;
  // La sección final (<w:sectPr> hijo de <w:body>) va siempre al último: los párrafos se insertan antes
  const fin = xml.lastIndexOf('<w:sectPr') > xml.lastIndexOf('</w:p>') ? xml.lastIndexOf('<w:sectPr') : xml.lastIndexOf('</w:body>');
  xml = xml.slice(0, fin) + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + parrafos.map(p).join('') + xml.slice(fin);
  zip.file('word/document.xml', xml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { campos, marcas, combinar, marcaDeAgua, anexar };
