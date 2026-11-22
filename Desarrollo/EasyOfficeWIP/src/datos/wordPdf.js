/* =========================================================
   CAPA DE DATOS · Word (.docx) → PDF solo con JavaScript (pdfmake),
   sin instalar LibreOffice en el servidor.

   Lee el XML del Word (word/document.xml, estilos, encabezado y pie)
   y arma el PDF conservando: tamaño de página y márgenes, secciones
   (saltos de página y texto a varias columnas, que pasa de una columna
   a la otra como en Word), alineación, sangrías, interlineado (con el
   alto de línea de cada fuente de Word) y espacios entre párrafos,
   negrita, cursiva, subrayado, mayúsculas, espaciado entre letras,
   tamaño y color de letra, tablas (celdas combinadas, bordes celda por
   celda, alto de fila), imágenes PNG/JPG (también giradas), enlaces,
   listas, encabezado y pie de página.
   No conserva: formas y cuadros de texto, imágenes EMF/WMF ni las
   fuentes exactas: usa Times, Helvetica y Courier (las estándar de PDF);
   Calibri se aproxima juntando un poco las letras, así que en algún
   párrafo una palabra puede pasar a la línea siguiente.
   ========================================================= */
const PizZip = require('pizzip');
const PdfPrinter = require('pdfmake');

/* ---------- XML mínimo (el de Word siempre está bien formado) ---------- */
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTIDADES[e] ?? m));

function parsear(xml) {
  const raiz = { n: '#raiz', a: {}, c: [] };
  const pila = [raiz];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const tope = pila[pila.length - 1];
    if (m[1] !== undefined) tope.c.push({ n: '#texto', t: m[1] });
    else if (m[6] !== undefined) { if (tope.n === 'w:t' || tope.n === 'w:instrText') tope.c.push({ n: '#texto', t: decodificar(m[6]) }); }
    else if (m[3]) {
      if (m[2]) { if (pila.length > 1) pila.pop(); continue; }
      const a = {};
      for (const x of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) a[x[1]] = decodificar(x[2] ?? x[3]);
      const nodo = { n: m[3], a, c: [] };
      tope.c.push(nodo);
      if (!m[5]) pila.push(nodo);
    }
  }
  return raiz;
}
const hijo = (nodo, nombre) => nodo?.c.find((x) => x.n === nombre);
const hijos = (nodo, nombre) => (nodo?.c || []).filter((x) => x.n === nombre);
const textoDe = (nodo) => (nodo.n === '#texto' ? nodo.t : nodo.c.map(textoDe).join(''));
function buscar(nodo, nombre, salida = []) {
  for (const x of nodo?.c || []) { if (x.n === nombre) salida.push(x); buscar(x, nombre, salida); }
  return salida;
}
const val = (nodo) => nodo?.a['w:val'];
const encendido = (nodo) => Boolean(nodo) && !['0', 'false', 'off', 'none'].includes(val(nodo));
const pt = (twips) => (Number(twips) || 0) / 20;

/* ---------- Fuentes: las estándar de PDF (no ocupan espacio) ---------- */
const FUENTES = {
  Times: { normal: 'Times-Roman', bold: 'Times-Bold', italics: 'Times-Italic', bolditalics: 'Times-BoldItalic' },
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
  Courier: { normal: 'Courier', bold: 'Courier-Bold', italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique' }
};
// Fuentes del documento según su word/fontTable.xml: qué fuente usa Word si falta una (w:altName)
// y de qué tipo es (serif, sans, ancho fijo). La conversión es sincrónica: se fija por documento.
let tablaFuentes = {};
const CONOCIDAS = /times|cambria|georgia|garamond|book antiqua|palatino|minion|courier|consolas|arial|helvetica|calibri|carlito|aptos|segoe|verdana|tahoma|liberation|caladea/i;
function leerTablaFuentes(zip) {
  const xml = zip.file('word/fontTable.xml')?.asText() || '';
  const tabla = {};
  for (const m of xml.matchAll(/<w:font w:name="([^"]*)"[^>]*>([\s\S]*?)<\/w:font>/g)) {
    tabla[decodificar(m[1]).toLowerCase()] = {
      alt: decodificar(m[2].match(/<w:altName w:val="([^"]*)"/)?.[1] || ''),
      tipo: m[2].match(/<w:family w:val="([^"]*)"/)?.[1],
      fija: /<w:pitch w:val="fixed"/.test(m[2])
    };
  }
  return tabla;
}
// Fuente que se ve en Word: la misma si es conocida; si no, su reemplazo (w:altName). Ej. gobCL → Calibri
const fuenteReal = (nombre) => {
  if (!nombre || CONOCIDAS.test(nombre)) return nombre;
  const t = tablaFuentes[nombre.toLowerCase()];
  return t?.alt || nombre;
};
const familia = (original) => {
  if (!original) return null;
  const nombre = fuenteReal(original);
  if (/courier|consolas|mono/i.test(nombre)) return 'Courier';
  if (/times|cambria|caladea|georgia|garamond|book|serif|roman|minion|palatino/i.test(nombre) && !/sans/i.test(nombre)) return 'Times';
  if (CONOCIDAS.test(nombre)) return 'Helvetica';
  // Desconocida y sin reemplazo: por su tipo en la tabla de fuentes
  const t = tablaFuentes[nombre.toLowerCase()];
  if (t?.fija) return 'Courier';
  if (t?.tipo === 'roman') return 'Times';
  return 'Helvetica';
};
// Las fuentes estándar solo traen los caracteres de Windows-1252
const CP1252 = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const limpiar = (s) => s.replace(/[ ]/g, ' ').replace(/[‐‑‒]/g, '-').replace(/−/g, '-')
  .replace(/[^\n\t\x20-\x7e¡-ÿ]/g, (c) => (CP1252.has(c) ? c : (c === '­' ? '' : '?')));

