/* =========================================================
   CAPA DE NEGOCIO · Portal de clientes con correo y contraseña.

   Ingreso:
     PERSONA  correo del cliente (clientes.email) + contraseña.
     EMPRESA  RUT de la empresa + correo de una persona vinculada
              (representante legal o autorizada en el CRM) + contraseña.
   La contraseña es por persona y por cliente (cuentas_portal, bcrypt).

   Crear o recuperar la contraseña:
     1. La persona indica empresa/persona, (RUT) y correo. Si está vinculada,
        se le envía un enlace por cada cliente (una persona puede tener varias empresas).
     2. El enlace lleva un token firmado (HMAC-SHA256) con el cliente, el correo,
        el vencimiento (15 min) y un identificador único: no se guarda en la BD
        y solo se puede usar una vez.
     3. Al abrirlo define su contraseña y queda con la sesión iniciada.
   Registro (quien aún no es cliente):
     1. Indica persona o empresa, sus datos y la contraseña. Se valida todo
        (RUT con dígito verificador, correo, celular, contraseña, aceptación)
        y que el RUT no sea ya cliente; queda pendiente en memoria (15 min).
     2. Se le envía un enlace al correo: el cliente se crea (origen 'web')
        solo al abrirlo, así el correo queda comprobado.
     3. Al confirmar queda con la sesión iniciada.
   Las respuestas de ingreso y contraseña no revelan si un correo o RUT es cliente.
   ========================================================= */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../../config');
const { errores } = require('../../comun/errores');
const { conCliente, conSistema } = require('../../datos/conexion');
const correo = require('../../datos/correo');
const portalRepo = require('../../datos/repositorios/portal.repositorio');
const sesionesRepo = require('../../datos/repositorios/sesiones.repositorio');
const clientesRepo = require('../../datos/repositorios/clientes.repositorio');
const tiendaRepo = require('../../datos/repositorios/tienda.repositorio');
const representantesRepo = require('../../datos/repositorios/representantes.repositorio');
const direccionesRepo = require('../../datos/repositorios/direcciones.repositorio');
const contratosRepo = require('../../datos/repositorios/contratos.repositorio');
const firmaRepo = require('../../datos/repositorios/firma.repositorio');
const firmaServicio = require('./firma.servicio');
const documentosRepo = require('../../datos/repositorios/documentos.repositorio');
const pagosRepo = require('../../datos/repositorios/pagos.repositorio');
const v = require('../validacion');

const SECRETO = config.cliente.secreto || crypto.randomBytes(32).toString('hex');
if (!config.cliente.secreto) {
  console.warn('[portal] Falta CLIENTE_SECRETO en .env: se generó uno temporal (los enlaces enviados dejan de servir al reiniciar).');
}

const MENSAJE_ENVIADO = 'Si los datos corresponden a una cuenta de Easy Office, le enviamos un enlace para crear su contraseña. Revise su bandeja de entrada (y la carpeta de spam). El enlace vence en 15 minutos.';
const DATOS_INCORRECTOS = 'Los datos de acceso no son correctos. Si aún no tiene contraseña, use "Crear o recuperar contraseña".';

// Hash de relleno: un correo sin cuenta tarda lo mismo que uno con cuenta
const HASH_FALSO = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);
const TIPOS = { empresa: 'juridica', persona: 'natural' };

/* ---------- límite de intentos por IP y por correo ---------- */
const solicitudes = new Map(); // clave -> { n, desde }
function excedido(clave, max) {
  const ahora = Date.now();
  const r = solicitudes.get(clave);
  if (!r || ahora - r.desde > config.cliente.ventanaMs) { solicitudes.set(clave, { n: 1, desde: ahora }); return false; }
  r.n++;
  return r.n > max;
}

// Ingreso: solo cuentan los intentos fallidos (como el login del CRM), así varios
// clientes detrás de la misma IP no se bloquean entre sí por ingresar bien.
function bloqueado(clave) {
  const r = solicitudes.get(clave);
  return !!r && Date.now() - r.desde <= config.cliente.ventanaMs && r.n >= config.login.maxIntentos;
}
function sumarFallo(...claves) {
  for (const clave of claves) excedido(clave, Infinity);
}

