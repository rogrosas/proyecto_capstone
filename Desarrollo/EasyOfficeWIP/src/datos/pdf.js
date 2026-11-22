/* =========================================================
   CAPA DE DATOS · Word → PDF para lo que descarga el cliente.
   El cliente recibe PDF (no un Word que se edita fácilmente); el
   personal sigue trabajando con el Word en el CRM.

   - 'javascript' (por defecto): wordPdf.js lee el Word y arma el PDF
     con pdfmake. No instala nada en el servidor; conserva el diseño
     salvo el texto a dos columnas y las fuentes exactas.
   - 'libreoffice': convierte con LibreOffice sin ventana (soffice
     --headless --convert-to pdf): idéntico al Word, pero LibreOffice
     ocupa cientos de MB. Una conversión a la vez (usa un perfil propio).
   - 'texto': PDF solo con el texto del Word (pruebas).
   Cada PDF se guarda en archivos como pdf/<sha256 del Word>.pdf: el
   mismo Word entrega siempre el mismo PDF (y la misma huella, que
   /verificar acepta junto a la del Word firmado).
   ========================================================= */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const mammoth = require('mammoth');
const { pdf: cfg } = require('../config');
const { AppError } = require('../comun/errores');
const archivos = require('./archivos');
const wordPdf = require('./wordPdf');

const huella = (b) => crypto.createHash('sha256').update(b).digest('hex');
// Dónde queda el PDF de un Word (por su huella)
const rutaPdf = (sha) => `pdf/${sha}.pdf`;

/* ---------- LibreOffice ---------- */
const CANDIDATOS = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/lib/libreoffice/program/soffice', '/opt/libreoffice/program/soffice'
];
let soffice;   // undefined: aún no se busca; null: no está
function buscarSoffice() {
  if (soffice === undefined) soffice = [cfg.soffice, ...CANDIDATOS].find((p) => p && fs.existsSync(p)) || null;
  return soffice;
}
const hayLibreOffice = () => Boolean(buscarSoffice());

let cola = Promise.resolve();
const enCola = (fn) => { const r = cola.then(fn, fn); cola = r.catch(() => {}); return r; };

async function conLibreOffice(docx) {
  const exe = buscarSoffice();
  if (!exe) {
    throw new AppError(503, 'El PDF no está disponible: el servidor no tiene LibreOffice instalado. Avísenos con un ticket.');
  }
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'eo-pdf-'));
  const perfil = path.join(os.tmpdir(), 'easyoffice-libreoffice');   // se crea la primera vez (tarda unos segundos)
  try {
    const entrada = path.join(tmp, 'documento.docx');
    await fsp.writeFile(entrada, docx);
    await new Promise((ok, mal) => execFile(exe, [
      `-env:UserInstallation=${pathToFileURL(perfil).href}`,
      '--headless', '--norestore', '--nolockcheck', '--nodefault',
      '--convert-to', 'pdf:writer_pdf_Export', '--outdir', tmp, entrada
    ], { timeout: cfg.timeoutMs, windowsHide: true }, (err, stdout, stderr) => (err ? mal(new Error(`LibreOffice: ${err.message} ${stderr || ''}`.trim())) : ok())));
    return await fsp.readFile(path.join(tmp, 'documento.pdf'));
  } catch (err) {
    console.error('[pdf]', err.message);
    throw new AppError(503, 'No se pudo preparar el PDF. Intente de nuevo en unos minutos.');
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/* ---------- Solo texto ---------- */
// PDF mínimo (Helvetica, WinAnsi) con los párrafos del Word, en páginas tamaño carta
async function soloTexto(docx) {
  const { value } = await mammoth.extractRawText({ buffer: docx });
  const lineas = ['(Copia en texto: sin el formato del documento original)', ''];
  for (const p of value.split(/\n+/)) {
    let resto = p.replace(/\s+/g, ' ').trim();
    if (!resto) continue;
    while (resto.length > 95) {
      const corte = resto.lastIndexOf(' ', 95) > 40 ? resto.lastIndexOf(' ', 95) : 95;
      lineas.push(resto.slice(0, corte)); resto = resto.slice(corte).trim();
    }
    lineas.push(resto, '');
  }
  const winAnsi = (s) => Buffer.from(s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/[^\x20-\xff]/g, '?'), 'latin1')
    .toString('latin1').replace(/[\\()]/g, (c) => '\\' + c);

  const POR_PAGINA = 54;
  const paginas = [];
  for (let i = 0; i < lineas.length; i += POR_PAGINA) paginas.push(lineas.slice(i, i + POR_PAGINA));
  const objetos = [];   // índice + 1 = número de objeto
  const n = paginas.length;
  objetos.push('<< /Type /Catalog /Pages 2 0 R >>');
  objetos.push(`<< /Type /Pages /Count ${n} /Kids [${paginas.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`);
  objetos.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  paginas.forEach((ls, i) => {
    const flujo = `BT /F1 10 Tf 13 TL 56 740 Td ${ls.map((l) => `(${winAnsi(l)}) Tj T*`).join(' ')} ET`;
    objetos.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objetos.push(`<< /Length ${Buffer.byteLength(flujo, 'latin1')} >>\nstream\n${flujo}\nendstream`);
  });
  let pdf = '%PDF-1.4\n';
  const pos = [];
  objetos.forEach((o, i) => { pos.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/* ---------- API ---------- */

async function convertirCon(proveedor, docx) {
  if (proveedor === 'texto') return soloTexto(docx);
  if (proveedor === 'libreoffice') return enCola(() => conLibreOffice(docx));
  try {
    return await wordPdf.aPdf(docx);
  } catch (err) {
    console.error('[pdf]', err.stack || err.message);
    throw new AppError(503, 'No se pudo preparar el PDF. Avísenos con un ticket.');
  }
}

// PDF de un Word: el guardado si ya se convirtió; si no, se convierte y se guarda
async function desdeWord(docx) {
  const ruta = rutaPdf(huella(docx));
  if (await archivos.existe(ruta)) return archivos.leer(ruta);
  const pdf = await convertirCon(cfg.proveedor, docx);
  await archivos.guardar(ruta, pdf).catch((err) => console.warn(`[pdf] No se guardó ${ruta}: ${err.message}`));
  return pdf;
}

// Huella del PDF ya entregado de un Word (para /verificar), o null si aún no se ha convertido
async function huellaGuardada(shaWord) {
  if (!shaWord) return null;
  const ruta = rutaPdf(shaWord);
  return (await archivos.existe(ruta)) ? huella(await archivos.leer(ruta)) : null;
}

module.exports = { desdeWord, huellaGuardada, hayLibreOffice, soloTexto, convertir: (docx) => enCola(() => conLibreOffice(docx)), javascript: (docx) => wordPdf.aPdf(docx) };
