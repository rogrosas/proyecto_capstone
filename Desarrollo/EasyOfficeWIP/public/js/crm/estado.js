/* =========================================================
   CRM · estado compartido entre módulos
   ========================================================= */
import { get } from './api.js';

export const estado = {
  usuario: null,
  conteos: {},
  opciones: null
};

// Listas para selectores (emisoras, sucursales, servicios, comunas...). Se cachean.
export async function opciones(recargar = false) {
  if (!estado.opciones || recargar) estado.opciones = await get('/opciones');
  return estado.opciones;
}

export const aOpciones = (lista, { soloActivos = false, texto = (x) => x.nombre } = {}) =>
  (lista || []).filter((x) => !soloActivos || x.activo !== false).map((x) => ({ valor: x.id, texto: texto(x) }));

// Navegación entre módulos (la define main.js)
export const nav = { ir: () => {} };