/* ---------- Estilos del Word (párrafo y carácter, con herencia) ---------- */
function leerEstilos(zip) {
  const xml = zip.file('word/styles.xml')?.asText();
  const estilos = {}, defecto = { p: {}, r: {} };
  if (!xml) return { estilos, defecto, tablaPropiedad: () => null };
  const raiz = parsear(xml);
  const st = hijo(raiz, 'w:styles');
  const dd = hijo(st, 'w:docDefaults');
  defecto.r = propsRun(hijo(hijo(dd, 'w:rPrDefault'), 'w:rPr'), {});
  defecto.p = propsParrafo(hijo(hijo(dd, 'w:pPrDefault'), 'w:pPr'), {});
  for (const s of hijos(st, 'w:style')) {
    estilos[s.a['w:styleId']] = { tipo: s.a['w:type'], base: val(hijo(s, 'w:basedOn')), pPr: hijo(s, 'w:pPr'), rPr: hijo(s, 'w:rPr'), tblPr: hijo(s, 'w:tblPr'), defecto: s.a['w:default'] === '1' };
  }
  // Propiedades de un estilo incluyendo las de su estilo base
  const resolver = (id, fn, prof = 0) => {
    const e = estilos[id];
    if (!e || prof > 10) return {};
    return fn(e, resolver(e.base, fn, prof + 1));
  };
  // Una propiedad de tabla (w:tblBorders, w:tblCellMar) del estilo o de sus estilos base
  const tablaPropiedad = (id, nombre) => {
    let e = estilos[id || Object.keys(estilos).find((k) => estilos[k].tipo === 'table' && estilos[k].defecto)], prof = 0;
    while (e && prof++ < 10) { const b = hijo(e.tblPr, nombre); if (b) return b; e = estilos[e.base]; }
    return null;
  };
  const parrafoNormal = Object.keys(estilos).find((k) => estilos[k].tipo === 'paragraph' && estilos[k].defecto);
  return {
    estilos, defecto, tablaPropiedad,
    parrafo: (id) => resolver(id || parrafoNormal, (e, base) => ({ p: propsParrafo(e.pPr, base.p || {}), r: propsRun(e.rPr, base.r || {}) })),
    caracter: (id) => resolver(id, (e, base) => propsRun(e.rPr, base)),
    // Formato que un estilo de tabla da a los párrafos de sus celdas (ej. "Table Grid": sin espacio después)
    tabla: (id) => resolver(id || Object.keys(estilos).find((k) => estilos[k].tipo === 'table' && estilos[k].defecto),
      (e, base) => ({ p: propsParrafo(e.pPr, base.p || {}), r: propsRun(e.rPr, base.r || {}) }))
  };
}

function propsParrafo(pPr, base) {
  const r = { ...base };
  if (!pPr) return r;
  const jc = val(hijo(pPr, 'w:jc'));
  if (jc) r.alineacion = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc] || 'left';
  const sp = hijo(pPr, 'w:spacing');
  if (sp?.a['w:before'] !== undefined) r.antes = pt(sp.a['w:before']);
  if (sp?.a['w:after'] !== undefined) r.despues = pt(sp.a['w:after']);
  if (sp?.a['w:line'] !== undefined) {
    const regla = sp.a['w:lineRule'] || 'auto';
    if (regla === 'auto') { r.interlineado = Number(sp.a['w:line']) / 240; delete r.lineaExacta; delete r.lineaMinima; }
    else if (regla === 'exact') { r.lineaExacta = pt(sp.a['w:line']); delete r.interlineado; delete r.lineaMinima; }
    else { r.lineaMinima = pt(sp.a['w:line']); delete r.lineaExacta; }
  }
  const ind = hijo(pPr, 'w:ind');
  if (ind) {
    if (ind.a['w:left'] ?? ind.a['w:start']) r.izquierda = pt(ind.a['w:left'] ?? ind.a['w:start']);
    if (ind.a['w:right'] ?? ind.a['w:end']) r.derecha = pt(ind.a['w:right'] ?? ind.a['w:end']);
    if (ind.a['w:firstLine']) r.primera = pt(ind.a['w:firstLine']);
    if (ind.a['w:hanging']) r.primera = -pt(ind.a['w:hanging']);
  }
  if (hijo(pPr, 'w:pageBreakBefore') && encendido(hijo(pPr, 'w:pageBreakBefore'))) r.saltoAntes = true;
  return r;
}

function propsRun(rPr, base) {
  const r = { ...base };
  if (!rPr) return r;
  const b = hijo(rPr, 'w:b'); if (b) r.bold = encendido(b);
  const i = hijo(rPr, 'w:i'); if (i) r.italics = encendido(i);
  const u = hijo(rPr, 'w:u'); if (u) r.subrayado = encendido(u);
  const s = hijo(rPr, 'w:strike'); if (s) r.tachado = encendido(s);
  const caps = hijo(rPr, 'w:caps'); if (caps) r.mayusculas = encendido(caps);
  const sz = val(hijo(rPr, 'w:sz')); if (sz) r.tam = Number(sz) / 2;
  const color = val(hijo(rPr, 'w:color')); if (color && /^[0-9a-f]{6}$/i.test(color)) r.color = '#' + color;
  const f = hijo(rPr, 'w:rFonts');
  if (f) {
    const n = f.a['w:ascii'] || f.a['w:hAnsi'];
    if (n) { r.fuente = familia(n); r.nombreFuente = fuenteReal(n); delete r.temaFuente; }
    else if (f.a['w:asciiTheme']) { r.temaFuente = f.a['w:asciiTheme']; delete r.fuente; delete r.nombreFuente; }
  }
  const va = val(hijo(rPr, 'w:vertAlign')); if (va) r.vert = va;
  // Espaciado entre caracteres (expandido o comprimido), en veinteavos de punto
  const esp = val(hijo(rPr, 'w:spacing')); if (esp !== undefined) r.espaciado = Number(esp) / 20 || 0;
  const vanish = hijo(rPr, 'w:vanish'); if (vanish) r.oculto = encendido(vanish);
  return r;
}

