/* =========================================================
   CRM · arranque: sesión, menú lateral y carga de módulos.
   Cada módulo exporta { id, titulo, sub(), render(el) } y vive
   en js/crm/modulos/. Navegación por hash: /crm#contratos
   ========================================================= */
import { $, esc, iniciales, toast } from './util.js';
import { api, post, onSesionExpirada } from './api.js';
import { estado, nav } from './estado.js';
import { cerrarModal } from './modal.js';

import dashboard from './modulos/dashboard.js';
import clientes from './modulos/clientes.js';
import contratos from './modulos/contratos.js';
import renovaciones from './modulos/renovaciones.js';
import documentos from './modulos/documentos.js';
import tickets from './modulos/tickets.js';
import ventas from './modulos/ventas.js';
import auditoria from './modulos/auditoria.js';
import administracion from './modulos/administracion.js';

const correspondencia = {
  id: 'correspondencia', titulo: 'Correspondencia', sub: () => 'Pendiente en el modelo de datos',
  render(el) {
    el.innerHTML = `<div class="panel"><h3>Módulo no disponible en el modelo actual</h3>
      <div class="ph" style="margin-bottom:0;">La base de datos EO_ER no tiene una tabla para registrar la correspondencia recibida,
      digitalizada y despachada. Se habilitará cuando el equipo agregue esa entidad al modelo.</div></div>`;
  }
};

const MODULOS = [dashboard, clientes, contratos, renovaciones, documentos, tickets, ventas, correspondencia, auditoria, administracion];
let actual = 'dashboard';

function visibles() {
  return MODULOS.filter((m) => !m.soloAdmin || estado.usuario?.admin);
}

function renderMenu() {
  $('nav').innerHTML = visibles().map((m) => {
    const n = m.cnt && estado.conteos[m.cnt];
    return `<button class="nv ${m.id === actual ? 'on' : ''}" data-view="${m.id}">
      <svg class="ic" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M4.6 8.2l2.1 2.1 4.4-4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${esc(m.titulo)}${n ? `<span class="cnt ${m.verde ? 'g' : ''}">${n.toLocaleString('es-CL')}</span>` : ''}</button>`;
  }).join('');
}

async function ir(id) {
  const m = visibles().find((x) => x.id === id) || dashboard;
  actual = m.id;
  if (location.hash !== '#' + m.id) history.replaceState(null, '', '#' + m.id);
  cerrarModal();
  renderMenu();
  $('tt').textContent = m.titulo;
  $('ts').textContent = m.sub();
  const vista = $('vista');
  vista.innerHTML = '';
  window.scrollTo({ top: 0 });
  try {
    await m.render(vista, { refrescarMenu: renderMenu });
  } catch (err) {
    if (err.message !== 'sesion') vista.innerHTML = `<div class="panel"><div class="empty err">${esc(err.message)}</div></div>`;
  }
}
nav.ir = ir;

/* ---------- sesión ---------- */
function mostrarLogin(msg) {
  estado.usuario = null;
  estado.opciones = null;
  cerrarModal();
  $('app').hidden = true;
  $('gate').hidden = false;
  $('loginError').hidden = !msg;
  $('loginError').textContent = msg || '';
}
onSesionExpirada(mostrarLogin);

function entrar(u) {
  estado.usuario = u;
  $('gate').hidden = true;
  $('app').hidden = false;
  $('whoAv').textContent = iniciales(u.nombre);
  $('whoName').textContent = u.nombre;
  $('whoMail').textContent = u.email;
  $('rolBadge').textContent = u.admin ? 'Administrador' : 'Ejecutivo';
  $('rolBadge').className = 'bg ' + (u.admin ? 'grn' : 'gry');
  $('rolBadge').title = u.permisos?.length ? 'Permisos: ' + u.permisos.join(', ') : 'Sin permisos asignados';
  $('sessName').textContent = `${u.nombre} · ${u.rol}`;
  $('gPw').value = '';
  ir(location.hash.slice(1) || 'dashboard');
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btnLogin');
  btn.disabled = true;
  btn.textContent = 'Ingresando…';
  try {
    const { usuario } = await api('/login', { metodo: 'POST', datos: { email: $('gMail').value, password: $('gPw').value } });
    entrar(usuario);
  } catch (err) {
    mostrarLogin(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-view],[data-action="exit"],[data-pw]');
  if (!t) return;
  if (t.dataset.view) return ir(t.dataset.view);
  if (t.dataset.pw) {
    const el = $(t.dataset.pw);
    const show = el.type === 'password';
    el.type = show ? 'text' : 'password';
    t.textContent = show ? 'Ocultar' : 'Mostrar';
    return;
  }
  await post('/logout').catch(() => {});
  mostrarLogin();
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });
window.addEventListener('hashchange', () => { if (estado.usuario && location.hash.slice(1) !== actual) ir(location.hash.slice(1)); });
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.message && e.reason.message !== 'sesion') toast(e.reason.message, true); });

/* ---------- inicio: ¿sesión abierta? ---------- */
fetch('/api/crm/yo', { credentials: 'same-origin' })
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => (d ? entrar(d.usuario) : mostrarLogin()))
  .catch(() => mostrarLogin());
