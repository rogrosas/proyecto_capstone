/* =========================================================
   Transversal · Formato común de los correos que envía la aplicación.
   ========================================================= */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const boton = (url, texto) => `<p style="margin-top:22px;"><a href="${esc(url)}" style="background:#24D356;color:#fff;text-decoration:none;padding:10px 18px;border-radius:3px;font-weight:600;display:inline-block;">${esc(texto)}</a></p>`;
const cuerpo = (html) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#333;">${html}</div>`;
const titulo = (t) => `<h2 style="font-family:Georgia,serif;color:#282828;">${esc(t)}</h2>`;
const pie = '<p style="color:#888;font-size:12px;margin-top:26px;">Easy Office · Este es un correo automático, no lo responda.</p>';

// '2026-12-31' -> '31-12-2026'
const fechaCl = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('-') : '');

module.exports = { esc, boton, cuerpo, titulo, pie, fechaCl };
