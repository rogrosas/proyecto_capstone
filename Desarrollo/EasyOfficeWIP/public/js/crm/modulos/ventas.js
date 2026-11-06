/* CRM · Ventas y pagos (pagos) */
import { get, post, patch, exportar } from '../api.js';
import { esc, clp, fechaHora, filaVacia, badge, toast, pasarela, hoyISO } from '../util.js';
import { opciones, tomarFiltros } from '../estado.js';
import { abrirContrato } from './contratos.js';
import { abrirDocumento } from './documentos.js';
import { abrirModal, formularioHTML, leerFormulario, validar } from '../modal.js';

let contenedor = null;

async function cargar() {
  const tb = contenedor.querySelector('#tbPagos');
  tb.innerHTML = filaVacia(9, 'Cargando…');
  try {
    const d = await get('/ventas');
    const tot = d.resumen.reduce((a, v) => ({ monto: a.monto + v.monto, pagados: a.pagados + v.pagados, pend: a.pend + v.pendientes, rech: a.rech + v.rechazados }), { monto: 0, pagados: 0, pend: 0, rech: 0 });
    contenedor.querySelector('#kpiVentas').innerHTML = `
      <div class="kpi"><div class="l">Pagado · 30 días</div><div class="v">${clp(tot.monto)}</div><div class="d nu">${tot.pagados} pago(s)</div></div>
      <div class="kpi warn"><div class="l">Pendientes</div><div class="v">${tot.pend}</div><div class="d nu">por confirmar o conciliar</div></div>
      <div class="kpi bad"><div class="l">Rechazados</div><div class="v">${tot.rech}</div><div class="d nu">últimos 30 días</div></div>
      <div class="kpi"><div class="l">Pasarela principal</div><div class="v" style="font-size:20px">${d.resumen[0] ? pasarela(d.resumen[0].pasarela) : '—'}</div><div class="d nu">por monto pagado</div></div>`;
    const pas = contenedor.querySelector('#fPasarela').value;
    const pagos = pas ? d.pagos.filter((p) => p.pasarela === pas) : d.pagos;
    tb.innerHTML = pagos.length ? pagos.map((p) => `
      <tr class="clic" ${p.contrato_id ? `data-contrato="${p.contrato_id}"` : p.documento_id ? `data-documento="${p.documento_id}"` : ''}>
        <td>${fechaHora(p.fecha)}</td>
        <td class="mono">${esc(p.referencia)}</td>
        <td class="nm">${esc(p.cliente || '—')}</td>
        <td>${esc(p.concepto || '—')}</td>
        <td class="money">${clp(p.monto)}</td>
        <td>${pasarela(p.pasarela)}</td>
        <td>${p.cuota} de ${p.total_cuotas}</td>
        <td>${badge('pago', p.estado)}</td>
        <td><button class="btn btn-o btn-row" data-pago="${p.id}" data-estado="${p.estado}">Cambiar estado</button></td>
      </tr>`).join('') : filaVacia(9, 'No hay pagos registrados.');
  } catch (err) {
    if (err.message !== 'sesion') tb.innerHTML = filaVacia(9, err.message, true);
  }
}
const recargarLista = () => { if (contenedor && document.body.contains(contenedor)) cargar(); };

