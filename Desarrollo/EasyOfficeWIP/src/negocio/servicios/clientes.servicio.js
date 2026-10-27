/* =========================================================
   CAPA DE NEGOCIO · Clientes.
   Reglas: búsqueda por nombre, RUT con o sin puntos, o folio;
   solo el administrador puede eliminar (la BD además lo impide
   al rol_ejecutivo, que no tiene permiso DELETE).
   ========================================================= */
const { conUsuario } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const clientesRepo = require('../../datos/repositorios/clientes.repositorio');

const ESTADOS = ['Activo', 'Por vencer', 'Vencido', 'Pendiente', 'Sin contrato'];
const LIMITE = 500;

async function listar(usuario, { q, estado }) {
  const texto = String(q || '').trim().slice(0, 80);
  const filtros = {
    texto,
    rut: texto.toUpperCase().replace(/[^0-9K-]/g, ''),   // "18.204.331-5" -> "18204331-5"
    estado: ESTADOS.includes(estado) ? estado : ''
  };
  const clientes = await conUsuario(usuario, (db) => clientesRepo.listar(db, filtros, LIMITE));
  return { clientes };
}

async function eliminar(usuario, id) {
  if (!usuario.admin) throw errores.sinPermiso('Solo un administrador puede eliminar clientes.');
  id = Number(id);
  if (!Number.isInteger(id)) throw errores.solicitudInvalida('Cliente inválido.');
  const ok = await conUsuario(usuario, (db) => clientesRepo.eliminar(db, id));
  if (!ok) throw errores.noEncontrado('Cliente no encontrado o fuera de su cartera.');
  return { ok: true };
}

/* ---------- Ficha, alta y edición ---------- */

const representantesRepo = require('../../datos/repositorios/representantes.repositorio');
const direccionesRepo = require('../../datos/repositorios/direcciones.repositorio');
const contratosRepo = require('../../datos/repositorios/contratos.repositorio');
const documentosRepo = require('../../datos/repositorios/documentos.repositorio');
const pagosRepo = require('../../datos/repositorios/pagos.repositorio');
const cuentasPortalRepo = require('../../datos/repositorios/cuentasPortal.repositorio');
const v = require('../validacion');

async function ficha(usuario, id) {
  id = v.id(id, 'Cliente');
  return conUsuario(usuario, async (db) => {
    const cliente = await clientesRepo.obtener(db, id);
    if (!cliente) throw errores.noEncontrado('Cliente no encontrado o fuera de su cartera.');
    const representante = await representantesRepo.obtener(db, cliente.representante_legal_id);
    if (representante) representante.direccion = await direccionesRepo.obtener(db, representante.direccion_id);
    return {
      cliente,
      representante,
      accesos: accesosPortal(cliente, representante, await cuentasPortalRepo.porCliente(db, id)),
      contratos: await contratosRepo.porCliente(db, id),
      documentos: await documentosRepo.porCliente(db, id),
      pagos: await pagosRepo.porCliente(db, id)
    };
  });
}

/*
 * Personas que pueden ingresar a /mi-cuenta por este cliente:
 *   persona natural → el propio cliente (su correo)
 *   empresa         → el representante legal y las personas autorizadas en el CRM
 * Cada una con su estado en cuentas_portal (bloqueada, contraseña creada, último ingreso).
 */
function accesosPortal(cliente, representante, cuentas) {
  const igual = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const titular = cliente.tipo_persona === 'natural'
    ? cliente.email && { email: cliente.email, nombre: cliente.razon_social, vinculo: 'titular' }
    : representante?.email && { email: representante.email, nombre: representante.nombre_completo, vinculo: 'representante' };
  const lista = titular ? [titular] : [];
  for (const a of cuentas) {
    if (a.autorizado && !(titular && igual(a.email, titular.email))) lista.push({ email: a.email, nombre: a.nombre, vinculo: 'autorizado' });
  }
  return lista.map((x) => {
    const a = cuentas.find((c) => igual(c.email, x.email));
    return { ...x, activo: a ? a.activo : true, con_clave: !!a?.con_clave, ultimo_ingreso: a?.ultimo_ingreso || null };
  });
}

