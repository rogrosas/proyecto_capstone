/* =========================================================
   CRM · utilidades de formato y presentación
   ========================================================= */
export const $ = (id) => document.getElementById(id);

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clp = (n) => (n === null || n === undefined || n === '' ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-CL'));

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const mesCorto = (m) => MESES[m - 1];

export function fecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${d} ${MESES[m - 1]} ${y}`;
}
export const fechaHora = (s) => (s ? `${fecha(s)} · ${String(s).slice(11, 16)}` : '—');
export const hoyISO = () => new Date().toISOString().slice(0, 10);

export const dias = (d) => (d === null || d === undefined ? ''
  : d === 0 ? 'hoy' : d > 0 ? `en ${d} día${d === 1 ? '' : 's'}` : `hace ${-d} día${d === -1 ? '' : 's'}`);

export const iniciales = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

export const filaVacia = (cols, msg, err) => `<tr><td colspan="${cols}" class="empty ${err ? 'err' : ''}">${esc(msg)}</td></tr>`;

export function toast(msg, err) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 4500);
}

/* ---------- badges de estado ---------- */
const B = {
  contrato: { pendiente: ['blu', 'Pendiente'], activo: ['grn', 'Activo'], vencido: ['red', 'Vencido'], cancelado: ['gry', 'Cancelado'] },
  documento: {
    borrador: ['gry', 'Borrador'], en_revision: ['blu', 'En revisión'], aprobado: ['grn', 'Aprobado'],
    enviado_firma: ['amb', 'Enviado a firma'], firmado: ['grn', 'Firmado'], rechazado: ['red', 'Rechazado'], anulado: ['gry', 'Anulado']
  },
  pago: { pendiente: ['amb', 'Pendiente'], pagado: ['grn', 'Pagado'], rechazado: ['red', 'Rechazado'], reembolsado: ['gry', 'Reembolsado'] },
  cliente: { 'Activo': ['grn', 'Activo'], 'Por vencer': ['amb', 'Por vencer'], 'Vencido': ['red', 'Vencido'], 'Pendiente': ['blu', 'Pendiente'], 'Sin contrato': ['gry', 'Sin contrato'] }
};
export function badge(tipo, valor) {
  const [c, t] = B[tipo]?.[valor] || ['gry', valor ?? '—'];
  return `<span class="bg ${c}">${esc(t)}</span>`;
}

export const PASARELAS = { transbank: 'Webpay (Transbank)', mercado_pago: 'Mercado Pago', transferencia: 'Transferencia', sin_pasarela: 'Sin pasarela' };
export const pasarela = (p) => PASARELAS[p] || esc(p || '—');
export const CICLO = { UNICO: 'Único', MENSUAL: 'Mensual', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual' };

// Archivo de un documento: Word guardado en la carpeta de contratos (se descarga por la API) o enlace externo
export const enlaceArchivo = (x) => !x.url_archivo ? '<span class="sb">—</span>'
  : /^https?:\/\//i.test(x.url_archivo) ? `<a href="${esc(x.url_archivo)}" target="_blank" rel="noopener">Enlace</a>`
  : `<a href="/api/crm/documentos/${x.id}/archivo" download>${esc(x.url_archivo.split('/').pop())}</a>`;
