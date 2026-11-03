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
import correspondencia from './modulos/correspondencia.js';
import { abrirSeguridad } from './modulos/seguridad.js';

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

async function ir(id, filtros) {
  const m = visibles().find((x) => x.id === id) || dashboard;
  if (filtros) estado.filtros[m.id] = filtros;
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
// Tarjetas de acceso: ingreso, código de dos pasos, olvido de contraseña y nueva contraseña
function verTarjeta(id) {
  for (const t of ['loginForm', 'codigoForm', 'olvidoForm', 'claveForm']) $(t).hidden = t !== id;
}
const mensaje = (id, texto) => { $(id).hidden = !texto; $(id).textContent = texto || ''; };
let desafio = null;

function mostrarLogin(msg) {
  estado.usuario = null;
  estado.opciones = null;
  cerrarModal();
  $('app').hidden = true;
  $('gate').hidden = false;
  verTarjeta('loginForm');
  mensaje('loginError', msg);
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
    const r = await api('/login', { metodo: 'POST', datos: { email: $('gMail').value, password: $('gPw').value } });
    if (r.requiereCodigo) {
      desafio = r.desafio;
      $('gPw').value = '';
      verTarjeta('codigoForm');
      mensaje('codigoError');
      $('gCodigo').value = '';
      $('gCodigo').focus();
      return;
    }
    entrar(r.usuario);
  } catch (err) {
    mostrarLogin(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
});

$('codigoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('btnCodigo').disabled = true;
  try {
    const { usuario } = await api('/login/codigo', { metodo: 'POST', datos: { desafio, codigo: $('gCodigo').value.replace(/\s/g, '') } });
    desafio = null;
    entrar(usuario);
  } catch (err) {
    // Vencido o demasiados intentos: vuelve al ingreso
    if (/Ingrese de nuevo|venció|Escriba de nuevo/.test(err.message)) mostrarLogin(err.message);
    else mensaje('codigoError', err.message);
  } finally {
    $('btnCodigo').disabled = false;
  }
});

$('olvidoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('btnOlvido').disabled = true;
  mensaje('olvidoError'); mensaje('olvidoOk');
  try {
    const r = await api('/clave', { metodo: 'POST', datos: { email: $('gMailOlvido').value } });
    mensaje('olvidoOk', r.mensaje);
  } catch (err) {
    mensaje('olvidoError', err.message);
  } finally {
    $('btnOlvido').disabled = false;
  }
});

$('claveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('gNueva').value !== $('gNueva2').value) return mensaje('claveError', 'Las contraseñas no coinciden.');
  $('btnClave').disabled = true;
  try {
    const r = await api('/clave/definir', { metodo: 'POST', datos: { token: new URLSearchParams(location.search).get('clave'), password: $('gNueva').value } });
    history.replaceState(null, '', '/crm');
    mostrarLogin();
    $('loginError').hidden = true;
    toast(r.mensaje);
  } catch (err) {
    mensaje('claveError', err.message);
  } finally {
    $('btnClave').disabled = false;
  }
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-view],[data-action],[data-pw],[data-olvido],[data-volver-login]');
  if (!t) return;
  if (t.dataset.view) return ir(t.dataset.view);
  if ('olvido' in t.dataset) { verTarjeta('olvidoForm'); $('gMailOlvido').value = $('gMail').value; return; }
  if ('volverLogin' in t.dataset) { desafio = null; return mostrarLogin(); }
  if (t.dataset.action === 'seguridad') return abrirSeguridad().catch((err) => { if (err.message !== 'sesion') toast(err.message, true); });
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

/* ---------- inicio: enlace para una nueva contraseña, o ¿sesión abierta? ---------- */
if (new URLSearchParams(location.search).get('clave')) {
  $('gate').hidden = false;
  verTarjeta('claveForm');
} else fetch('/api/crm/yo', { credentials: 'same-origin' })
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => (d ? entrar(d.usuario) : mostrarLogin()))
  .catch(() => mostrarLogin());