/*
 * Autoriza a una persona (solo empresas), le quita la autorización o bloquea / permite su acceso.
 * datos = { email, nombre?, autorizado?, activo? }
 */
async function guardarAcceso(usuario, id, datos = {}) {
  id = v.id(id, 'Cliente');
  const email = v.email(datos.email, 'Correo', { opcional: false });
  const autorizado = datos.autorizado === undefined ? undefined : v.booleano(datos.autorizado);
  const activo = datos.activo === undefined ? undefined : v.booleano(datos.activo);
  const nombre = v.texto(datos.nombre, 'Nombre', { opcional: autorizado !== true, max: 150 });
  return conUsuario(usuario, async (db) => {
    const cliente = await clientesRepo.obtener(db, id);
    if (!cliente) throw errores.noEncontrado('Cliente no encontrado o fuera de su cartera.');
    if (autorizado && cliente.tipo_persona !== 'juridica') {
      throw errores.solicitudInvalida('Solo se autorizan personas en empresas. Una persona natural ingresa con su propio correo.');
    }
    await cuentasPortalRepo.guardar(db, id, email, { nombre, autorizado, activo });
    return { ok: true };
  });
}

function validarCliente(d) {
  const cliente = {
    rut: v.rut(d.rut, 'RUT del cliente'),
    razon_social: v.texto(d.razon_social, 'Razón social'),
    nombre_fantasia: v.texto(d.nombre_fantasia, 'Nombre de fantasía', { opcional: true }),
    giro_principal: v.texto(d.giro_principal, 'Giro', { opcional: true }),
    email: v.email(d.email),
    celular: v.celular(d.celular),
    fecha_escritura: v.fecha(d.fecha_escritura, 'Fecha de escritura', { opcional: true }),
    sitio_notaria: v.texto(d.sitio_notaria, 'Sitio o notaría', { opcional: true })
  };
  const r = d.representante || {};
  const representante = r.rut ? {
    rut: v.rut(r.rut, 'RUT del representante'),
    nombre_completo: v.texto(r.nombre_completo, 'Nombre del representante'),
    nacionalidad: v.texto(r.nacionalidad, 'Nacionalidad', { opcional: true }),
    estado_civil: v.texto(r.estado_civil, 'Estado civil', { opcional: true }),
    profesion: v.texto(r.profesion, 'Profesión', { opcional: true }),
    email: v.email(r.email, 'Correo del representante'),
    direccion: r.direccion && r.direccion.calle ? {
      calle: v.texto(r.direccion.calle, 'Calle'),
      numero: v.texto(r.direccion.numero, 'Número', { max: 20 }),
      complemento: v.texto(r.direccion.complemento, 'Complemento', { opcional: true }),
      comuna_id: v.id(r.direccion.comuna_id, 'Comuna')
    } : null
  } : null;
  return { cliente, representante };
}

// Crea o actualiza el representante (por RUT) y devuelve su id
async function guardarRepresentante(db, r) {
  if (!r) return null;
  const datos = { ...r, direccion_id: r.direccion ? await direccionesRepo.obtenerOCrear(db, r.direccion) : null };
  const existente = await representantesRepo.buscarPorRut(db, r.rut);
  if (existente) {
    await representantesRepo.actualizar(db, existente, datos);
    return existente;
  }
  return representantesRepo.crear(db, datos);
}

async function crear(usuario, datos) {
  const { cliente, representante } = validarCliente(datos || {});
  return conUsuario(usuario, async (db) => {
    cliente.representante_legal_id = await guardarRepresentante(db, representante);
    return { id: await clientesRepo.crear(db, cliente) };
  });
}

async function actualizar(usuario, id, datos) {
  id = v.id(id, 'Cliente');
  const { cliente, representante } = validarCliente(datos || {});
  return conUsuario(usuario, async (db) => {
    cliente.representante_legal_id = await guardarRepresentante(db, representante);
    if (!(await clientesRepo.actualizar(db, id, cliente))) throw errores.noEncontrado('Cliente no encontrado o fuera de su cartera.');
    return { id };
  });
}

module.exports = { listar, eliminar, ficha, crear, actualizar, guardarAcceso };
