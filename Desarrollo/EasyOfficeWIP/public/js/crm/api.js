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
  if (res.status === 401 && ruta !== '/login') {
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