/* ---------- datos de acceso ---------- */
// { tipo: 'empresa' | 'persona', rut (empresa), email } → { tipo de cliente, rut normalizado, email }
function leerAcceso(datos) {
  const tipo = Object.hasOwn(TIPOS, datos?.tipo ?? '') ? TIPOS[datos.tipo] : null;   // no "__proto__" ni "constructor"
  if (!tipo) throw errores.solicitudInvalida('Indique si ingresa como empresa o como persona.');
  const rut = tipo === 'juridica' ? v.rut(datos.rut, 'RUT de la empresa') : null;
  const email = v.email(datos.email, 'Correo', { opcional: false });
  return { tipo, rut, email };
}

function validarClave(password) {
  const p = String(password ?? '');
  if (p.length < 8) throw errores.solicitudInvalida('La contraseña debe tener al menos 8 caracteres.');
  if (Buffer.byteLength(p) > 72) throw errores.solicitudInvalida('La contraseña es demasiado larga (máximo 72 caracteres).');
  return p;
}

/* ---------- registro ---------- */
const RUT_EMPRESA = 50000000;   // en Chile las personas jurídicas tienen RUT desde 50.000.000
const cuerpoRut = (rut) => Number(rut.split('-')[0]);
const LETRAS = 'A-Za-zÁÉÍÓÚÜÑáéíóúüñ';

// Contraseña nueva del registro: además del largo, letras y números
function claveSegura(password) {
  const p = validarClave(password);
  if (!new RegExp(`[${LETRAS}]`).test(p) || !/[0-9]/.test(p)) throw errores.solicitudInvalida('La contraseña debe combinar letras y números.');
  return p;
}

function nombrePersona(valor) {
  const n = v.texto(valor, 'Nombre completo', { max: 150 }).replace(/\s+/g, ' ');
  if (!new RegExp(`^[${LETRAS}' .-]+$`).test(n)) throw errores.solicitudInvalida('El nombre solo puede tener letras, espacios, apóstrofos y guiones.');
  if (n.split(' ').filter((p) => p.replace(new RegExp(`[^${LETRAS}]`, 'g'), '').length >= 2).length < 2) {
    throw errores.solicitudInvalida('Ingrese su nombre y al menos un apellido.');
  }
  return n;
}

/*
 * datos = { tipo: 'persona' | 'empresa', nombre, rut, email, celular, password, acepta, comunicaciones,
 *           empresa: { rut, razon_social, giro }, representante (empresa: declara serlo) }
 */
function leerRegistro(datos = {}) {
  const tipo = Object.hasOwn(TIPOS, datos?.tipo ?? '') ? TIPOS[datos.tipo] : null;
  if (!tipo) throw errores.solicitudInvalida('Indique si se registra como empresa o como persona.');
  const persona = {
    nombre: nombrePersona(datos.nombre),
    rut: v.rut(datos.rut, tipo === 'juridica' ? 'RUT del representante legal' : 'RUT'),
    email: v.email(datos.email, 'Correo', { opcional: false }),
    celular: v.celular(datos.celular, { opcional: false })
  };
  if (cuerpoRut(persona.rut) >= RUT_EMPRESA) {
    throw errores.solicitudInvalida(tipo === 'juridica'
      ? 'El RUT del representante legal debe ser el de una persona, no el de una empresa.'
      : 'Ese RUT es de una empresa: regístrese como empresa.');
  }
  let empresa = null;
  if (tipo === 'juridica') {
    const e = datos.empresa || {};
    empresa = {
      rut: v.rut(e.rut, 'RUT de la empresa'),
      razon_social: v.texto(e.razon_social, 'Razón social', { max: 200 }).replace(/\s+/g, ' '),
      giro: v.texto(e.giro, 'Giro', { opcional: true, max: 200 })
    };
    if (empresa.razon_social.length < 3) throw errores.solicitudInvalida('La razón social es demasiado corta.');
    if (cuerpoRut(empresa.rut) < RUT_EMPRESA) throw errores.solicitudInvalida('El RUT de la empresa no corresponde a una persona jurídica (debe ser desde 50.000.000).');
    if (datos.representante !== true) throw errores.solicitudInvalida('Debe declarar que es el representante legal de la empresa.');
  }
  const password = claveSegura(datos.password);
  if (datos.acepta !== true) throw errores.solicitudInvalida('Debe aceptar las condiciones del servicio y el tratamiento de sus datos.');
  return { tipo, persona, empresa, password, comunicaciones: datos.comunicaciones === true };
}

