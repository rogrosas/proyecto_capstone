/* Archivos guardados en la base (tabla archivos): no dependen del disco del servidor. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const entorno = require('../apoyo/entorno');

let ctx, cookie = '', plantilla;
before(async () => {
  ctx = await entorno.iniciar();
  const r = await fetch(`${ctx.url}/api/crm/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ctx.cred.admin[0], password: ctx.cred.admin[1] })
  });
  cookie = r.headers.get('set-cookie').split(';')[0];
  [plantilla] = await ctx.sql(`SELECT id, archivo_base FROM plantillas_documento
                                WHERE archivo_base IS NOT NULL AND activo ORDER BY id LIMIT 1`);
});
after(() => entorno.terminar());

const pedir = (metodo, ruta, cuerpo, tipo = 'application/json') => fetch(ctx.url + ruta, {
  method: metodo, headers: { 'Content-Type': tipo, cookie }, body: cuerpo
});
const json = async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) });
const descargar = async (ruta) => { const r = await pedir('GET', ruta); return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()) }; };
const subir = (nombre, contenido, reemplazar) =>
  pedir('POST', `/api/crm/admin/archivos?nombre=${encodeURIComponent(nombre)}${reemplazar ? '&reemplazar=1' : ''}`, contenido, 'application/octet-stream').then(json);
const enBase = async (ruta) => (await ctx.sql('SELECT bytes, sha256, contenido FROM archivos WHERE ruta = $1', [ruta]))[0];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

describe('Archivos en la base', () => {
  it('hay una plantilla con Word en la carpeta', () => {
    assert.ok(plantilla?.archivo_base);
    assert.ok(fs.existsSync(path.join(ctx.dirContratos, plantilla.archivo_base)));
  });

  it('al abrirla por primera vez queda copiada en la tabla, con tamaño y huella', async () => {
    assert.equal(await enBase(plantilla.archivo_base), undefined);
    const r = await descargar(`/api/crm/plantillas/${plantilla.id}/archivo`);
    assert.equal(r.status, 200);
    const fila = await enBase(plantilla.archivo_base);
    assert.equal(fila.bytes, r.buffer.length);
    assert.equal(fila.sha256, sha(r.buffer));
    assert.ok(Buffer.compare(fila.contenido, r.buffer) === 0);
  });

  it('se sigue descargando aunque se borre de la carpeta (como en un reinicio de Render)', async () => {
    const original = fs.readFileSync(path.join(ctx.dirContratos, plantilla.archivo_base));
    fs.rmSync(path.join(ctx.dirContratos, plantilla.archivo_base));
    const r = await descargar(`/api/crm/plantillas/${plantilla.id}/archivo`);
    assert.equal(r.status, 200);
    assert.ok(Buffer.compare(r.buffer, original) === 0);
  });

  it('la lista de plantillas muestra la que solo está en la base', async () => {
    const r = await json(await pedir('GET', '/api/crm/admin/archivos'));
    assert.equal(r.status, 200);
    const a = r.archivos.find((x) => x.archivo === plantilla.archivo_base);
    assert.ok(a && a.campos > 0);
  });

  const docx = () => fs.readFileSync(fs.readdirSync(ctx.dirContratos).filter((f) => f.endsWith('.docx')).map((f) => path.join(ctx.dirContratos, f))[0]);

  it('una plantilla subida desde el CRM queda en la base, no en la carpeta', async () => {
    const r = await subir('Prueba base.docx', docx());
    assert.equal(r.status, 201);
    assert.ok(await enBase(r.archivo));
    assert.ok(!fs.existsSync(path.join(ctx.dirContratos, r.archivo)));
    const lista = await json(await pedir('GET', '/api/crm/admin/archivos'));
    assert.ok(lista.archivos.some((x) => x.archivo === r.archivo));
  });

  it('subirla otra vez sin reemplazar → 409; reemplazándola, se actualiza', async () => {
    assert.equal((await subir('Prueba base.docx', docx())).status, 409);
    const r = await subir('Prueba base.docx', docx(), true);
    assert.equal(r.status, 201);
  });

  it('la tabla rechaza rutas que salen de la carpeta', async () => {
    await assert.rejects(ctx.sql("INSERT INTO archivos (ruta, contenido, bytes, sha256) VALUES ('../x.docx', '\\x00', 1, repeat('0', 64))"));
    await assert.rejects(ctx.sql("INSERT INTO archivos (ruta, contenido, bytes, sha256) VALUES ('/x.docx', '\\x00', 1, repeat('0', 64))"));
  });

  describe('base sin la tabla (falta easyoffice_v2_archivos.sql)', () => {
    it('se quita la tabla', async () => { await ctx.sql('DROP TABLE archivos'); });
    it('se usa la carpeta como antes', async () => {
      const r = await subir('Sin tabla.docx', docx());
      assert.equal(r.status, 201);
      assert.ok(fs.existsSync(path.join(ctx.dirContratos, r.archivo)));
      const lista = await json(await pedir('GET', '/api/crm/admin/archivos'));
      assert.ok(lista.archivos.some((x) => x.archivo === r.archivo));
    });
  });
});
