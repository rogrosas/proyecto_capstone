/* CRM · Tickets de clientes (tickets): reclamos sobre documentos y consultas desde Mi cuenta */
import { get, patch } from '../api.js';
import { esc, fechaHora, badge, toast } from '../util.js';
import { abrirModal, cerrarModal, formularioHTML, leerFormulario, validar } from '../modal.js';
import { abrirDocumento } from './documentos.js';

let contenedor = null;
const ESTADOS = [['abierto', 'Abierto'], ['en_proceso', 'En proceso'], ['resuelto', 'Resuelto'], ['cerrado', 'Cerrado']];

export function ticketHTML(t, motivos = {}) {
  return `
    <div class="ticket">
      <div class="toolbar" style="margin:0;">
        <div><b>#${t.id} · ${esc(motivos[t.motivo] || t.motivo)}</b> ${badge('ticket', t.estado)}
          <div class="sb">${esc(t.cliente)} · ${esc(t.email || '—')} · ${fechaHora(t.creado_en)}${t.documento ? ` · ${esc(t.documento)}${t.folio ? ' ' + esc(t.folio) : ''}` : ''}</div></div>
        <div class="ficha-acciones" style="margin:0;">
          ${t.documento_id ? `<button class="btn btn-o btn-row" data-doc="${t.documento_id}">Ver documento</button>` : ''}
          <button class="btn btn-g btn-row" data-ticket="${t.id}">${['resuelto', 'cerrado'].includes(t.estado) ? 'Editar respuesta' : 'Responder'}</button>
        </div>
      </div>
      <div class="det">${esc(t.detalle)}</div>
      ${t.respuesta ? `<div class="resp"><b>Respuesta${t.atendido_por ? ` de ${esc(t.atendido_por)}` : ''}:</b>\n${esc(t.respuesta)}</div>` : ''}
    </div>`;
}

export function responderTicket(t, alTerminar) {
  if (!t) return alTerminar();
  abrirModal({
    titulo: `Ticket #${t.id} · ${t.cliente}`,
    contenido: `<div class="ticket" style="margin-bottom:14px;"><div class="det">${esc(t.detalle)}</div></div>` + formularioHTML([
      { nombre: 'estado', etiqueta: 'Estado', tipo: 'select', requerido: true, valor: t.estado === 'abierto' ? 'resuelto' : t.estado,
        opciones: ESTADOS.map(([valor, texto]) => ({ valor, texto })) },
      { nombre: 'respuesta', etiqueta: 'Respuesta para el cliente (le llega por correo y la ve en Mi cuenta)', tipo: 'textarea', ancho: 'full', valor: t.respuesta },
      { nombre: '_n', tipo: 'html', ancho: 'full', html: t.documento_id
        ? '<div class="note">Si corrige datos del cliente o del contrato, genere una nueva versión del documento desde el contrato y vuelva a publicarlo para que el cliente lo revise.</div>' : '' }
    ]),
    acciones: [{ texto: 'Cancelar', alHacer: alTerminar }, {
      texto: 'Guardar', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        const d = leerFormulario(c);
        await patch('/tickets/' + t.id, { estado: d.estado, respuesta: d.respuesta || undefined });
        toast(d.respuesta ? 'Ticket actualizado: el cliente recibió la respuesta por correo.' : 'Ticket actualizado.');
        alTerminar();
      }
    }]
  });
}

async function cargar() {
  const lista = contenedor.querySelector('#lsTickets');
  lista.innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const d = await get('/tickets?estado=' + contenedor.querySelector('#fTicket').value);
    contenedor.querySelector('#ntTickets').textContent = `${d.pendientes} pendiente(s) en total.`;
    lista.innerHTML = d.tickets.length ? d.tickets.map((t) => ticketHTML(t, d.motivos)).join('') : '<div class="empty">No hay tickets.</div>';
    lista.onclick = async (e) => {
      const doc = e.target.closest('[data-doc]');
      if (doc) return abrirDocumento(doc.dataset.doc);
      const b = e.target.closest('[data-ticket]');
      if (b) responderTicket(d.tickets.find((x) => x.id === Number(b.dataset.ticket)), () => { cerrarModal(); cargar(); });
    };
  } catch (err) {
    if (err.message !== 'sesion') lista.innerHTML = `<div class="empty err">${esc(err.message)}</div>`;
  }
}

export default {
  id: 'tickets',
  titulo: 'Tickets de clientes',
  sub: () => 'Reclamos sobre documentos y consultas enviadas desde Mi cuenta',
  async render(el) {
    contenedor = el;
    el.innerHTML = `
      <div class="panel">
        <div class="toolbar">
          <div class="sb" id="ntTickets"></div>
          <select class="fl" id="fTicket">
            <option value="pendientes">Pendientes (abiertos y en proceso)</option>
            ${ESTADOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}
            <option value="">Todos</option>
          </select>
        </div>
        <div id="lsTickets"></div>
      </div>`;
    el.querySelector('#fTicket').addEventListener('change', cargar);
    await cargar();
  }
};
