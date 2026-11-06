/* CRM · Tickets de clientes (tickets, ticket_mensajes)
   Cada ticket es una conversación con el cliente: cada mensaje queda con su autor y hora,
   y los cambios de estado quedan anotados en la conversación. */
import { get, patch } from '../api.js';
import { esc, fechaHora, badge, toast } from '../util.js';
import { abrirModal, cerrarModal } from '../modal.js';
import { abrirDocumento } from './documentos.js';

let contenedor = null;
const ESTADOS = [['abierto', 'Abierto'], ['en_proceso', 'En proceso'], ['resuelto', 'Resuelto'], ['cerrado', 'Cerrado']];
const esperaRespuesta = (t) => t.ultimo_autor === 'cliente' && t.estado !== 'cerrado';

export function ticketHTML(t, motivos = {}) {
  return `
    <div class="ticket">
      <div class="toolbar" style="margin:0;">
        <div><b>#${t.id} · ${esc(motivos[t.motivo] || t.motivo)}</b> ${badge('ticket', t.estado)}
          ${esperaRespuesta(t) ? '<span class="bg amb">Espera su respuesta</span>' : ''}
          <div class="sb">${esc(t.cliente)} · ${esc(t.email || '—')} · ${fechaHora(t.creado_en)}${t.documento ? ` · ${esc(t.documento)}${t.folio ? ' ' + esc(t.folio) : ''}` : ''}
            · ${t.mensajes || 1} mensaje(s)${t.actualizado_en ? ` · última actividad ${fechaHora(t.actualizado_en)}` : ''}</div></div>
        <div class="ficha-acciones" style="margin:0;">
          ${t.documento_id ? `<button class="btn btn-o btn-row" data-doc="${t.documento_id}">Ver documento</button>` : ''}
          <button class="btn ${esperaRespuesta(t) ? 'btn-g' : 'btn-o'} btn-row" data-ticket="${t.id}">Abrir conversación</button>
        </div>
      </div>
      <div class="det">${esc(t.detalle)}</div>
    </div>`;
}

// Burbujas de la conversación: el cliente a la izquierda, el personal a la derecha, los cambios de estado al centro
export function conversacionHTML(mensajes, lado = 'personal') {
  return `<div class="chat">${mensajes.map((m) => m.autor_tipo === 'sistema'
    ? `<div class="msg sistema">${esc(m.texto)} · ${fechaHora(m.fecha)}</div>`
    : `<div class="msg ${m.autor_tipo === lado ? 'mio' : 'otro'} ${m.autor_tipo}">
        <div class="quien">${m.autor_tipo === 'personal' ? `${esc(m.autor)} · Easy Office` : esc(m.autor)}</div>
        <div class="txt">${esc(m.texto)}</div><div class="cuando">${fechaHora(m.fecha)}</div></div>`).join('')}</div>`;
}

export async function responderTicket(t, alTerminar) {
  if (!t) return alTerminar();
  const { ticket, mensajes } = await get('/tickets/' + t.id);
  const cerrado = ticket.estado === 'cerrado';
  const cuerpo = abrirModal({
    titulo: `Ticket #${ticket.id} · ${ticket.cliente}`, ancho: 'lg',
    contenido: `
      <div class="sb" style="margin-bottom:10px;">${badge('ticket', ticket.estado)} · ${esc(ticket.email || '—')}${ticket.documento ? ` · ${esc(ticket.documento)}${ticket.folio ? ' ' + esc(ticket.folio) : ''}` : ''}</div>
      ${conversacionHTML(mensajes)}
      <div class="chat-resp">
        <textarea id="tkResp" rows="3" maxlength="4000" placeholder="${cerrado ? 'El ticket está cerrado: cambie el estado para reabrirlo.' : 'Escriba su respuesta. Le llega al cliente por correo y la ve en Mi cuenta.'}"></textarea>
        <div class="chat-acc">
          <select id="tkEstado" aria-label="Estado del ticket">
            <option value="">Mantener: ${ESTADOS.find(([v]) => v === ticket.estado)[1]}</option>
            ${ESTADOS.filter(([v]) => v !== ticket.estado).map(([v, txt]) => `<option value="${v}">Cambiar a: ${txt}</option>`).join('')}
          </select>
          <button class="btn btn-g" id="tkEnviar">Enviar</button>
        </div>
        ${ticket.documento_id ? '<div class="note" style="margin-top:10px;">Si corrige datos del cliente o del contrato, genere una nueva versión del documento y vuelva a publicarla para que el cliente la revise.</div>' : ''}
      </div>`,
    acciones: [{ texto: 'Cerrar', alHacer: alTerminar }]
  });
  const chat = cuerpo.querySelector('.chat');
  chat.scrollTop = chat.scrollHeight;
  cuerpo.querySelector('#tkResp').focus();
  cuerpo.querySelector('#tkEnviar').addEventListener('click', async (e) => {
    const respuesta = cuerpo.querySelector('#tkResp').value.trim();
    const estado = cuerpo.querySelector('#tkEstado').value;
    if (!respuesta && !estado) return toast('Escriba un mensaje o elija un estado.', true);
    e.target.disabled = true;
    try {
      await patch('/tickets/' + ticket.id, { respuesta: respuesta || undefined, estado: estado || undefined });
      toast(respuesta ? 'Mensaje enviado: el cliente lo recibe por correo.' : 'Estado del ticket actualizado.');
      cerrarModal();
      responderTicket(ticket, alTerminar);   // vuelve a abrir la conversación actualizada
    } catch (err) {
      e.target.disabled = false;
      if (err.message !== 'sesion') toast(err.message, true);
    }
  });
}

async function cargar() {
  const lista = contenedor.querySelector('#lsTickets');
  lista.innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const d = await get('/tickets?estado=' + contenedor.querySelector('#fTicket').value);
    const esperan = d.tickets.filter(esperaRespuesta).length;
    contenedor.querySelector('#ntTickets').textContent = `${d.pendientes} pendiente(s) en total${esperan ? ` · ${esperan} esperan su respuesta` : ''}.`;
    lista.innerHTML = d.tickets.length ? d.tickets.map((t) => ticketHTML(t, d.motivos)).join('') : '<div class="empty">No hay tickets.</div>';
    lista.onclick = async (e) => {
      const doc = e.target.closest('[data-doc]');
      if (doc) return abrirDocumento(doc.dataset.doc);
      const b = e.target.closest('[data-ticket]');
      if (b) responderTicket(d.tickets.find((x) => x.id === Number(b.dataset.ticket)), () => { cerrarModal(); cargar(); }).catch((err) => toast(err.message, true));
    };
  } catch (err) {
    if (err.message !== 'sesion') lista.innerHTML = `<div class="empty err">${esc(err.message)}</div>`;
  }
}

export default {
  id: 'tickets',
  titulo: 'Tickets de clientes',
  sub: () => 'Conversaciones con los clientes: reclamos sobre documentos y consultas desde Mi cuenta',
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