const YA_REGISTRADO = 'Ese RUT ya tiene una cuenta en Easy Office. Ingrese con su correo o use "Crear o recuperar contraseña".';
const REP_OTRO_CORREO = 'El RUT del representante legal ya está registrado con otro correo. Use ese correo o escríbanos a info@easyoffice.cl.';

// Revisa en la base que el registro se pueda hacer (antes de enviar el correo y otra vez al confirmar)
async function revisarRegistro(db, r) {
  if (await tiendaRepo.clientePorRut(db, r.empresa ? r.empresa.rut : r.persona.rut)) throw errores.conflicto(YA_REGISTRADO);
  if (r.empresa) {
    const correoRep = await tiendaRepo.correoRepresentante(db, r.persona.rut);
    if (correoRep && correoRep !== r.persona.email) throw errores.conflicto(REP_OTRO_CORREO);
  }
}

function correoRegistro(r, url) {
  const nombre = r.empresa ? r.empresa.razon_social : r.persona.nombre;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#333;">
    <h2 style="font-family:Georgia,serif;color:#282828;">Confirme su correo</h2>
    <p>Hola ${esc(r.persona.nombre)}: recibimos la solicitud para crear la cuenta de <b>${esc(nombre)}</b> en Easy Office con este correo.
    Use el botón para confirmarla e ingresar.</p>
    <p style="margin-top:22px;"><a href="${esc(url)}" style="background:#24D356;color:#fff;text-decoration:none;padding:10px 18px;border-radius:3px;font-weight:600;display:inline-block;">Confirmar mi cuenta</a></p>
    <p style="font-size:12px;color:#69727D;margin-top:20px;">El enlace vence en 15 minutos y sirve una sola vez.
    Si usted no lo solicitó, ignore este mensaje: no se creará ninguna cuenta.</p></div>`;
  const texto = `Confirme su cuenta de Easy Office (${nombre}):\n${url}\n\nEl enlace vence en 15 minutos y sirve una sola vez.`;
  return { para: r.persona.email, asunto: 'Confirme su cuenta de Easy Office', html, texto };
}

/* ---------- token firmado ---------- */
const b64 = (s) => Buffer.from(s).toString('base64url');
const firmar = (datos) => crypto.createHmac('sha256', SECRETO).update(datos).digest('base64url');

function crearToken(clienteId, tipo, email) {
  const carga = b64(JSON.stringify({
    c: clienteId,
    t: tipo,
    e: email,
    x: Date.now() + config.cliente.enlaceMs,
    n: crypto.randomBytes(12).toString('hex')
  }));
  return `${carga}.${firmar(carga)}`;
}

function leerToken(token) {
  const [carga, firma] = String(token || '').split('.');
  if (!carga || !firma) return null;
  const esperada = firmar(carga);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try { return JSON.parse(Buffer.from(carga, 'base64url').toString()); } catch { return null; }
}

/* ---------- correo ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function correoClave(email, enlaces) {
  const filas = enlaces.map(({ cliente, url }) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #E4E7E9;">
      <div style="font-weight:600;color:#282828;">${esc(cliente.razon_social)}</div>
      <div style="font-size:12px;color:#69727D;">RUT ${esc(cliente.rut_fmt)}</div>
    </td><td style="padding:10px 0;border-bottom:1px solid #E4E7E9;text-align:right;">
      <a href="${esc(url)}" style="background:#24D356;color:#fff;text-decoration:none;padding:10px 18px;border-radius:3px;font-weight:600;display:inline-block;">Crear contraseña</a>
    </td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#333;">
    <h2 style="font-family:Georgia,serif;color:#282828;">Su contraseña de Easy Office</h2>
    <p>Recibimos una solicitud para crear o cambiar la contraseña del correo <b>${esc(email)}</b>.
    ${enlaces.length > 1 ? 'Este correo está vinculado a varias cuentas; cada una tiene su propia contraseña:' : 'Use el botón para definirla:'}</p>
    <table style="width:100%;border-collapse:collapse;">${filas}</table>
    <p style="font-size:12px;color:#69727D;margin-top:20px;">El enlace vence en 15 minutos y sirve una sola vez.
    Si usted no lo solicitó, ignore este mensaje: su contraseña actual sigue igual.</p></div>`;
  const texto = `Su contraseña de Easy Office\n\n${enlaces.map(({ cliente, url }) => `${cliente.razon_social}: ${url}`).join('\n')}\n\nEl enlace vence en 15 minutos y sirve una sola vez.`;
  return { para: email, asunto: 'Cree su contraseña de Easy Office', html, texto };
}