// Trozos seguidos con el mismo formato van juntos: si no, al justificar pdfmake separa una palabra
// que en el Word está partida en varios trozos (ej. "VALPARA" + "ÍSO")
function unirTrozos(trozos) {
  const clave = (t) => JSON.stringify({ ...t, text: undefined });
  for (let i = trozos.length - 1; i > 0; i--) {
    if (clave(trozos[i]) === clave(trozos[i - 1])) { trozos[i - 1].text += trozos[i].text; trozos.splice(i, 1); }
  }
}

// Alto de línea: pdfmake usa ascendente − descendente de la fuente estándar del PDF; Word, el de la
// fuente original (con su espacio entre líneas). lineHeight = alto en Word / alto en pdfmake.
const LINEA_PDF = { Times: 0.9, Helvetica: 0.925, Courier: 0.786 };
// Word usa usWinAscent + usWinDescent de cada fuente (sin el lineGap): Times New Roman 1,107; Arial 1,117...
const LINEA_WORD = [
  [/times/i, 1.107], [/arial|helvetica|liberation sans/i, 1.117], [/calibri|carlito/i, 1.221], [/cambria|caladea/i, 1.172],
  [/aptos/i, 1.2], [/segoe/i, 1.33], [/courier/i, 1.133], [/consolas/i, 1.17], [/georgia/i, 1.136], [/verdana/i, 1.215],
  [/tahoma/i, 1.207], [/garamond/i, 1.12], [/century/i, 1.18], [/book antiqua|palatino/i, 1.17]
];
const lineaWord = (nombre) => (LINEA_WORD.find(([re]) => re.test(nombre || ''))?.[1] ?? 1.17);

/* ---------- Conversión ---------- */
class Conversor {
  constructor(zip) {
    this.zip = zip;
    tablaFuentes = leerTablaFuentes(zip);
    this.estilos = leerEstilos(zip);
    this.temas = this.leerTema();
    this.fuenteBase = this.fuenteDe(this.estilos.defecto.r) || 'Helvetica';
    this.tamBase = this.estilos.defecto.r.tam || 11;
  }

  fecha() {
    const xml = this.zip.file('docProps/core.xml')?.asText() || '';
    const f = new Date(xml.match(/<dcterms:modified[^>]*>([^<]+)</)?.[1] || xml.match(/<dcterms:created[^>]*>([^<]+)</)?.[1] || '2026-01-01T00:00:00Z');
    return Number.isNaN(f.getTime()) ? new Date('2026-01-01T00:00:00Z') : f;
  }

