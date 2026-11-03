/* =========================================================
   CRM · llamadas a /api/crm
   ========================================================= */
let alExpirar = () => {};
export const onSesionExpirada = (fn) => { alExpirar = fn; };

export class ErrorApi extends Error {
  constructor(mensaje, status) { super(mensaje); this.status = status; }
}

export async function api(ruta, { metodo = 'GET', datos } = {}) {
  const res = await fetch('/api/crm' + ruta, {
    method: metodo,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: datos === undefined ? undefined : JSON.stringify(datos)
  });
  const data = await res.json().catch(() => ({}));
  // Un 401 en las rutas de ingreso es un dato mal escrito, no una sesión vencida
  if (res.status === 401 && !['/login', '/login/codigo', '/clave', '/clave/definir'].includes(ruta)) {
    alExpirar('Su sesión expiró. Ingrese nuevamente.');
    throw new ErrorApi('sesion', 401);
  }
  if (!res.ok) throw new ErrorApi(data.error || 'Error inesperado.', res.status);
  return data;
}

export const get = (r) => api(r);
export const post = (r, d) => api(r, { metodo: 'POST', datos: d || {} });
export const put = (r, d) => api(r, { metodo: 'PUT', datos: d });
export const patch = (r, d) => api(r, { metodo: 'PATCH', datos: d });
export const del = (r) => api(r, { metodo: 'DELETE' });

// Descarga un listado como CSV (Excel) con los mismos filtros de la pantalla
export async function exportar(lista, filtros = {}) {
  const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const res = await fetch(`/api/crm/exportar/${lista}?${q}`, { credentials: 'same-origin' });
  if (res.status === 401) { alExpirar('Su sesión expiró. Ingrese nuevamente.'); throw new ErrorApi('sesion', 401); }
  if (!res.ok) throw new ErrorApi((await res.json().catch(() => ({}))).error || 'No se pudo exportar.', res.status);
  const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `${lista}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