/* ---------- sesión ---------- */
async function abrirSesion(cliente, email) {
  const sesion = { id: cliente.id, razon_social: cliente.razon_social, rut: cliente.rut_fmt, email, tipo: cliente.tipo_persona };
  const token = crypto.randomBytes(32).toString('hex');
  sesionesRepo.guardarCliente(token, sesion, Date.now() + config.cliente.duracionMs);
  try {
    await portalRepo.marcarIngreso(cliente.id, email);
    await portalRepo.registrarAcceso(cliente.id, 'LOGIN');
  } catch (err) { console.warn('[portal] auditoría:', err.message); }
  return { token, cliente: sesion };
}

/* ---------- casos de uso ---------- */

// Devuelve { token de sesión, cliente } o lanza error con un mensaje que no revela qué dato falló
async function iniciarSesion(datos, ip) {
  const { tipo, rut, email } = leerAcceso(datos);
  const password = String(datos?.password ?? '');
  if (!password) throw errores.solicitudInvalida('Ingrese su contraseña.');
  const claves = ['ingreso-ip:' + ip, 'ingreso:' + email];
  if (claves.some(bloqueado)) throw errores.demasiadosIntentos('Demasiados intentos. Espere 15 minutos e intente de nuevo.');
  const cuentas = (await portalRepo.vinculos(email, tipo, rut)).filter((c) => c.activo && c.password_hash);
  if (!cuentas.length) {
    await bcrypt.compare(password, HASH_FALSO);
    sumarFallo(...claves);
    throw errores.noAutenticado(DATOS_INCORRECTOS);
  }
  // Una persona natural no indica RUT: puede haber más de un cliente con su correo
  for (const c of cuentas) {
    if (await bcrypt.compare(password, c.password_hash)) {
      solicitudes.delete('ingreso:' + email);
      return abrirSesion(c, email);
    }
  }
  sumarFallo(...claves);
  throw errores.noAutenticado(DATOS_INCORRECTOS);
}

// Enlace para crear la contraseña de una persona vinculada a un cliente (va en el correo con el documento)
const enlaceClave = (clienteId, tipoCliente, email) => `${config.appUrl}/mi-cuenta?clave=${crearToken(clienteId, tipoCliente, email)}`;

async function solicitarClave(datos, ip) {
  const { tipo, rut, email } = leerAcceso(datos);
  if (excedido('clave-ip:' + ip, config.cliente.maxSolicitudes) || excedido('clave:' + email, config.cliente.maxSolicitudes)) {
    throw errores.demasiadosIntentos('Demasiadas solicitudes. Espere unos minutos e intente de nuevo.');
  }
  const clientes = (await portalRepo.vinculos(email, tipo, rut)).filter((c) => c.activo);
  if (clientes.length) {
    const enlaces = clientes.map((cliente) => ({ cliente, url: `${config.appUrl}/mi-cuenta?clave=${crearToken(cliente.id, tipo, email)}` }));
    try {
      await correo.enviar(correoClave(email, enlaces));
      if (correo.modoDesarrollo()) enlaces.forEach(({ cliente, url }) => console.log(`[portal · desarrollo] Enlace de contraseña para ${email} en ${cliente.razon_social}: ${url}`));
    } catch (err) {
      console.error('[portal] no se pudo enviar el correo de contraseña:', err.message);
      throw errores.sinBaseDatos('No pudimos enviar el correo en este momento. Intente más tarde.');
    }
  }
  return { mensaje: MENSAJE_ENVIADO };
}

// Define la contraseña con el enlace del correo y deja la sesión iniciada
async function definirClave(token, password) {
  const datos = leerToken(token);
  const invalido = errores.noAutenticado('El enlace no es válido o ya venció. Pida uno nuevo.');
  if (!datos || typeof datos.x !== 'number' || datos.x < Date.now()) throw invalido;
  const clave = validarClave(password);
  // El vínculo pudo cambiar después de enviar el enlace (otro correo, acceso quitado)
  const cliente = (await portalRepo.vinculos(datos.e, datos.t)).find((c) => c.id === datos.c && c.activo);
  if (!cliente) throw invalido;
  if (!sesionesRepo.consumirEnlace(datos.n, datos.x)) throw errores.noAutenticado('Este enlace ya se usó. Pida uno nuevo.');

  await portalRepo.guardarClave(cliente.id, datos.e, await bcrypt.hash(clave, 12));
  return abrirSesion(cliente, datos.e);
}

