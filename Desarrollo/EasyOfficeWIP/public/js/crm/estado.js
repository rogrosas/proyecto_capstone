/* =========================================================
   CRM · estado compartido entre módulos
   ========================================================= */
import { get } from './api.js';

export const estado = {
  usuario: null,
  conteos: {},
  opciones: null,
  filtros: {}      // filtros que un enlace deja para el módulo al que lleva (nav.ir(id, filtros))
};

// Filtros que dejó un enlace para este módulo (se usan una sola vez)
export function tomarFiltros(id) {
  const f = estado.filtros[id] || null;
  delete estado.filtros[id];
  return f;
}

// Listas para selectores (emisoras, sucursales, servicios, comunas...). Se cachean.
export async function opciones(recargar = false) {
  if (!estado.opciones || recargar) estado.opciones = await get('/opciones');
  return estado.opciones;
}

export const aOpciones = (lista, { soloActivos = false, texto = (x) => x.nombre } = {}) =>
  (lista || []).filter((x) => !soloActivos || x.activo !== false).map((x) => ({ valor: x.id, texto: texto(x) }));

// Navegación entre módulos (la define main.js)
export const nav = { ir: () => {} };
