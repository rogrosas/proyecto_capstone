/* CRM · Correspondencia del domicilio tributario (oficina de partes)
   Registrar lo que llega, subir el escaneo, avisar al cliente y marcar retirada o devuelta. */
import { get, post, patch } from '../api.js';
import { esc, fechaHora, filaVacia, toast } from '../util.js';
import { opciones } from '../estado.js';
import { abrirModal, cerrarModal, formularioHTML, leerFormulario, validar, confirmar } from '../modal.js';
import { abrirFicha } from './clientes.js';

const TIPOS = { fiscal: 'Fiscal (SII)', judicial: 'Judicial', laboral: 'Laboral', municipal: 'Municipal', bancaria: 'Bancaria', comercial: 'Comercial', otra: 'Otra' };
const ESTADOS = { recibida: ['amb', 'Recibida'], digitalizada: ['blu', 'Escaneada'], notificada: ['grn', 'Avisada'], retirada: ['gry', 'Retirada'], devuelta: ['gry', 'Devuelta'] };
let contenedor = null;

async function cargar() {
  const tb = contenedor.querySelector('#tbCorr');
  tb.innerHTML = filaVacia(6, 'Cargando…');
  try {
    const p = new URLSearchParams({ estado: contenedor.querySelector('#fCorr').value, q: contenedor.querySelector('#qCorr').value });
    const { correspondencia } = await get('/correspondencia?' + p);
    tb.innerHTML = correspondencia.length ? correspondencia.map((c) => {
      const [bg, txt] = ESTADOS[c.estado];
      const abierta = ['recibida', 'digitalizada', 'notificada'].includes(c.estado);
      return `<tr>
        <td>${fechaHora(c.recibida)}<div class="sb">${esc(c.sucursal)}</div></td>
        <td><button class="lnk-n" data-cliente="${c.cliente_id}">${esc(c.cliente)}</button></td>
        <td class="nm">${esc(c.remitente)}<div class="sb">${esc(TIPOS[c.tipo])}${c.descripcion ? ' · ' + esc(c.descripcion) : ''}</div></td>
        <td>${c.urgente ? '<span class="bg red">Urgente</span>' : '<span class="sb">Normal</span>'}</td>
        <td><span class="bg ${bg}">${txt}</span>
          ${c.atrasada ? `<div class="sb rojo">Aviso atrasado (plazo ${fechaHora(c.plazo)})</div>` : ''}
          ${c.notificada ? `<div class="sb">Avisada ${fechaHora(c.notificada)}${c.leida ? ' · vista por el cliente' : ''}</div>` : ''}</td>
        <td class="right acciones">
          ${c.con_archivo ? `<a class="btn btn-o btn-row" href="/api/crm/correspondencia/${c.id}/archivo" target="_blank" rel="noopener">Ver escaneo</a>` : ''}
          ${abierta ? `<button class="btn btn-o btn-row" data-escaneo="${c.id}">${c.con_archivo ? 'Cambiar escaneo' : 'Subir escaneo'}</button>
            <button class="btn ${c.estado === 'notificada' ? 'btn-o' : 'btn-g'} btn-row" data-notificar="${c.id}">${c.estado === 'notificada' ? 'Avisar de nuevo' : 'Avisar al cliente'}</button>
            <button class="btn btn-o btn-row" data-estado="retirada" data-id="${c.id}">Retirada</button>
            <button class="btn btn-o btn-row" data-estado="devuelta" data-id="${c.id}">Devuelta</button>` : ''}
        </td></tr>`;
    }).join('') : filaVacia(6, 'No hay correspondencia con este filtro.');
  } catch (err) {
    if (err.message !== 'sesion') tb.innerHTML = filaVacia(6, err.message, true);
  }
}