// Registro: valida, revisa que el RUT no sea cliente y envía el enlace para confirmar el correo
async function registrar(datos, ip) {
  const r = leerRegistro(datos);
  if (excedido('registro-ip:' + ip, config.cliente.maxSolicitudes) || excedido('registro:' + r.persona.email, config.cliente.maxSolicitudes)) {
    throw errores.demasiadosIntentos('Demasiadas solicitudes de registro. Espere unos minutos e intente de nuevo.');
  }
  await conSistema((db) => revisarRegistro(db, r));
  const pendiente = { tipo: r.tipo, persona: r.persona, empresa: r.empresa, comunicaciones: r.comunicaciones, hash: await bcrypt.hash(r.password, 12) };
  const token = crypto.randomBytes(32).toString('base64url');
  sesionesRepo.guardarRegistro(token, pendiente, Date.now() + config.cliente.enlaceMs);
  const url = `${config.appUrl}/mi-cuenta?registro=${token}`;
  try {
    await correo.enviar(correoRegistro(r, url));
    if (correo.modoDesarrollo()) console.log(`[portal · desarrollo] Enlace de registro para ${r.persona.email}: ${url}`);
  } catch (err) {
    sesionesRepo.tomarRegistro(token);
    console.error('[portal] no se pudo enviar el correo de registro:', err.message);
    throw errores.sinBaseDatos('No pudimos enviar el correo en este momento. Intente más tarde.');
  }
  return { mensaje: `Le enviamos un correo a ${r.persona.email} para confirmar su cuenta. Abra el enlace en los próximos 15 minutos (revise también la carpeta de spam).` };
}

// Confirma el registro con el enlace del correo: crea el cliente y su cuenta, y deja la sesión iniciada
async function confirmarRegistro(token) {
  const r = typeof token === 'string' && token.length <= 100 ? sesionesRepo.tomarRegistro(token) : null;
  if (!r) throw errores.noAutenticado('El enlace de confirmación no es válido, ya se usó o venció. Regístrese de nuevo.');
  const { persona, empresa } = r;
  const rutCliente = empresa ? empresa.rut : persona.rut;
  const id = await conSistema(async (db) => {
    await revisarRegistro(db, r);   // otro pudo registrar el mismo RUT mientras tanto
    const repId = empresa ? await tiendaRepo.representante(db, {
      rut: persona.rut, nombre_completo: persona.nombre, email: persona.email, direccion_id: null
    }) : null;
    return tiendaRepo.crearCliente(db, {
      rut: rutCliente, tipo_persona: r.tipo,
      razon_social: empresa ? empresa.razon_social : persona.nombre, giro_principal: empresa?.giro || null,
      email: persona.email, celular: persona.celular, representante_legal_id: repId, direccion_id: null,
      acepta_comunicaciones: r.comunicaciones
    });
  });
  await portalRepo.guardarClave(id, persona.email, r.hash);
  const cliente = (await portalRepo.vinculos(persona.email, r.tipo, rutCliente)).find((c) => c.id === id);
  return abrirSesion(cliente, persona.email);
}

function validarSesion(token) {
  const s = token && sesionesRepo.obtenerCliente(token);
  if (!s) return null;
  if (s.expira < Date.now()) { sesionesRepo.eliminarCliente(token); return null; }
  return s.cliente;
}

async function cerrarSesion(token) {
  const s = token && sesionesRepo.obtenerCliente(token);
  if (!s) return;
  sesionesRepo.eliminarCliente(token);
  try { await portalRepo.registrarAcceso(s.cliente.id, 'LOGOUT'); } catch (err) { console.warn('[portal] auditoría:', err.message); }
}

/*
 * Panel del cliente. El id sale SIEMPRE de la sesión; los repositorios filtran por él
 * y la transacción es de solo lectura.
 */
