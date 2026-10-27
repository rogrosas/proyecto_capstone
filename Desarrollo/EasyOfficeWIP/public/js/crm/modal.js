/* =========================================================
   CRM · ventanas modales y formularios generados desde una definición

   campos: [{ nombre, etiqueta, tipo, valor, requerido, opciones, ayuda, ancho, min, paso }]
     tipo: texto | email | numero | fecha | textarea | bool | select | json | oculto | html
     opciones (select): [{ valor, texto }]
     nombre con punto ("representante.rut") arma objetos anidados.
   ========================================================= */
import { esc } from './util.js';

const raiz = () => document.getElementById('modalRaiz');

export function cerrarModal() {
  raiz().innerHTML = '';
  raiz().hidden = true;
  document.body.classList.remove('con-modal');
}

/**
 * Abre un modal. contenido: HTML. acciones: [{ texto, clase, alHacer(modalEl) }]
 * Devuelve el elemento del cuerpo para enganchar eventos.
 */
export function abrirModal({ titulo, contenido, acciones = [], ancho = 'md' }) {
  const r = raiz();
  r.hidden = false;
  document.body.classList.add('con-modal');
  r.innerHTML = `
    <div class="modal-fondo" data-cerrar></div>
    <div class="modal ${ancho}" role="dialog" aria-modal="true" aria-labelledby="modalTitulo">
      <div class="modal-h"><h3 id="modalTitulo">${esc(titulo)}</h3><button class="modal-x" data-cerrar aria-label="Cerrar">✕</button></div>
      <div class="modal-b" id="modalCuerpo">${contenido}</div>
      ${acciones.length ? `<div class="modal-f"><div class="modal-error" id="modalError" hidden></div>
        ${acciones.map((a, i) => `<button class="btn ${a.clase || 'btn-o'}" data-accion="${i}">${esc(a.texto)}</button>`).join('')}</div>` : ''}
    </div>`;
  r.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', cerrarModal));
  r.querySelectorAll('[data-accion]').forEach((b) => b.addEventListener('click', async () => {
    const accion = acciones[Number(b.dataset.accion)];
    if (!accion.alHacer) return cerrarModal();
    b.disabled = true;
    try {
      await accion.alHacer(r.querySelector('#modalCuerpo'));
    } catch (err) {
      if (err.message !== 'sesion') mostrarErrorModal(err.message);
    } finally {
      b.disabled = false;
    }
  }));
  const primero = r.querySelector('input,select,textarea');
  if (primero) primero.focus();
  return r.querySelector('#modalCuerpo');
}

export function mostrarErrorModal(msg) {
  const e = document.getElementById('modalError');
  if (!e) return;
  e.textContent = msg;
  e.hidden = !msg;
}

export function confirmar(mensaje, { titulo = 'Confirmar', textoSi = 'Confirmar', peligro = false } = {}) {
  return new Promise((resolver) => {
    abrirModal({
      titulo, ancho: 'sm', contenido: `<p class="modal-texto">${esc(mensaje)}</p>`,
      acciones: [
        { texto: 'Cancelar', alHacer: () => { cerrarModal(); resolver(false); } },
        { texto: textoSi, clase: peligro ? 'btn-peligro' : 'btn-g', alHacer: () => { cerrarModal(); resolver(true); } }
      ]
    });
  });
}

/* ---------- formularios ---------- */
const opcionesHTML = (opciones = [], valor, vacia) =>
  (vacia !== undefined ? `<option value="">${esc(vacia)}</option>` : '') +
  opciones.map((o) => `<option value="${esc(o.valor)}" ${String(o.valor) === String(valor ?? '') ? 'selected' : ''}>${esc(o.texto)}</option>`).join('');

export function campoHTML(c) {
  const id = 'f_' + c.nombre.replace(/\W/g, '_');
  const req = c.requerido ? 'required' : '';
  const val = c.valor ?? '';
  const ayuda = c.ayuda ? `<span class="hint">${esc(c.ayuda)}</span>` : '';
  const ancho = c.ancho === 'full' ? 'full' : '';
  switch (c.tipo) {
    case 'oculto': return `<input type="hidden" name="${esc(c.nombre)}" value="${esc(val)}">`;
    case 'html': return `<div class="f ${ancho}">${c.html}</div>`;
    case 'bool':
      return `<label class="f chk-f ${ancho}"><input type="checkbox" name="${esc(c.nombre)}" ${val === true || val === 'true' ? 'checked' : ''}> ${esc(c.etiqueta)}</label>`;
    case 'textarea':
    case 'json': {
      const v = c.tipo === 'json' && val && typeof val === 'object' ? JSON.stringify(val, null, 2) : val;
      return `<div class="f ${ancho || 'full'}"><label for="${id}">${esc(c.etiqueta)}${c.requerido ? ' *' : ''}</label>
        <textarea id="${id}" name="${esc(c.nombre)}" rows="${c.filas || 4}" ${req} ${c.tipo === 'json' ? 'class="mono" spellcheck="false"' : ''}>${esc(v)}</textarea>${ayuda}</div>`;
    }
    case 'select':
      return `<div class="f ${ancho}"><label for="${id}">${esc(c.etiqueta)}${c.requerido ? ' *' : ''}</label>
        <select id="${id}" name="${esc(c.nombre)}" ${req}>${opcionesHTML(c.opciones, val, c.requerido ? 'Seleccione…' : '—')}</select>${ayuda}</div>`;
    default: {
      const tipo = { numero: 'number', fecha: 'date', email: 'email' }[c.tipo] || 'text';
      return `<div class="f ${ancho}"><label for="${id}">${esc(c.etiqueta)}${c.requerido ? ' *' : ''}</label>
        <input id="${id}" type="${tipo}" name="${esc(c.nombre)}" value="${esc(val)}" ${req}
          ${c.min !== undefined ? `min="${c.min}"` : ''} ${c.paso ? `step="${c.paso}"` : ''} ${c.placeholder ? `placeholder="${esc(c.placeholder)}"` : ''}>${ayuda}</div>`;
    }
  }
}

export const formularioHTML = (campos) => `<div class="grid2">${campos.map(campoHTML).join('')}</div>`;

// Lee los campos con name dentro de un contenedor; "a.b" arma objetos anidados. Vacío -> null
export function leerFormulario(contenedor) {
  const datos = {};
  contenedor.querySelectorAll('[name]').forEach((el) => {
    if (el.closest('[data-ignorar]')) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else v = el.value.trim() === '' ? null : el.value.trim();
    const partes = el.name.split('.');
    let obj = datos;
    partes.slice(0, -1).forEach((p) => { obj = obj[p] = obj[p] || {}; });
    obj[partes[partes.length - 1]] = v;
  });
  return datos;
}

// Validación nativa del navegador antes de enviar
export function validar(contenedor) {
  for (const el of contenedor.querySelectorAll('input,select,textarea')) {
    if (!el.checkValidity()) {
      el.reportValidity();
      throw new Error('Revise los campos marcados.');
    }
  }
}
