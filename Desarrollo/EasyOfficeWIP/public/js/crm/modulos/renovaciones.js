/* CRM · Renovaciones y cobranza (contratos, alertas, v_saldo_contrato) */
import { get, post } from '../api.js';
import { esc, clp, fecha, dias, filaVacia, toast } from '../util.js';
import { abrirContrato } from './contratos.js';

let contenedor = null;

async function cargar() {
  const tb = contenedor.querySelector('#tbRenov');
  tb.innerHTML = filaVacia(8, 'Cargando…');
  try {
    const d = await get('/renovaciones?filtro=' + contenedor.querySelector('#fRenov').value);
    const e = d.etapas;
    contenedor.querySelector('#pipeRenov').innerHTML = [
      ['D-60', 'Aviso temprano', 'Vencen en 31 a 60 días', e.d60],
      ['D-30', 'Oferta de renovación', 'Vencen en 8 a 30 días', e.d30],
      ['D-7', 'Llamado del ejecutivo', 'Vencen en 7 días o menos', e.d7],
      ['D-0', 'Vencido', 'Hasta 30 días vencido', e.d0],
      ['D+30', 'Recuperación', 'Más de 30 días vencido', e.dmas30]
    ].map(([n, t, s, c]) => `<div class="ps"><div class="num">${n}</div><div class="t">${t}</div><div class="d">${s}</div><div class="c">${c}</div></div>`).join('');

    tb.innerHTML = d.contratos.length ? d.contratos.map((c) => {
      const est = c.dias < 0 ? ['red', 'Vencido'] : c.dias <= 30 ? ['amb', 'Por vencer'] : ['grn', 'En plazo'];
      const aviso = c.avisos_enviados ? `<span class="dot"></span>${c.avisos_enviados} aviso(s) enviado(s)`
        : c.proxima_alerta ? `<span class="dot a"></span>Próxima alerta ${fecha(c.proxima_alerta)}` : '<span class="dot r"></span>Sin avisos';
      return `<tr>
        <td><div class="nm">${esc(c.razon_social)}</div><div class="sb">${esc(c.rut)} · <span class="mono">${esc(c.folio)}</span></div></td>
        <td>${esc(c.servicios || '—')}${c.ejecutivo ? `<div class="sb">${esc(c.ejecutivo)}</div>` : ''}</td>
        <td class="money">${clp(c.total_servicios)}</td>
        <td>${fecha(c.vence)}<div class="sb">${dias(c.dias)}</div></td>
        <td>${aviso}</td>
        <td class="money">${c.saldo > 0 ? `<span class="rojo">${clp(c.saldo)}</span>` : clp(c.saldo)}</td>
        <td><span class="bg ${est[0]}">${est[1]}</span></td>
        <td class="acciones">
          <button class="btn btn-o btn-row" data-ver="${c.id}">Ver</button>
          <button class="btn btn-g btn-row" data-renovar="${c.id}" data-folio="${esc(c.folio)}">Renovar</button>
        </td>
      </tr>`;
    }).join('') : filaVacia(8, 'No hay contratos en este rango.');
  } catch (err) {
    if (err.message !== 'sesion') tb.innerHTML = filaVacia(8, err.message, true);
  }
}

export default {
  id: 'renovaciones',
  titulo: 'Renovaciones y cobranza',
  sub: () => 'Vencimientos, alertas y saldo por contrato',
  cnt: 'vencidos',
  async render(el) {
    contenedor = el;
    el.innerHTML = `
      <div class="sh"><p>Las alertas a 60/30/15/7 días las genera la base de datos al crear el contrato o cambiar su vencimiento. "Renovar" crea el contrato siguiente con los mismos servicios a precio vigente.</p></div>
      <div class="pipe" id="pipeRenov"></div>
      <div class="toolbar">
        <select class="fl" id="fRenov">
          <option value="30">Próximos 30 días</option>
          <option value="60" selected>Próximos 60 días</option>
          <option value="vencidos">Vencidos sin renovar</option>
        </select>
      </div>
      <div class="panel tbl-panel tbl-wrap"><table>
        <thead><tr><th>Cliente</th><th>Servicios</th><th>Monto neto</th><th>Vence</th><th>Avisos</th><th>Saldo</th><th>Estado</th><th></th></tr></thead>
        <tbody id="tbRenov"></tbody>
      </table></div>`;
    el.querySelector('#fRenov').addEventListener('change', cargar);
    el.querySelector('#tbRenov').addEventListener('click', async (e) => {
      const t = e.target.closest('[data-ver],[data-renovar]');
      if (!t) return;
      try {
        if (t.dataset.ver) return await abrirContrato(t.dataset.ver);
        t.disabled = true;
        const r = await post(`/contratos/${t.dataset.renovar}/renovar`);
        toast(`${t.dataset.folio} renovado: nuevo folio ${r.folio}.`);
        await cargar();
        abrirContrato(r.id);
      } catch (err) {
        if (err.message !== 'sesion') toast(err.message, true);
        t.disabled = false;
      }
    });
    await cargar();
  }
};
