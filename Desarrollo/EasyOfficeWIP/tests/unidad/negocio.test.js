/* Pruebas unitarias de la capa de negocio: validación, diccionario de datos y Word. No usan la base de datos. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const v = require('../../src/negocio/validacion');
const campos = require('../../src/negocio/camposDocumento');
const word = require('../../src/datos/word');

const CONTRATOS = path.resolve(__dirname, '..', '..', '..', 'base de datos', 'Contratos');
const plantilla = (patron) => fs.readFileSync(path.join(CONTRATOS, fs.readdirSync(CONTRATOS).find((f) => patron.test(f))));

describe('validación', () => {
  it('RUT: dígito verificador y formato', () => {
    assert.equal(v.rutValido('21167684-1'), true);
    assert.equal(v.rutValido('11111111-2'), false);
    assert.equal(v.rut('21.167.684-1'), '21167684-1');
    assert.throws(() => v.rut('11.111.111-2'), /dígito verificador/);
    assert.equal(v.rut('', 'RUT', { opcional: true }), null);
  });

  it('RUT con K mayúscula o minúscula', () => {
    // 10.000.013-K es válido (módulo 11 = 10)
    assert.equal(v.rut('10.000.013-k'), '10000013-K');
  });

  it('correo, celular y fecha', () => {
    assert.equal(v.email('Roger@Correo.CL'), 'roger@correo.cl');
    assert.throws(() => v.email('no-es-correo'), /no es válido/);
    assert.equal(v.celular('+56 9 1234 5678'), '912345678');
    assert.throws(() => v.celular('22345678'), /9 dígitos/);
    assert.equal(v.fecha('2026-11-02', 'Fecha'), '2026-11-02');
    assert.throws(() => v.fecha('02-11-2026', 'Fecha'), /no es una fecha/);
  });

  it('números, opciones y booleanos', () => {
    assert.equal(v.entero('12', 'N'), 12);
    assert.throws(() => v.entero('1.5', 'N'), /no es válido/);
    assert.throws(() => v.id(0), /no es válido/);
    assert.equal(v.opcion('ANUAL', v.CICLOS, 'Ciclo'), 'ANUAL');
    assert.throws(() => v.opcion('DIARIO', v.CICLOS, 'Ciclo'));
    assert.equal(v.booleano('on'), true);
    assert.equal(v.booleano(undefined, true), true);
  });
});

describe('diccionario de datos del documento', () => {
  it('monto en palabras', () => {
    assert.equal(campos.enPalabras(0), 'cero pesos');
    assert.equal(campos.enPalabras(1), 'un peso');
    assert.equal(campos.enPalabras(21000), 'veintiún mil pesos');
    assert.equal(campos.enPalabras(100), 'cien pesos');
    assert.equal(campos.enPalabras(1000000), 'un millón de pesos');
    assert.equal(campos.enPalabras(29995), 'veintinueve mil novecientos noventa y cinco pesos');
  });

  it('reconoce marcas escritas a mano por sinónimo', () => {
    assert.equal(campos.sugerir('[RUT EMPRESA]').dato, 'RUT');
    assert.equal(campos.sugerir('RAZON_SOCIAL').dato, 'RAZON_SOCIAL');
    const s = campos.sugerir('[PATENTE]');
    assert.equal(s.dato, '_ejecutivo');
    assert.equal(s.etiqueta, 'Patente');
  });

  it('resolver: pendientes y valores', () => {
    const marcas = [{ marca: 'RAZON_SOCIAL', tipo: 'campo' }, { marca: '[PATENTE]', tipo: 'corchete' }, { marca: '[X]', tipo: 'corchete' }];
    const mapa = { '[PATENTE]': { dato: '_tienda' }, '[X]': { dato: '_ignorar' } };
    const sin = campos.resolver(marcas, mapa, { RAZON_SOCIAL: 'ACME' });
    assert.deepEqual(sin.pendientes, ['[PATENTE]']);
    const con = campos.resolver(marcas, mapa, { RAZON_SOCIAL: 'ACME' }, { '[PATENTE]': 'KXRT-55' });
    assert.deepEqual(con.pendientes, []);
    assert.equal(con.valor('RAZON_SOCIAL'), 'ACME');
    assert.equal(con.valor('[PATENTE]'), 'KXRT-55');
    assert.equal(con.valor('[X]'), undefined);   // un corchete ignorado queda tal cual
  });

  it('persona natural: los datos del representante son los suyos', () => {
    const val = campos.valores({ datos: { cliente_tipo_persona: 'natural', cliente_razon_social: 'Ana Pérez', cliente_rut: '21167684-1' }, servicios: [] });
    const rep = campos.DATOS.find((d) => /REPRESENTANTE/.test(d.etiqueta) && d.grupo !== 'Easy Office' && /RUT/.test(d.clave));
    if (rep) assert.equal(val[rep.clave], '21167684-1');
  });
});

describe('Word', () => {
  it('detecta los campos del contrato de oficina', () => {
    const m = word.marcas(plantilla(/OFICINA/));
    assert.ok(m.length > 10);
    assert.ok(m.some((x) => x.marca === 'RAZON_SOCIAL' && x.tipo === 'campo'));
  });

  it('detecta las marcas entre corchetes del contrato de vehículo', () => {
    const m = word.marcas(plantilla(/VEHICULO/));
    assert.ok(m.some((x) => x.marca === '[PATENTE]' && x.tipo === 'corchete'));
  });

  it('combina los datos y no deja marcas', () => {
    const buf = plantilla(/VEHICULO/);
    const { buffer, desconocidos } = word.combinar(buf, (marca) => (marca === '[PATENTE]' ? 'KXRT-55' : undefined));
    const despues = word.marcas(buffer).map((x) => x.marca);
    assert.ok(!despues.includes('[PATENTE]'));
    assert.ok(desconocidos.length > 0 && !desconocidos.includes('[PATENTE]'));
  });

  it('agrega la marca de agua BORRADOR', () => {
    const PizZip = require('pizzip');
    const conMarca = word.marcaDeAgua(plantilla(/BODEGA/));
    const zip = new PizZip(conMarca);
    const encabezados = Object.keys(zip.files).filter((f) => /^word\/header\d*|headerBorradorEO/.test(f));
    assert.ok(encabezados.some((f) => zip.file(f).asText().includes('BORRADOR')));
  });
});