  leerTema() {
    const xml = this.zip.file('word/theme/theme1.xml')?.asText() || '';
    const mayor = xml.match(/<a:majorFont>\s*<a:latin typeface="([^"]*)"/)?.[1];
    const menor = xml.match(/<a:minorFont>\s*<a:latin typeface="([^"]*)"/)?.[1];
    return { major: mayor, minor: menor };
  }

  fuenteDe(r) {
    if (r.fuente) return r.fuente;
    if (r.temaFuente) return familia(/major/i.test(r.temaFuente) ? this.temas.major : this.temas.minor);
    return null;
  }

  // Nombre de la fuente en el Word (para su alto de línea)
  nombreFuenteDe(r) {
    if (r.nombreFuente) return r.nombreFuente;
    if (r.temaFuente) return fuenteReal(/major/i.test(r.temaFuente) ? this.temas.major : this.temas.minor);
    return this.temas.minor || 'Calibri';
  }

  // lineHeight de pdfmake para que el párrafo ocupe lo mismo que en Word
  altoLinea(props, run, fuente, tam) {
    const pdf = LINEA_PDF[fuente] || 0.9;
    if (props.lineaExacta) return props.lineaExacta / (pdf * tam);
    const word = lineaWord(this.nombreFuenteDe(run)) * Math.max(0.5, Math.min(props.interlineado || 1, 4));
    const minimo = props.lineaMinima ? props.lineaMinima / tam : 0;
    return Math.max(word, minimo) / pdf;
  }

  relaciones(parte) {
    const dir = parte.slice(0, parte.lastIndexOf('/') + 1);
    const rels = this.zip.file(`${dir}_rels/${parte.slice(dir.length)}.rels`)?.asText() || '';
    const mapa = {};
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = m[1].match(/Id="([^"]*)"/)?.[1], destino = m[1].match(/Target="([^"]*)"/)?.[1];
      const externo = /TargetMode="External"/.test(m[1]);
      if (id && destino) mapa[id] = externo ? { url: decodificar(destino) } : { ruta: destino.startsWith('/') ? destino.slice(1) : dir + destino.replace(/^\.\//, '') };
    }
    return mapa;
  }

  // Contenido (párrafos y tablas) de una parte del Word: documento, encabezado o pie
  bloques(nodos, rels) {
    const salida = [];
    for (const n of nodos) {
      if (n.n === 'w:p') salida.push(...this.parrafo(n, rels));
      else if (n.n === 'w:tbl') { const t = this.tabla(n, rels); if (t) salida.push(t); }
      else if (n.n === 'w:sdt') salida.push(...this.bloques(hijo(n, 'w:sdtContent')?.c || [], rels));
      else if (['w:ins', 'w:customXml', 'w:smartTag'].includes(n.n)) salida.push(...this.bloques(n.c, rels));
    }
    return salida;
  }

  parrafo(p, rels) {
    const pPr = hijo(p, 'w:pPr');
    const estilo = this.estilos.parrafo(val(hijo(pPr, 'w:pStyle')));
    const enTabla = this.tablaActual || { p: {}, r: {} };
    const props = propsParrafo(pPr, { ...this.estilos.defecto.p, ...enTabla.p, ...estilo.p });
    const runBase = { ...this.estilos.defecto.r, ...enTabla.r, ...estilo.r };
    // Marca de párrafo con su propio formato (afecta párrafos vacíos)
    const marca = propsRun(hijo(pPr, 'w:rPr'), runBase);

    const trozos = [], imagenes = [];
    let saltoDespues = Boolean(this.finDeSeccion?.has(p));
    const estado = { campo: 0, enInstruccion: false };
    const recorrer = (nodos, enlace) => {
      for (const n of nodos) {
        if (n.n === 'w:r') this.run(n, runBase, rels, enlace, trozos, imagenes, estado, () => { saltoDespues = true; });
        else if (n.n === 'w:hyperlink') recorrer(n.c, rels[n.a['r:id']]?.url || enlace);
        else if (['w:ins', 'w:smartTag', 'w:customXml', 'w:fldSimple', 'w:bdo', 'w:dir'].includes(n.n)) recorrer(n.c, enlace);
        else if (n.n === 'w:sdt') recorrer(hijo(n, 'w:sdtContent')?.c || [], enlace);
      }
    };
    recorrer(p.c, null);

    unirTrozos(trozos);
    const numerado = hijo(pPr, 'w:numPr') && val(hijo(hijo(pPr, 'w:numPr'), 'w:numId')) !== '0';
    if (numerado) trozos.unshift({ text: '•  ' });
    // El alto de línea sale de la fuente del primer texto (o de la marca de párrafo si está vacío)
    const primero = trozos.find((t) => String(t.text).trim());
    const primerRun = primero?._run;
    const primerTam = primero?.fontSize;
    for (const t of trozos) delete t._run;
    const fuente = primero?.font || this.fuenteDe(marca) || this.fuenteBase;
    const tam = marca.tam || this.tamBase;
    const margen = [props.izquierda || 0, props.antes || 0, props.derecha || 0, props.despues ?? 0];
    const salida = [];
    const bloque = {
      text: trozos.length ? trozos : ' ', font: fuente, fontSize: tam, alignment: props.alineacion || 'left',
      margin: margen, lineHeight: this.altoLinea(props, primerRun || marca, fuente, primerTam || tam),
      preserveLeadingSpaces: true
    };
    if (props.primera > 0) bloque.leadingIndent = props.primera;
    if (props.saltoAntes) bloque.pageBreak = 'before';
    // Imágenes del párrafo: van como bloques propios, con la alineación del párrafo
    const soloImagenes = imagenes.length && !trozos.some((t) => String(t.text).trim());
    if (!soloImagenes) {
      // Salto de columna del Word: el párrafo se parte ahí y entre las partes va una marca que
      // enColumnas() usa para pasar a la columna siguiente (en una sola columna se descarta)
      const partes = [[]];
      for (const t of trozos) { if (t._columna) partes.push([]); else partes[partes.length - 1].push(t); }
      if (partes.length === 1) salida.push(bloque);
      else {
        partes.forEach((parte, i) => {
          if (i) salida.push({ text: '', saltoColumna: true });
          const [izq, arriba, der, abajo] = margen;
          salida.push({ ...bloque, text: parte.length ? parte : ' ', margin: [izq, i ? 0 : arriba, der, i < partes.length - 1 ? 0 : abajo] });
        });
      }
    }
    // Varias imágenes en el mismo párrafo van lado a lado (como en Word), achicadas si no caben en el ancho
    if (imagenes.length) {
      const margen = [props.izquierda || 0, 2, 0, props.despues ?? 2];
      const disponible = (this.anchoUtil || 450) - (props.izquierda || 0);
      const separacion = 8;
      const total = imagenes.reduce((s, i) => s + i.ancho, 0) + separacion * (imagenes.length - 1);
      const escala = Math.min(1, disponible / total);
      const img = (i) => (i.svg ? { svg: i.svg, width: i.ancho * escala, height: i.alto * escala } : { image: i.datos, width: i.ancho * escala, height: i.alto * escala });
      if (imagenes.length === 1) salida.push({ ...img(imagenes[0]), alignment: imagenes[0].alineacion || props.alineacion || 'left', margin: margen });
      else {
        const fila = imagenes.map((i) => ({ ...img(i), width: i.ancho * escala }));
        const libre = disponible - total * escala;
        const antes = props.alineacion === 'center' ? libre / 2 : (props.alineacion === 'right' ? libre : 0);
        salida.push({ columns: [...(antes > 0 ? [{ width: antes, text: '' }] : []), ...fila.map((f) => ({ width: f.width, stack: [f] }))], columnGap: separacion, margin: margen });
      }
    }
    if (soloImagenes && props.saltoAntes) salida[0].pageBreak = 'before';
    if (saltoDespues) salida.push({ text: '', pageBreak: 'after' });
    return salida;
  }

  run(r, runBase, rels, enlace, trozos, imagenes, estado, saltoPagina) {
    const rPr = hijo(r, 'w:rPr');
    const conEstilo = { ...runBase, ...this.estilos.caracter(val(hijo(rPr, 'w:rStyle'))) };
    const props = propsRun(rPr, conEstilo);
    for (const n of r.c) {
      // Campos complejos: se muestra el resultado, no la instrucción
      if (n.n === 'w:fldChar') {
        const t = n.a['w:fldCharType'];
        if (t === 'begin') { estado.campo++; estado.enInstruccion = true; }
        else if (t === 'separate') estado.enInstruccion = false;
        else if (t === 'end') { estado.campo = Math.max(0, estado.campo - 1); estado.enInstruccion = false; }
        continue;
      }
      if (estado.enInstruccion || props.oculto) continue;
      let texto = null;
      if (n.n === 'w:t') texto = textoDe(n);
      else if (n.n === 'w:ptab') {
        // Tabulación de posición (típica del encabezado: centrar el logo). Lo que viene después se alinea ahí
        texto = '    ';
        if (['center', 'right'].includes(n.a['w:alignment'])) estado.alineacionTab = n.a['w:alignment'];
      }
      else if (n.n === 'w:tab') texto = '    ';
      else if (n.n === 'w:br') { if (n.a['w:type'] === 'page') saltoPagina(); else if (n.a['w:type'] === 'column') trozos.push({ text: '', _columna: true }); else texto = '\n'; }
      else if (n.n === 'w:cr') texto = '\n';
      else if (n.n === 'w:noBreakHyphen') texto = '-';
      else if (n.n === 'w:sym') texto = '•';
      else if (n.n === 'w:drawing' || n.n === 'w:pict') { const img = this.imagen(n, rels); if (img) { if (estado.alineacionTab) img.alineacion = estado.alineacionTab; imagenes.push(img); } }
      if (texto === null) continue;
      if (props.mayusculas) texto = texto.toUpperCase();
      const t = { text: limpiar(texto) };
      const fuente = this.fuenteDe(props); if (fuente) t.font = fuente;
      if (props.tam) t.fontSize = props.vert && props.vert !== 'baseline' ? props.tam * 0.65 : props.tam;
      if (props.bold) t.bold = true;
      if (props.italics) t.italics = true;
      const deco = [props.subrayado && 'underline', props.tachado && 'lineThrough'].filter(Boolean);
      if (deco.length) t.decoration = deco.length === 1 ? deco[0] : deco;
      if (props.color && props.color.toLowerCase() !== '#000000') t.color = props.color;
      if (enlace) { t.link = enlace; t.color = t.color || '#1155cc'; t.decoration = t.decoration || 'underline'; }
      if (props.vert === 'superscript') t.sup = true;
      if (props.vert === 'subscript') t.sub = true;
      if (props.espaciado) t.characterSpacing = props.espaciado;
      // Calibri es ~9 % más angosta que Helvetica: se juntan un poco las letras para que cada línea
      // tenga las mismas palabras que en el Word
      if (/calibri|carlito/i.test(this.nombreFuenteDe(props))) t.characterSpacing = (t.characterSpacing || 0) - 0.045 * (props.tam || this.tamBase);
      t._run = props;   // para el alto de línea del párrafo (se quita antes de dibujar)
      trozos.push(t);
    }
  }

  imagen(nodo, rels) {
    const blip = buscar(nodo, 'a:blip')[0] || buscar(nodo, 'v:imagedata')[0];
    const id = blip?.a['r:embed'] || blip?.a['r:id'];
    const ruta = rels[id]?.ruta;
    if (!ruta) return null;
    const bytes = this.zip.file(ruta)?.asNodeBuffer();
    if (!bytes) return null;
    const tipo = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : (bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpeg' : null);
    if (!tipo) return null;   // EMF, WMF, GIF...: pdfkit no los dibuja
    const ext = buscar(nodo, 'wp:extent')[0];
    const ancho = ext ? Number(ext.a.cx) / 12700 : 120, alto = ext ? Number(ext.a.cy) / 12700 : 60;
    const datos = `data:image/${tipo};base64,${bytes.toString('base64')}`;
    // Imagen girada en el Word (ej. el reverso de un carnet): se dibuja girada con un SVG
    const giro = Math.round(((Number(buscar(nodo, 'a:xfrm')[0]?.a.rot) || 0) / 60000) % 360);
    if (giro) {
      const rad = (giro * Math.PI) / 180;
      const w = Math.abs(ancho * Math.cos(rad)) + Math.abs(alto * Math.sin(rad));
      const h = Math.abs(ancho * Math.sin(rad)) + Math.abs(alto * Math.cos(rad));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
        + `<image x="${(w - ancho) / 2}" y="${(h - alto) / 2}" width="${ancho}" height="${alto}" preserveAspectRatio="none" `
        + `transform="rotate(${giro} ${w / 2} ${h / 2})" xlink:href="${datos}"/></svg>`;
      return { svg, ancho: w, alto: h };
    }
    return { datos, ancho, alto };
  }

  tabla(tbl, rels) {
    const tblPr = hijo(tbl, 'w:tblPr');
    const columnas = hijos(hijo(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => pt(g.a['w:w']) || 1);
    const filas = hijos(tbl, 'w:tr');
    const anterior = this.tablaActual;
    this.tablaActual = this.estilos.tabla(val(hijo(tblPr, 'w:tblStyle')));
    if (!filas.length) return null;
    // Bordes como en Word: cada lado de cada celda (w:tcBorders) o, si no lo dice, el de la tabla o su estilo
    // (top/bottom/left/right en el contorno; insideH/insideV entre celdas)
    const estiloTabla = val(hijo(tblPr, 'w:tblStyle'));
    const bordesTabla = hijo(tblPr, 'w:tblBorders') || this.estilos.tablaPropiedad(estiloTabla, 'w:tblBorders');
    const visible = (nodo) => Boolean(nodo) && !['none', 'nil'].includes(nodo.a['w:val']);
    const lado = (padre, ...nombres) => nombres.map((x) => hijo(padre, 'w:' + x)).find(Boolean);
    const ladoTabla = (...nombres) => visible(lado(bordesTabla, ...nombres));
    // Márgenes de celda (Word: 5,4 pt a los lados y 0 arriba y abajo si no se indica otra cosa)
    const mar = hijo(tblPr, 'w:tblCellMar') || this.estilos.tablaPropiedad(estiloTabla, 'w:tblCellMar');
    const margenCelda = (nombres, defecto) => { const x = lado(mar, ...nombres); return x ? pt(x.a['w:w']) : defecto; };
    const relleno = { izq: margenCelda(['left', 'start'], 5.4), der: margenCelda(['right', 'end'], 5.4), arr: margenCelda(['top'], 0), aba: margenCelda(['bottom'], 0) };
    const alturas = filas.map((f) => { const h = hijo(hijo(f, 'w:trPr'), 'w:trHeight'); return h && h.a['w:hRule'] !== 'auto' ? pt(h.a['w:val']) : undefined; });
    const n = Math.max(columnas.length, ...filas.map((f) => hijos(f, 'w:tc').reduce((s, c) => s + (Number(val(hijo(hijo(c, 'w:tcPr'), 'w:gridSpan'))) || 1), 0)));
    while (columnas.length < n) columnas.push(columnas[columnas.length - 1] || 50);

    // Matriz de celdas: gridSpan → colSpan; vMerge → rowSpan (pdfmake pide celdas vacías en su lugar)
    const cuerpo = filas.map(() => Array(n).fill(null));
    const abiertas = {};   // columna → celda que se está combinando hacia abajo
    filas.forEach((fila, i) => {
      let col = Number(val(hijo(hijo(fila, 'w:trPr'), 'w:gridBefore'))) || 0;
      for (let k = 0; k < col; k++) cuerpo[i][k] = {};
      for (const tc of hijos(fila, 'w:tc')) {
        if (col >= n) break;
        const tcPr = hijo(tc, 'w:tcPr');
        const span = Math.min(Number(val(hijo(tcPr, 'w:gridSpan'))) || 1, n - col);
        const vm = hijo(tcPr, 'w:vMerge');
        if (vm && val(vm) !== 'restart' && abiertas[col]) {
          abiertas[col].rowSpan = (abiertas[col].rowSpan || 1) + 1;
          for (let k = 0; k < span; k++) cuerpo[i][col + k] = { _de: abiertas[col] };
        } else {
          const contenido = this.bloques(tc.c, rels).filter((b) => !b.saltoColumna);
          const celda = { stack: contenido.length ? contenido : [{ text: ' ' }] };
          const fondo = hijo(tcPr, 'w:shd')?.a['w:fill'];
          if (fondo && /^[0-9a-f]{6}$/i.test(fondo) && fondo.toLowerCase() !== 'ffffff') celda.fillColor = '#' + fondo;
          if (span > 1) celda.colSpan = span;
          celda._pos = { i, col, span, tcB: hijo(tcPr, 'w:tcBorders') };
          cuerpo[i][col] = celda;
          for (let k = 1; k < span; k++) cuerpo[i][col + k] = { _de: celda };
          if (vm) abiertas[col] = celda; else delete abiertas[col];
        }
        col += span;
      }
      for (let k = 0; k < n; k++) if (!cuerpo[i][k]) cuerpo[i][k] = { text: '', border: [false, false, false, false] };
    });
    this.tablaActual = anterior;
    for (const fila of cuerpo) {
      for (const c of fila) {
        if (c._pos) {
          const { i, col, span, tcB } = c._pos;
          const ultimaFila = i + (c.rowSpan || 1) - 1 === filas.length - 1;
          const borde = (propios, ...deTabla) => { const x = lado(tcB, ...propios); return x ? visible(x) : ladoTabla(...deTabla); };
          c.border = [
            borde(['left', 'start'], ...(col === 0 ? ['left', 'start'] : ['insideV'])),
            borde(['top'], i === 0 ? 'top' : 'insideH'),
            borde(['right', 'end'], ...(col + span === n ? ['right', 'end'] : ['insideV'])),
            borde(['bottom'], ultimaFila ? 'bottom' : 'insideH')
          ];
          delete c._pos;
        }
      }
    }
    for (const fila of cuerpo) for (const c of fila) if (c._de) { c.border = c._de.border; delete c._de; }
    const total = columnas.reduce((a, b) => a + b, 0);
    return {
      table: {
        widths: columnas.map((w) => Math.max(8, (w / total) * this.anchoUtil - relleno.izq - relleno.der)),
        heights: (fila) => alturas[fila], body: cuerpo, dontBreakRows: false
      },
      layout: {
        hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#000000', vLineColor: () => '#000000',
        paddingLeft: () => relleno.izq, paddingRight: () => relleno.der, paddingTop: () => relleno.arr, paddingBottom: () => relleno.aba
      },
      margin: [0, 0, 0, 0]
    };
  }

  parte(rId, rels) {
    const ruta = rels[rId]?.ruta;
    const xml = ruta && this.zip.file(ruta)?.asText();
    if (!xml) return null;
    const raiz = parsear(xml);
    const cuerpo = raiz.c.find((x) => x.n === 'w:hdr' || x.n === 'w:ftr');
    const contenido = this.bloques(cuerpo?.c || [], this.relaciones(ruta)).filter((b) => !b.saltoColumna);
    return contenido.length ? contenido : null;
  }

  documento() {
    const raiz = parsear(this.zip.file('word/document.xml').asText());
    const body = hijo(hijo(raiz, 'w:document'), 'w:body');
    const rels = this.relaciones('word/document.xml');
    // Tamaño y márgenes de la primera sección (la de la página 1)
    const sect = buscar(body, 'w:sectPr').find((x) => hijo(x, 'w:pgMar')) || hijo(body, 'w:sectPr');
    const pg = hijo(sect, 'w:pgSz'), mar = hijo(sect, 'w:pgMar');
    const ancho = pt(pg?.a['w:w']) || 612, alto = pt(pg?.a['w:h']) || 792;
    const m = { arriba: pt(mar?.a['w:top']) || 72, abajo: pt(mar?.a['w:bottom']) || 72, izq: pt(mar?.a['w:left']) || 72, der: pt(mar?.a['w:right']) || 72,
      enc: pt(mar?.a['w:header']) || 36, pie: pt(mar?.a['w:footer']) || 36 };
    this.anchoUtil = ancho - m.izq - m.der;

    // Encabezado y pie "default" (los de la primera sección que los tenga)
    const refs = buscar(body, 'w:sectPr');
    const ref = (tipo) => refs.map((s) => hijos(s, tipo).find((h) => h.a['w:type'] === 'default')).find(Boolean)?.a['r:id'];
    const encabezado = this.parte(ref('w:headerReference'), rels);
    const pie = this.parte(ref('w:footerReference'), rels);

    // Saltos de sección: el párrafo que cierra una sección lleva su w:sectPr; la sección siguiente
    // empieza en página nueva salvo que sea "continua" (su w:type lo dice)
    const conSeccion = body.c.filter((x) => x.n === 'w:p' && hijo(hijo(x, 'w:pPr'), 'w:sectPr'));
    const secciones = [...conSeccion.map((x) => hijo(hijo(x, 'w:pPr'), 'w:sectPr')), hijo(body, 'w:sectPr')];
    this.finDeSeccion = new Set(conSeccion.filter((x, i) => val(hijo(secciones[i + 1], 'w:type')) !== 'continuous'));
    // Como en Word: si el encabezado o el pie no caben en el margen, el texto empieza (o termina) después de ellos
    const estilo = { font: this.fuenteBase, fontSize: this.tamBase };
    const altoEnc = encabezado ? altoTotal(encabezado, this.anchoUtil, estilo) : 0;
    const altoPie = pie ? altoTotal(pie, this.anchoUtil, estilo) : 0;
    const arriba = encabezado ? Math.max(m.arriba, m.enc + altoEnc) : m.arriba;
    const abajo = pie ? Math.max(m.abajo, m.pie + altoPie) : m.abajo;
    const def = {
      pageSize: { width: ancho, height: alto },
      pageMargins: [m.izq, arriba, m.der, abajo],
      header: encabezado ? () => ({ stack: encabezado, margin: [m.izq, m.enc, m.der, 0] }) : undefined,
      footer: pie ? () => ({ stack: pie, margin: [m.izq, Math.max(0, abajo - m.pie - altoPie), m.der, 0] }) : undefined,
      content: [],
      defaultStyle: estilo,
      // Fecha fija (la del Word): el mismo Word da siempre el mismo PDF, byte a byte, y la misma huella
      info: { producer: 'Easy Office', creator: 'Easy Office', creationDate: this.fecha(), modDate: this.fecha() }
    };

    // Sección por sección: el w:sectPr va al final de cada una (en su último párrafo; el de la última, en el cuerpo)
    const anchoPagina = this.anchoUtil;
    let actual = [];
    const cerrar = (sectPr) => {
      const cols = hijo(sectPr, 'w:cols');
      const num = Math.max(1, Number(cols?.a['w:num']) || 1);
      // Márgenes laterales propios de la sección: se suman al margen de cada bloque
      const marS = hijo(sectPr, 'w:pgMar');
      const dIzq = marS?.a['w:left'] !== undefined ? pt(marS.a['w:left']) - m.izq : 0;
      const dDer = marS?.a['w:right'] !== undefined ? pt(marS.a['w:right']) - m.der : 0;
      const anchoSeccion = anchoPagina - dIzq - dDer;
      const desde = def.content.length;
      if (num === 1) {
        this.anchoUtil = anchoSeccion;
        def.content.push(...this.bloques(actual, rels).filter((b) => !b.saltoColumna));
      } else {
        const espacio = pt(cols.a['w:space'] ?? 720) || 36;
        const anchos = hijos(cols, 'w:col').map((c) => pt(c.a['w:w']));
        const anchoCol = anchos.length === num && anchos.every((a) => a > 0) ? anchos : Array(num).fill((anchoSeccion - espacio * (num - 1)) / num);
        this.anchoUtil = Math.min(...anchoCol);
        const bloques = this.bloques(actual, rels);
        def.content.push(...enColumnas(def, bloques, anchoCol, espacio));
      }
      if (dIzq || dDer) {
        for (const b of def.content.slice(desde)) {
          const [l = 0, t = 0, r = 0, bo = 0] = Array.isArray(b.margin) ? (b.margin.length === 2 ? [b.margin[0], b.margin[1], b.margin[0], b.margin[1]] : b.margin) : [b.margin || 0, b.margin || 0, b.margin || 0, b.margin || 0];
          b.margin = [l + dIzq, t, r + dDer, bo];
        }
      }
      this.anchoUtil = anchoPagina;
      actual = [];
    };
    for (const x of body.c) {
      if (x.n === 'w:sectPr') continue;
      actual.push(x);
      const sp = x.n === 'w:p' && hijo(hijo(x, 'w:pPr'), 'w:sectPr');
      if (sp) cerrar(sp);
    }
    cerrar(hijo(body, 'w:sectPr'));

    // Las marcas de salto ({ text: '', pageBreak: 'after' }) ocupan una línea: si la página ya está llena,
    // esa línea abre una página en blanco. El salto pasa a ser "antes" del bloque siguiente.
    const esMarca = (b) => b && b.pageBreak === 'after' && b.text === '';
    const contenido = [];
    let saltar = false;
    for (const b of def.content) {
      if (esMarca(b)) { saltar = contenido.length > 0; continue; }
      contenido.push(saltar ? { ...b, pageBreak: 'before' } : b);
      saltar = false;
    }
    // Párrafos vacíos al final del documento: no se ven y pueden abrir una página en blanco
    while (contenido.length > 1 && contenido[contenido.length - 1].text !== undefined && !contenido[contenido.length - 1].table
      && !(Array.isArray(contenido[contenido.length - 1].text) ? contenido[contenido.length - 1].text : [{ text: contenido[contenido.length - 1].text }]).some((t) => String(t.text).trim())) contenido.pop();
    def.content = contenido;
    return def;
  }
}

/* ---------- Texto a varias columnas (como el contrato de oficina) ----------
   pdfmake no hace que el texto pase de una columna a la siguiente: aquí se mide cada bloque con el
   propio pdfmake (en una hoja de prueba, sin dibujar) y se reparte: primero se llena la columna
   izquierda hasta el final de la página, luego la derecha, y así en cada página. Un párrafo que no
   cabe se corta por palabras donde termina la columna. */
const PRUEBA = new PdfPrinter(FUENTES);

// Copia profunda que conserva las funciones (pdfmake modifica los nodos al medirlos)
function clonar(v) {
  if (Array.isArray(v)) return v.map(clonar);
  if (v && typeof v === 'object') { const r = {}; for (const k of Object.keys(v)) r[k] = clonar(v[k]); return r; }
  return v;
}
const margenArriba = (b) => (Array.isArray(b.margin) ? (b.margin[1] ?? 0) : (b.margin || 0));

// Dónde empieza cada bloque si se ponen uno tras otro con ese ancho (y dónde termina el último)
function posiciones(bloques, ancho, estilo) {
  const pos = {};
  PRUEBA.createPdfKitDocument({
    pageSize: { width: ancho + 2, height: 200000 }, pageMargins: [1, 0, 1, 0], defaultStyle: estilo,
    content: [...bloques.map((b, i) => ({ ...clonar(b), pageBreak: undefined, id: 'b' + i })), { text: ' ', id: 'fin' }],
    pageBreakBefore: (n) => { if (n.id) pos[n.id] = n.startPosition.top; return false; }
  });
  return bloques.map((b, i) => (pos['b' + i] ?? 0) - margenArriba(b)).concat(pos.fin ?? 0);
}
const altoTotal = (bloques, ancho, estilo) => { const p = posiciones(bloques, ancho, estilo); return p[p.length - 1]; };

// Alto libre en la página donde termina el contenido ya puesto
function espacioLibre(def) {
  let fin = null;
  PRUEBA.createPdfKitDocument({
    ...def, header: undefined, footer: undefined, content: [...def.content.map(clonar), { text: ' ', id: 'fin' }],
    pageBreakBefore: (n) => { if (n.id === 'fin') fin = n.startPosition; return false; }
  });
  const interior = def.pageSize.height - def.pageMargins[1] - def.pageMargins[3];
  if (!fin) return { libre: interior, interior };
  return { libre: interior - (fin.top - def.pageMargins[1]), interior };
}

const PALABRAS = /\S+\s*|\s+/g;
const trozosDe = (b) => (Array.isArray(b.text) ? b.text : [{ text: String(b.text) }]);
const contarPalabras = (b) => trozosDe(b).reduce((s, t) => s + (String(t.text).match(PALABRAS) || []).length, 0);

// Divide un párrafo en dos: las primeras `n` palabras y el resto
function cortarParrafo(b, n) {
  const primero = [], resto = [];
  let cuenta = 0;
  for (const t of trozosDe(b)) {
    const palabras = String(t.text).match(PALABRAS) || [];
    const corte = Math.max(0, Math.min(palabras.length, n - cuenta));
    if (corte > 0) primero.push({ ...t, text: palabras.slice(0, corte).join('') });
    if (corte < palabras.length) resto.push({ ...t, text: palabras.slice(corte).join('') });
    cuenta += palabras.length;
  }
  const [izq = 0, arriba = 0, der = 0, abajo = 0] = Array.isArray(b.margin) ? b.margin : [];
  return [
    { ...b, text: primero, margin: [izq, arriba, der, 0] },
    { ...b, text: resto, margin: [izq, 0, der, abajo], leadingIndent: undefined }
  ];
}

function enColumnas(def, bloques, anchos, espacio) {
  const estilo = def.defaultStyle;
  // Los saltos de página de la sección van después de las columnas
  const saltoFinal = bloques.some((b) => b.pageBreak === 'after');
  const cola = bloques.filter((b) => !(b.pageBreak === 'after' && b.text === ''));
  const { libre, interior } = espacioLibre(def);
  const HOLGURA = 2;
  const filas = [];
  let nueva = libre < 40;
  let disponible = nueva ? interior : libre;
  let cols = anchos.map(() => []), col = 0, usado = 0;
  const siguienteColumna = () => {
    col++; usado = 0;
    if (col === anchos.length) {
      filas.push({ cols, nueva });
      cols = anchos.map(() => []); col = 0; disponible = interior; nueva = true;
    }
  };
  let vueltas = 0;
  while (cola.length && vueltas++ < 5000) {
    const b = cola.shift();
    if (b.saltoColumna) { if (cols[col].length) siguienteColumna(); continue; }
    const alto = altoTotal([b], anchos[col], estilo);
    if (usado + alto <= disponible - HOLGURA) { cols[col].push(b); usado += alto; continue; }
    // No cabe: un párrafo se corta por palabras donde termina la columna
    if (b.text !== undefined && contarPalabras(b) > 1) {
      let lo = 0, hi = contarPalabras(b) - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (usado + altoTotal([cortarParrafo(b, mid)[0]], anchos[col], estilo) <= disponible - HOLGURA) lo = mid; else hi = mid - 1;
      }
      if (lo > 0) {
        const [a, r] = cortarParrafo(b, lo);
        cols[col].push(a);
        cola.unshift(r);
        siguienteColumna();
        continue;
      }
    }
    if (!cols[col].length) { cols[col].push(b); siguienteColumna(); continue; }   // no cabe ni en una columna vacía
    cola.unshift(b);
    siguienteColumna();
  }
  if (cols.some((c) => c.length)) filas.push({ cols, nueva });

  // Los párrafos vacíos al final de una columna no se ven y podrían empujar la fila a otra página
  const vacio = (b) => b.text !== undefined && !b.table && !b.image && !b.columns
    && !trozosDe(b).some((t) => String(t.text).trim());
  for (const f of filas) for (const c of f.cols) while (c.length > 1 && vacio(c[c.length - 1])) c.pop();
  const salida = filas.map((f) => ({
    columns: f.cols.map((c, i) => ({ width: anchos[i], stack: c.length ? c : [{ text: '' }] })),
    columnGap: espacio,
    ...(f.nueva ? { pageBreak: 'before' } : {})
  }));
  if (saltoFinal) salida.push({ text: '', pageBreak: 'after' });
  return salida;
}

const impresora = new PdfPrinter(FUENTES);

async function aPdf(docx) {
  const zip = new PizZip(docx);
  if (!zip.file('word/document.xml')) throw new Error('El archivo no es un documento Word (.docx).');
  const def = new Conversor(zip).documento();
  return new Promise((ok, mal) => {
    try {
      const doc = impresora.createPdfKitDocument(def);
      const partes = [];
      doc.on('data', (b) => partes.push(b));
      doc.on('end', () => ok(Buffer.concat(partes)));
      doc.on('error', mal);
      doc.end();
    } catch (err) { mal(err); }
  });
}

// La definición de pdfmake (para revisar o probar la conversión)
const definicion = (docx) => new Conversor(new PizZip(docx)).documento();

module.exports = { aPdf, definicion };