/** pre = { contrato_id | documento_id, monto } */
export async function registrarPago(pre = {}, alGuardar) {
  const op = await opciones();
  abrirModal({
    titulo: pre.contrato_id ? 'Registrar pago del contrato' : 'Registrar pago del documento',
    contenido: formularioHTML([
      { nombre: pre.contrato_id ? 'contrato_id' : 'documento_id', tipo: 'oculto', valor: pre.contrato_id || pre.documento_id },
      { nombre: 'monto', etiqueta: 'Monto (CLP)', tipo: 'numero', requerido: true, min: 1, valor: pre.monto },
      { nombre: 'pasarela', etiqueta: 'Medio de pago', tipo: 'select', opciones: op.pasarelas.map((p) => ({ valor: p, texto: pasarela(p) })) },
      { nombre: 'estado', etiqueta: 'Estado', tipo: 'select', requerido: true, valor: 'pagado', opciones: op.estadosPago.map((p) => ({ valor: p, texto: p })) },
      { nombre: 'fecha_pago', etiqueta: 'Fecha de pago', tipo: 'fecha', valor: hoyISO() },
      { nombre: 'cuota', etiqueta: 'Cuota', tipo: 'numero', requerido: true, min: 1, valor: 1 },
      { nombre: 'total_cuotas', etiqueta: 'Total de cuotas', tipo: 'numero', requerido: true, min: 1, valor: 1, ayuda: 'Pago 50/50 = cuota 1 de 2 y luego 2 de 2' }
    ]),
    acciones: [{ texto: 'Cancelar', alHacer: alGuardar }, {
      texto: 'Registrar', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        await post('/pagos', leerFormulario(c));
        toast('Pago registrado.');
        recargarLista();
        if (alGuardar) alGuardar();
      }
    }]
  });
}

export async function cambiarEstadoPago(id, actual, alGuardar) {
  const op = await opciones();
  abrirModal({
    titulo: 'Cambiar estado del pago', ancho: 'sm',
    contenido: formularioHTML([{ nombre: 'estado', etiqueta: 'Estado', tipo: 'select', requerido: true, valor: actual, ancho: 'full', opciones: op.estadosPago.map((p) => ({ valor: p, texto: p })), ayuda: 'Al marcar "pagado" sin fecha se registra la fecha de hoy, y si el contrato estaba pendiente queda activo.' }]),
    acciones: [{ texto: 'Cancelar', alHacer: alGuardar }, {
      texto: 'Guardar', clase: 'btn-g', alHacer: async (c) => {
        const r = await patch('/pagos/' + id, leerFormulario(c));
        toast(r.contrato_activado ? `Pago confirmado: el contrato ${r.contrato_activado} quedó activo.` : 'Estado del pago actualizado.');
        recargarLista();
        if (alGuardar) alGuardar();
      }
    }]
  });
}

export default {
  id: 'ventas',
  titulo: 'Ventas y pagos',
  sub: () => 'Pagos por pasarela, cuotas y estado',
  async render(el) {
    contenedor = el;
    el.innerHTML = `
      <div class="sh"><p>Para registrar un pago, ábralo desde el contrato o el documento correspondiente. El saldo de cada contrato lo calcula la vista v_saldo_contrato con los pagos en estado "pagado".</p></div>
      <div class="kpis" id="kpiVentas"></div>
      <div class="toolbar">
        <select class="fl" id="fPasarela"><option value="">Todas las pasarelas</option><option value="transbank">Webpay (Transbank)</option><option value="mercado_pago">Mercado Pago</option><option value="transferencia">Transferencia</option></select>
        <button class="btn btn-o" data-exportar title="Descargar este listado como CSV para Excel">Exportar a Excel</button>
      </div>
      <div class="panel tbl-panel tbl-wrap"><table>
        <thead><tr><th>Fecha</th><th>Referencia</th><th>Cliente</th><th>Concepto</th><th>Monto</th><th>Pasarela</th><th>Cuota</th><th>Estado</th><th></th></tr></thead>
        <tbody id="tbPagos"></tbody>
      </table></div>`;
    const f = tomarFiltros('ventas');
    if (f?.pasarela) el.querySelector('#fPasarela').value = f.pasarela;
    el.querySelector('#fPasarela').addEventListener('change', cargar);
    el.querySelector('[data-exportar]').addEventListener('click', () => exportar('pagos')
      .catch((err) => { if (err.message !== 'sesion') toast(err.message, true); }));
    el.querySelector('#tbPagos').addEventListener('click', (e) => {
      const t = e.target.closest('[data-pago]');
      if (t) return cambiarEstadoPago(t.dataset.pago, t.dataset.estado);
      const k = e.target.closest('[data-contrato]');
      if (k) return abrirContrato(k.dataset.contrato).catch((err) => toast(err.message, true));
      const dc = e.target.closest('[data-documento]');
      if (dc) abrirDocumento(dc.dataset.documento).catch((err) => toast(err.message, true));
    });
    await cargar();
  }
};