async function panel(sesion) {
  return conCliente(async (db) => {
    const cliente = await clientesRepo.obtener(db, sesion.id);
    if (!cliente) throw errores.noAutenticado('Su cuenta ya no está disponible.');
    const representante = await representantesRepo.obtener(db, cliente.representante_legal_id);
    if (representante) representante.direccion = await direccionesRepo.obtener(db, representante.direccion_id);
    const contratos = await contratosRepo.porCliente(db, sesion.id);
    for (const k of contratos) k.detalle_servicios = await contratosRepo.servicios(db, k.id);
    const documentos = await documentosRepo.porCliente(db, sesion.id);
    for (const d of documentos) {
      if (['enviado_firma', 'firmado', 'rechazado'].includes(d.estado)) d.firma = await firmaServicio.firmaParaCliente(db, d, sesion.email);
    }
    const pagos = await pagosRepo.porCliente(db, sesion.id);
    const saldoFirmas = await firmaRepo.saldo(db, sesion.id);
    return {
      cliente: {
        razon_social: cliente.razon_social, nombre_fantasia: cliente.nombre_fantasia, rut: cliente.rut_fmt,
        giro: cliente.giro_principal, email: cliente.email, celular: cliente.celular, desde: cliente.creado_en
      },
      representante: representante && {
        nombre: representante.nombre_completo, rut: representante.rut_fmt,
        domicilio: representante.direccion ? `${representante.direccion.texto}, ${representante.direccion.region}` : null
      },
      contratos: contratos.map((k) => ({
        folio: k.folio, estado: k.estado, inicio: k.inicio, vence: k.vence, dias: k.dias, duracion_meses: k.duracion_meses,
        emisora: k.emisora, sucursal: k.sucursal, ejecutivo: k.ejecutivo,
        total: k.total_servicios, pagado: k.pagado, saldo: k.saldo,
        servicios: k.detalle_servicios.map((s) => ({ nombre: s.nombre, precio: s.precio, ciclo: s.ciclo_pago }))
      })),
      documentos: documentos.map((d) => ({
        id: d.id, tipo: d.tipo, folio: d.folio, estado: d.estado, generado: d.generado, firmado: d.firmado, codigo: d.codigo_verificacion,
        estado_cliente: d.estado_cliente, publicado: d.publicado, aceptado: d.aceptado,
        con_firmado: d.con_firmado, firma: d.firma || null
      })),
      // Bolsas y planes con firmas incluidas: saldo vigente y últimos movimientos
      firmas: saldoFirmas && { ...saldoFirmas, movimientos: await firmaRepo.movimientos(db, sesion.id, 10) },
      pagos: pagos.map((p) => ({ id: p.id, fecha: p.fecha, referencia: p.referencia, monto: p.monto, pasarela: p.pasarela, estado: p.estado, cuota: p.cuota, total_cuotas: p.total_cuotas, contrato: !!p.contrato_id }))
    };
  });
}

/*
 * Datos para rellenar la compra en /contratar con la sesión iniciada (el comprador los puede editar).
 * Persona: sus propios datos y domicilio. Empresa: la empresa y, si quien ingresó es el representante
 * legal, también su nombre, RUT y domicilio; otra persona autorizada completa los suyos.
 * El correo es siempre el de la sesión: es el que la tienda reconoce como vinculado al cliente.
 */
async function datosCompra(sesion) {
  return conCliente(async (db) => {
    const cliente = await clientesRepo.obtener(db, sesion.id);
    if (!cliente) throw errores.noAutenticado('Su cuenta ya no está disponible.');
    const direccionDe = async (id) => {
      const d = await direccionesRepo.obtener(db, id);
      return d && { calle: d.calle, numero: d.numero, complemento: d.complemento || '', comuna_id: d.comuna_id };
    };
    if (cliente.tipo_persona === 'natural') {
      return {
        tipo: 'persona',
        titular: { nombre: cliente.razon_social, rut: cliente.rut_fmt, email: sesion.email, celular: cliente.celular || '' },
        empresa: null,
        direccion: await direccionDe(cliente.direccion_id)
      };
    }
    const rep = await representantesRepo.obtener(db, cliente.representante_legal_id);
    const esRepresentante = !!rep?.email && rep.email.toLowerCase() === String(sesion.email).toLowerCase();
    return {
      tipo: 'empresa',
      titular: {
        nombre: esRepresentante ? rep.nombre_completo : '', rut: esRepresentante ? rep.rut_fmt : '',
        email: sesion.email, celular: cliente.celular || ''
      },
      empresa: { rut: cliente.rut_fmt, razon_social: cliente.razon_social, giro: cliente.giro_principal || '' },
      direccion: esRepresentante ? await direccionDe(rep.direccion_id) : null
    };
  });
}

module.exports = {
  iniciarSesion, solicitarClave, definirClave, enlaceClave, registrar, confirmarRegistro, validarSesion, cerrarSesion, panel, datosCompra
};