async function registrar() {
  const [op, { clientes }] = await Promise.all([opciones(), get('/clientes')]);
  abrirModal({
    titulo: 'Registrar correspondencia',
    contenido: formularioHTML([
      { nombre: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', requerido: true, ancho: 'full', opciones: clientes.map((c) => ({ valor: c.id, texto: `${c.razon_social} · ${c.rut_fmt}` })) },
      { nombre: 'remitente', etiqueta: 'Remitente', requerido: true, placeholder: 'Servicio de Impuestos Internos' },
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', requerido: true, valor: 'fiscal', opciones: Object.entries(TIPOS).map(([valor, texto]) => ({ valor, texto })) },
      { nombre: 'sucursal_id', etiqueta: 'Sucursal que la recibió', tipo: 'select', opciones: [{ valor: '', texto: 'La del contrato del cliente' }, ...(op.sucursales || []).filter((s) => s.activo !== false).map((s) => ({ valor: s.id, texto: s.nombre }))] },
      { nombre: 'urgente', etiqueta: 'Urgente (fiscal, judicial y laboral lo son siempre)', tipo: 'bool' },
      { nombre: 'descripcion', etiqueta: 'Descripción', tipo: 'textarea', ancho: 'full', placeholder: 'Ej.: citación, carta certificada, notificación de giro…' },
      { nombre: 'notificar', etiqueta: 'Avisar al cliente por correo ahora', tipo: 'bool', valor: true }
    ]),
    acciones: [{ texto: 'Cancelar' }, {
      texto: 'Registrar', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        const r = await post('/correspondencia', leerFormulario(c));
        toast(r.notificada ? 'Registrada y avisada al cliente.' : 'Correspondencia registrada.');
        cerrarModal();
        cargar();
      }
    }]
  });
}

function subirEscaneo(id) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/pdf,image/jpeg,image/png' });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const res = await fetch(`/api/crm/correspondencia/${id}/escaneo`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: f
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudo subir el escaneo.');
      toast('Escaneo guardado.');
      cargar();
    } catch (err) {
      toast(err.message, true);
    }
  });
  input.click();
}

export default {
  id: 'correspondencia',
  titulo: 'Correspondencia',
  sub: () => 'Cartas y notificaciones recibidas en el domicilio tributario',
  async render(el) {
    contenedor = el;
    el.innerHTML = `
      <div class="sh"><p>Registre lo que llega al domicilio tributario de cada cliente. Lo fiscal, judicial y laboral es urgente; el compromiso es avisar dentro de 24 horas.
        El cliente ve el aviso y el escaneo en Mi cuenta, y aquí queda cuándo lo vio.</p></div>
      <div class="toolbar">
        <input class="search" id="qCorr" placeholder="Buscar por cliente o remitente…">
        <select class="fl" id="fCorr">
          <option value="pendientes">Por avisar</option><option value="por_retirar">Avisadas, por retirar</option>
          <option value="">Todas</option><option value="retirada">Retiradas</option><option value="devuelta">Devueltas</option>
        </select>
        <button class="btn btn-g" id="btnNuevaCorr">Registrar correspondencia</button>
      </div>
      <div class="panel tbl-panel tbl-wrap"><table>
        <thead><tr><th>Recibida</th><th>Cliente</th><th>Remitente</th><th>Prioridad</th><th>Estado</th><th></th></tr></thead>
        <tbody id="tbCorr"></tbody>
      </table></div>`;
    let t;
    el.querySelector('#qCorr').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 300); });
    el.querySelector('#fCorr').addEventListener('change', cargar);
    el.querySelector('#btnNuevaCorr').addEventListener('click', () => registrar().catch((err) => toast(err.message, true)));
    el.querySelector('#tbCorr').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cliente],[data-escaneo],[data-notificar],[data-estado]');
      if (!b) return;
      try {
        if (b.dataset.cliente) return await abrirFicha(b.dataset.cliente);
        if (b.dataset.escaneo) return subirEscaneo(b.dataset.escaneo);
        if (b.dataset.notificar) {
          b.disabled = true;
          const r = await post(`/correspondencia/${b.dataset.notificar}/notificar`);
          toast(`Aviso enviado a ${r.enviados} correo(s).`);
        } else {
          const txt = b.dataset.estado === 'retirada' ? 'retirada por el cliente' : 'devuelta al remitente';
          if (!(await confirmar(`¿Marcar esta correspondencia como ${txt}?`, { textoSi: 'Confirmar' }))) return;
          await patch(`/correspondencia/${b.dataset.id}`, { estado: b.dataset.estado });
          toast('Correspondencia actualizada.');
        }
        cargar();
      } catch (err) {
        b.disabled = false;
        if (err.message !== 'sesion') toast(err.message, true);
      }
    });
    await cargar();
  }
};
