/* =========================================================
   CAPA DE NEGOCIO · Administración de catálogos (solo administradores).
   Valida cada campo según su definición y resuelve las direcciones
   (busca o crea la fila en direcciones) dentro de la misma transacción.
   ========================================================= */
const { conUsuario } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const catalogosRepo = require('../../datos/repositorios/catalogos.repositorio');
const direccionesRepo = require('../../datos/repositorios/direcciones.repositorio');
const archivos = require('../../datos/archivos');
const v = require('../validacion');
const { DEFINICIONES } = require('../catalogos.definiciones');

function exigirAdmin(usuario) {
  if (!usuario.admin) throw errores.sinPermiso('La administración de catálogos es solo para administradores.');
}

function definicion(nombre) {
  const def = DEFINICIONES[nombre];
  if (!def) throw errores.noEncontrado('Catálogo inexistente.');
  return def;
}

// Definiciones públicas para que el navegador arme los formularios
function definiciones(usuario) {
  exigirAdmin(usuario);
  return Object.fromEntries(Object.entries(DEFINICIONES).map(([k, d]) => [k, {
    titulo: d.titulo, grupo: d.grupo, clave: d.clave, claveEditable: !!d.claveEditable, lista: d.lista, nota: d.nota || null,
    campos: d.campos.map(({ columna, etiqueta, tipo, requerido, opciones, ref, porDefecto, min }) =>
      ({ columna, etiqueta, tipo, requerido: !!requerido, opciones, ref, porDefecto, min }))
  }]));
}

function direccion(valor, etiqueta, requerido) {
  if (!valor || (!valor.calle && !valor.numero)) {
    if (requerido) v.texto('', etiqueta);
    return null;
  }
  return {
    calle: v.texto(valor.calle, `${etiqueta}: calle`),
    numero: v.texto(valor.numero, `${etiqueta}: número`, { max: 20 }),
    complemento: v.texto(valor.complemento, `${etiqueta}: complemento`, { opcional: true }),
    comuna_id: v.id(valor.comuna_id, `${etiqueta}: comuna`)
  };
}

// Valida y normaliza los datos según la definición; devuelve { valores, direcciones }
function validar(def, datos, esNuevo) {
  const valores = {}, direcciones = {};
  for (const c of def.campos) {
    if (!esNuevo && c.columna === def.clave && !def.claveEditable) continue;
    const x = datos[c.columna];
    const opc = { opcional: !c.requerido };
    switch (c.tipo) {
      case 'texto': {
        let t = v.texto(x, c.etiqueta, opc);
        if (t && c.mayusculas) t = t.toUpperCase();
        if (t && c.patron && !new RegExp(c.patron).test(t)) throw errores.solicitudInvalida(`${c.etiqueta} no tiene el formato esperado.`);
        valores[c.columna] = t; break;
      }
      case 'textarea': valores[c.columna] = v.texto(x, c.etiqueta, { ...opc, max: 20000 }); break;
      case 'numero': valores[c.columna] = v.entero(x, c.etiqueta, { ...opc, min: c.min ?? 0 }); break;
      case 'fecha': valores[c.columna] = v.fecha(x, c.etiqueta, opc); break;
      case 'bool': valores[c.columna] = v.booleano(x, c.porDefecto ?? false); break;
      case 'rut': valores[c.columna] = v.rut(x, c.etiqueta, opc); break;
      case 'email': valores[c.columna] = v.email(x, c.etiqueta, opc); break;
      case 'json': valores[c.columna] = v.json(x, c.etiqueta); break;
      case 'opcion': valores[c.columna] = v.opcion(x, c.opciones, c.etiqueta, opc); break;
      case 'ref': valores[c.columna] = v.id(x, c.etiqueta, opc); break;
      case 'direccion': direcciones[c.columna] = direccion(x, c.etiqueta, c.requerido); break;
      case 'archivo': {
        // ruta relativa a la carpeta de contratos (archivos.absoluta() rechaza las que salen de ella)
        const t = v.texto(x, c.etiqueta, { ...opc, max: 500 });
        if (t && !/.docx$/i.test(t)) throw errores.solicitudInvalida(`${c.etiqueta}: debe ser un archivo .docx.`);
        if (t) archivos.absoluta(t);
        valores[c.columna] = t; break;
      }
      default: throw new Error(`Tipo de campo desconocido: ${c.tipo}`);
    }
  }
  return { valores, direcciones };
}

async function listar(usuario, nombre) {
  exigirAdmin(usuario);
  const def = definicion(nombre);
  return { registros: await conUsuario(usuario, (db) => catalogosRepo.listar(db, def)) };
}

async function guardar(usuario, nombre, clave, datos) {
  exigirAdmin(usuario);
  const def = definicion(nombre);
  const esNuevo = clave === null || clave === undefined;
  const { valores, direcciones } = validar(def, datos || {}, esNuevo);
  return conUsuario(usuario, async (db) => {
    for (const [col, d] of Object.entries(direcciones)) valores[col] = d ? await direccionesRepo.obtenerOCrear(db, d) : null;
    if (esNuevo) return { clave: await catalogosRepo.crear(db, def, valores) };
    if (!(await catalogosRepo.actualizar(db, def, clave, valores))) throw errores.noEncontrado();
    return { clave };
  });
}

async function eliminar(usuario, nombre, clave) {
  exigirAdmin(usuario);
  const def = definicion(nombre);
  const ok = await conUsuario(usuario, (db) => catalogosRepo.eliminar(db, def, clave));
  if (!ok) throw errores.noEncontrado();
  return { ok: true };
}

module.exports = { definiciones, listar, guardar, eliminar };
