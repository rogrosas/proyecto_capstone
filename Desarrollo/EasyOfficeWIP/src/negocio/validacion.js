/* =========================================================
   CAPA DE NEGOCIO · Validación y normalización de datos de entrada.
   Replica las reglas CHECK de easyoffice_er.sql para dar mensajes
   claros antes de llegar a la base de datos (que igual las vuelve a
   validar).
   ========================================================= */
const { errores } = require('../comun/errores');

const invalido = (m) => { throw errores.solicitudInvalida(m); };

// Igual que fn_rut_valido(): formato 12345678-K y dígito verificador módulo 11
function rutValido(rut) {
  if (!/^[0-9]{7,8}-[0-9K]$/.test(rut)) return false;
  const [cuerpo, dv] = rut.split('-');
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const r = 11 - (suma % 11);
  return dv === (r === 11 ? '0' : r === 10 ? 'K' : String(r));
}

// "18.204.331-k" -> "18204331-K"
function rut(valor, etiqueta = 'RUT', { opcional = false } = {}) {
  const v = String(valor ?? '').toUpperCase().replace(/[^0-9K]/g, '');
  if (!v) return opcional ? null : invalido(`${etiqueta} es obligatorio.`);
  const normal = `${v.slice(0, -1)}-${v.slice(-1)}`;
  if (!rutValido(normal)) invalido(`${etiqueta} no es válido (revise el dígito verificador).`);
  return normal;
}

function texto(valor, etiqueta, { opcional = false, max = 300 } = {}) {
  const v = String(valor ?? '').trim();
  if (!v) return opcional ? null : invalido(`${etiqueta} es obligatorio.`);
  if (v.length > max) invalido(`${etiqueta} supera ${max} caracteres.`);
  return v;
}

function email(valor, etiqueta = 'Correo', { opcional = true } = {}) {
  const v = texto(valor, etiqueta, { opcional, max: 200 });
  if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) invalido(`${etiqueta} no es válido.`);
  return v ? v.toLowerCase() : null;
}

// Celular chileno: 9 dígitos que empiezan en 9 ("+56 9 1234 5678" -> "912345678")
function celular(valor, { opcional = true } = {}) {
  let v = String(valor ?? '').replace(/\D/g, '');
  if (!v) return opcional ? null : invalido('El celular es obligatorio.');
  if (v.length === 11 && v.startsWith('56')) v = v.slice(2);
  if (!/^9[0-9]{8}$/.test(v)) invalido('El celular debe tener 9 dígitos y empezar con 9.');
  return v;
}

function fecha(valor, etiqueta, { opcional = false } = {}) {
  const v = String(valor ?? '').trim();
  if (!v) return opcional ? null : invalido(`${etiqueta} es obligatoria.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) invalido(`${etiqueta} no es una fecha válida.`);
  return v;
}

function entero(valor, etiqueta, { opcional = false, min = -Infinity, max = Infinity } = {}) {
  if (valor === null || valor === undefined || valor === '') return opcional ? null : invalido(`${etiqueta} es obligatorio.`);
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) invalido(`${etiqueta} no es válido.`);
  return n;
}

const id = (valor, etiqueta = 'Identificador', opciones = {}) => entero(valor, etiqueta, { min: 1, ...opciones });

function monto(valor, etiqueta = 'Monto', { opcional = false, min = 0 } = {}) {
  return entero(valor, etiqueta, { opcional, min });
}

function opcion(valor, permitidas, etiqueta, { opcional = false } = {}) {
  if (valor === null || valor === undefined || valor === '') return opcional ? null : invalido(`${etiqueta} es obligatorio.`);
  if (!permitidas.includes(valor)) invalido(`${etiqueta} no es válido.`);
  return valor;
}

const booleano = (valor, porDefecto = false) =>
  valor === undefined || valor === null || valor === '' ? porDefecto : valor === true || valor === 'true' || valor === 'on' || valor === 1;

function json(valor, etiqueta) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'object') return valor;
  try { return JSON.parse(valor); } catch { return invalido(`${etiqueta} no es JSON válido.`); }
}

const CICLOS = ['UNICO', 'MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];

module.exports = { rutValido, rut, texto, email, celular, fecha, entero, id, monto, opcion, booleano, json, CICLOS };
