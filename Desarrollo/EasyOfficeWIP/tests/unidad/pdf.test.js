/* Word → PDF (src/datos/pdf.js): el PDF de solo texto siempre; LibreOffice si está instalado. */
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pdf = require('../../src/datos/pdf');

const CONTRATOS = path.resolve(__dirname, '../../../base de datos/Contratos');
const word = fs.readFileSync(path.join(CONTRATOS, fs.readdirSync(CONTRATOS).find((f) => /OFICINA.*\.docx$/i.test(f))));

it('solo texto: un PDF válido con el texto del Word y sus tildes', async () => {
  const b = await pdf.soloTexto(word);
  const t = b.toString('latin1');
  assert.ok(t.startsWith('%PDF-1.4') && t.trimEnd().endsWith('%%EOF'));
  assert.match(t, /\/Count [1-9]\d*/);
  assert.ok(t.includes('CONTRATO'));
  assert.ok(/[ÁÉÍÓÚÑáéíóúñ]/.test(t), 'las tildes van en WinAnsi');
  // la tabla xref apunta a cada objeto
  const xref = Number(t.match(/startxref\n(\d+)/)[1]);
  assert.ok(t.slice(xref).startsWith('xref'));
  for (const [, pos, n] of [...t.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m, i) => [m, Number(m[1]), i + 1])) {
    assert.ok(t.slice(pos).startsWith(`${n} 0 obj`), `objeto ${n}`);
  }
});

const crypto = require('crypto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const plantillas = fs.readdirSync(CONTRATOS).filter((f) => f.endsWith('.docx') && !f.startsWith('~$'));

for (const f of plantillas) {
  it(`JavaScript: ${f} → PDF válido, con páginas, en menos de 2 s`, async () => {
    const docx = fs.readFileSync(path.join(CONTRATOS, f));
    const t = Date.now();
    const b = await pdf.javascript(docx);
    assert.ok(Date.now() - t < 2000);
    const s = b.toString('latin1');
    assert.ok(s.startsWith('%PDF-') && s.trimEnd().endsWith('%%EOF'));
    assert.ok((s.match(/\/Type \/Page\b/g) || []).length >= 1);
  });
}

it('JavaScript: el mismo Word da el mismo PDF (misma huella)', async () => {
  assert.equal(sha(await pdf.javascript(word)), sha(await pdf.javascript(word)));
});

it('JavaScript: conserva el logo del encabezado del contrato', async () => {
  const s = (await pdf.javascript(word)).toString('latin1');
  assert.match(s, /\/Subtype \/Image/);
});

const paginas = (b) => (b.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
const wordPdf = require('../../src/datos/wordPdf');

it('JavaScript: el contrato a dos columnas queda en 3 páginas, como en Word', async () => {
  assert.equal(paginas(await pdf.javascript(word)), 3);
  const def = wordPdf.definicion(word);
  const fila = def.content.find((b) => b.columns);
  assert.ok(fila && fila.columns.length === 2, 'la sección de dos columnas');
  assert.ok(fila.columns.every((c) => c.stack.length > 3), 'texto en las dos columnas');
});

it('JavaScript: el Anexo empieza en página nueva (salto de sección)', () => {
  const def = wordPdf.definicion(word);
  const salto = def.content.find((b) => b.pageBreak === 'before');
  assert.ok(salto && JSON.stringify(salto.text).includes('ANEXO'));
  assert.ok(!def.content.some((b) => b.pageBreak === 'after' && b.text === ''), 'sin marcas que abran páginas en blanco');
});

it('JavaScript: la imagen girada en el Word (reverso del carnet) se dibuja girada', () => {
  const def = JSON.stringify(wordPdf.definicion(word).content);
  assert.match(def, /rotate\(270 /);
});

it('JavaScript: una fuente que no está (gobCL) usa el reemplazo que indica el Word (Calibri) y el acuerdo cabe en 1 página', async () => {
  const acuerdo = fs.readFileSync(path.join(CONTRATOS, plantillas.find((f) => /ACCIONISTAS/i.test(f))));
  assert.equal(paginas(await pdf.javascript(acuerdo)), 1);
  const def = JSON.stringify(wordPdf.definicion(acuerdo).content);
  assert.match(def, /"characterSpacing":-0\.\d+/, 'ancho de Calibri');
});

it('JavaScript: un archivo que no es Word → error', async () => {
  await assert.rejects(pdf.javascript(Buffer.from('no es un docx')));
});

it('LibreOffice: convierte el contrato a PDF', { skip: !pdf.hayLibreOffice() && 'LibreOffice no está instalado' }, async () => {
  const b = await pdf.convertir(word);
  assert.ok(b.subarray(0, 5).toString() === '%PDF-' && b.length > 10000);
});

