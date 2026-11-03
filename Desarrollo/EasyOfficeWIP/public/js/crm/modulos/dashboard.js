/* CRM · Dashboard (contratos, alertas, documentos, pagos, usuarios)
   Cada indicador, mes, pendiente, pasarela y ejecutivo abre su detalle: la ficha, el contrato,
   el documento o la lista ya filtrada (nav.ir con filtros). */
import { get } from '../api.js';
import { esc, clp, dias, mesCorto, filaVacia, pasarela, toast, fecha } from '../util.js';
import { estado, nav, opciones } from '../estado.js';
import { abrirContrato } from './contratos.js';
import { revisarDocumento } from './documentos.js';
import { abrirFicha } from './clientes.js';

// Atributos de un enlace a otro módulo con sus filtros
const ir = (modulo, filtros = {}) => `data-ir="${modulo}" data-f="${esc(JSON.stringify(filtros))}"`;

// Período de los indicadores (se recuerda mientras dure la sesión del navegador)
const PRESETS = { mes: 'Este mes', anterior: 'Mes anterior', 30: 'Últimos 30 días', anio: 'Este año', otro: 'Personalizado' };
const per = { preset: 'mes', desde: '', hasta: '', ejecutivo: '' };
try { Object.assign(per, JSON.parse(sessionStorage.getItem('eo_dash_periodo') || '{}')); } catch { /* sin almacenamiento */ }
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function rango(preset) {
  const h = new Date();
  if (preset === 'anterior') return [isoLocal(new Date(h.getFullYear(), h.getMonth() - 1, 1)), isoLocal(new Date(h.getFullYear(), h.getMonth(), 0))];
  if (preset === '30') return [isoLocal(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 29)), isoLocal(h)];
  if (preset === 'anio') return [`${h.getFullYear()}-01-01`, isoLocal(h)];
  return [isoLocal(new Date(h.getFullYear(), h.getMonth(), 1)), isoLocal(h)];
}
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export default {
  id: 'dashboard',
  titulo: 'Dashboard',
  sub: () => `Resumen operativo · ${new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}`,
  async render(el, { refrescarMenu }) {
    el.innerHTML = '<div class="kpis"><div class="kpi"><div class="l">Cargando…</div></div></div>';
    if (per.preset !== 'otro') [per.desde, per.hasta] = rango(per.preset);
    const q = new URLSearchParams({ desde: per.desde, hasta: per.hasta, ...(per.ejecutivo ? { ejecutivo: per.ejecutivo } : {}) });
    const [d, op] = await Promise.all([get('/dashboard?' + q), estado.usuario.admin ? opciones() : null]);
    estado.conteos = d.conteos;
    refrescarMenu();
    const k = d.kpi;
    const max = Math.max(1, ...d.barras.map((b) => b.total));
    const maxC = Math.max(1, ...d.carga.map((c) => c.contratos + c.documentos));
    const TIPOS = { vencido: ['red', 'Vencido'], por_vencer: ['amb', 'Por vencer'], revisar: ['blu', 'Revisar'], seguimiento: ['gry', 'Seguimiento'] };

    const pi = d.periodo.indicadores;
    const maxS = Math.max(1, ...pi.porServicio.map((x) => x.monto));
    const maxE = Math.max(1, ...pi.porEjecutivo.map((x) => x.monto));
    const etiquetaPer = per.preset === 'otro' ? `del ${fecha(per.desde)} al ${fecha(per.hasta)}` : PRESETS[per.preset].toLowerCase();
    const delPeriodo = { desde: d.periodo.desde, hasta: d.periodo.hasta };
    const filaVenta = (x, max, enlace) => `<tr ${enlace || ''}><td class="nm">${esc(x.servicio || x.ejecutivo)}</td><td>${x.contratos}</td><td class="money">${clp(x.monto)}</td>
      <td><span class="barmini"><i style="width:${Math.round(x.monto / max * 100)}%"></i></span></td></tr>`;

    el.innerHTML = `<div id="tablero">
      <div class="panel mb18 periodo">
        <div class="ph-row"><h3>Indicadores del período</h3>
          <div class="per-ctl">
            <select id="pPreset" aria-label="Período">${Object.entries(PRESETS).map(([k, t]) => `<option value="${k}" ${per.preset === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <input type="date" id="pDesde" value="${per.desde}" aria-label="Desde" ${per.preset === 'otro' ? '' : 'disabled'}>
            <input type="date" id="pHasta" value="${per.hasta}" aria-label="Hasta" ${per.preset === 'otro' ? '' : 'disabled'}>
            ${op ? `<select id="pEjec" aria-label="Ejecutivo"><option value="">Todos los ejecutivos</option>${(op.usuarios || []).filter((u) => u.activo !== false)
              .map((u) => `<option value="${u.id}" ${String(per.ejecutivo) === String(u.id) ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select>` : ''}
          </div></div>
        <div class="ph">Del ${fecha(d.periodo.desde)} al ${fecha(d.periodo.hasta)}. Una venta es un contrato creado en el período, por el total neto de sus servicios.</div>
        <div class="kpis kpis-p">
          <button class="kpi" ${ir('clientes')} title="Ver los clientes"><div class="l">Clientes</div><div class="v">${pi.clientes.toLocaleString('es-CL')}</div><div class="d up">+${pi.clientes_nuevos} nuevos en el período</div></button>
          <button class="kpi" ${ir('contratos', { ...delPeriodo, ejecutivo: per.ejecutivo || undefined, etiqueta: `Creados ${etiquetaPer}` })} title="Ver los contratos vendidos en el período"><div class="l">Ventas</div><div class="v">${clp(pi.ventas)}</div><div class="d nu">${pi.contratos} contrato(s) · cobrado ${clp(pi.cobrado)}</div></button>
          <button class="kpi" ${ir('contratos', { estado: 'activo', etiqueta: 'Contratos activos' })} title="Ver los servicios activos"><div class="l">Servicios activos</div><div class="v">${pi.servicios_activos}</div><div class="d nu">contratos vigentes hoy</div></button>
          <button class="kpi warn" ${ir('documentos', { tipo: 'tramite' })} title="Ver los trámites pendientes"><div class="l">Trámites pendientes</div><div class="v">${pi.tramites + pi.tickets}</div><div class="d nu">${pi.tramites} documento(s) · ${pi.tickets} ticket(s)</div></button>
          <button class="kpi" ${ir('documentos', { tipo: 'firma' })} title="Ver los documentos esperando firma"><div class="l">Pendientes de firma</div><div class="v">${pi.pendientes_firma}</div><div class="d nu">enviados a firma electrónica</div></button>
        </div>
        <div class="g2">
          <div><h4 class="sub-h">Ventas por servicio</h4>
            <div class="tbl-wrap"><table><thead><tr><th>Servicio</th><th>Contratos</th><th>Monto neto</th><th></th></tr></thead>
            <tbody>${pi.porServicio.length ? pi.porServicio.map((x) => filaVenta(x, maxS)).join('') : filaVacia(4, 'Sin ventas en el período.')}</tbody></table></div></div>
          <div><h4 class="sub-h">Ventas por ejecutivo</h4>
            <div class="tbl-wrap"><table><thead><tr><th>Ejecutivo</th><th>Contratos</th><th>Monto neto</th><th></th></tr></thead>
            <tbody>${pi.porEjecutivo.length ? pi.porEjecutivo.map((x) => filaVenta(x, maxE, x.id
              ? `class="clic" ${ir('contratos', { ...delPeriodo, ejecutivo: x.id, etiqueta: `${x.ejecutivo} · creados ${etiquetaPer}` })} title="Ver sus contratos del período"`
              : 'title="Compras de la tienda en línea"')).join('') : filaVacia(4, 'Sin ventas en el período.')}</tbody></table></div></div>
        </div>
      </div>
      <h3 class="tt-sec">Operación de hoy</h3>
      <div class="kpis">
        <button class="kpi" ${ir('contratos', { estado: 'activo', etiqueta: 'Contratos activos' })} title="Ver los contratos activos"><div class="l">Contratos vigentes</div><div class="v">${k.activos.toLocaleString('es-CL')}</div><div class="d up">+${k.nuevosMes} creados este mes</div></button>
        <button class="kpi bad" ${ir('renovaciones', { filtro: 'vencidos' })} title="Ver los vencidos sin renovar"><div class="l">Vencidos sin renovar</div><div class="v">${k.vencidos}</div><div class="d dn">${clp(k.montoRiesgo)} netos en riesgo</div></button>
        <button class="kpi warn" ${ir('renovaciones', { filtro: '30' })} title="Ver los que vencen en 30 días"><div class="l">Vencen en 30 días</div><div class="v">${k.vencen30}</div><div class="d nu">${k.vencen30SinAviso} sin aviso enviado</div></button>
        <button class="kpi" ${ir('contratos', { estado: 'activo', etiqueta: 'Contratos activos (base del ingreso recurrente)' })} title="Ver los contratos que suman el ingreso"><div class="l">Ingreso recurrente mensual</div><div class="v">${clp(k.mrr)}</div><div class="d nu">neto, contratos vigentes</div></button>
      </div>
      <div class="g2 mb18">
        <div class="panel">
          <div class="ph-row"><h3>Renovaciones por vencer</h3><button class="lnk" ${ir('renovaciones', { filtro: '60' })}>Ver renovaciones →</button></div>
          <div class="ph">Contratos activos que vencen en los próximos 6 meses. Haga clic en un mes para ver sus contratos.</div>
          <div class="bars">${d.barras.map((b) => {
            const [y, m] = b.mes.split('-').map(Number);
            const lvl = b.total && b.total >= max * 0.75 ? 'hi' : b.total && b.total >= max * 0.4 ? 'md' : '';
            return `<button class="bcol clic" ${ir('contratos', { estado: 'activo', mes: b.mes, etiqueta: `Vencen en ${MESES_LARGO[m - 1]} ${y}` })} title="Contratos que vencen en ${MESES_LARGO[m - 1]} ${y}"><div class="bval">${b.total}</div><div class="btrack"><div class="bfill ${lvl}" style="height:${Math.round(b.total / max * 100)}%"></div></div><div class="blab">${mesCorto(m)} ${String(y).slice(2)}</div></button>`;
          }).join('')}</div>
        </div>
        <div class="panel">
          <div class="ph-row"><h3>Requiere acción hoy</h3><button class="lnk" ${ir('documentos', { tipo: 'pendientes' })}>Documentos por revisar →</button></div>
          <div class="ph">Vencidos sin renovar, vencimientos de esta semana, documentos esperando revisión y seguimientos de la bitácora.</div>
          <div class="list">${d.accion.length ? d.accion.map((a) => {
            const [bg, txt] = TIPOS[a.tipo];
            const det = a.tipo === 'revisar' ? `Documento esperando revisión · ${esc(a.folio)}`
              : a.tipo === 'seguimiento' ? `Seguimiento ${a.dias > 0 ? `atrasado ${a.dias} día(s)` : 'para hoy'} · ${esc(a.folio)}`
                : `${esc(a.folio)} · ${a.tipo === 'vencido' ? 'venció' : 'vence'} ${dias(a.tipo === 'vencido' ? -a.dias : a.dias)}${a.monto ? ' · ' + clp(a.monto) : ''}`;
            const abre = a.tipo === 'revisar' ? `data-revisar="${a.documento_id}"` : a.tipo === 'seguimiento' ? `data-cliente="${a.cliente_id}"` : `data-contrato="${a.contrato_id}"`;
            return `<div class="li clic" ${abre} tabindex="0" title="${a.tipo === 'revisar' ? 'Ver y aprobar el documento' : a.tipo === 'seguimiento' ? 'Abrir la ficha y su bitácora' : 'Abrir el contrato'}">
              <div><div class="n"><button class="lnk-n" data-cliente="${a.cliente_id}" title="Abrir la ficha del cliente">${esc(a.cliente)}</button></div><div class="s">${det}</div></div>
              <div class="r"><span class="bg ${bg}">${txt}</span></div></div>`;
          }).join('') : '<div class="empty">Nada pendiente para hoy.</div>'}</div>
        </div>
      </div>
      <div class="g2b">
        <div class="panel">
          <div class="ph-row"><h3>Pagos · últimos 7 días</h3><button class="lnk" ${ir('ventas', { dias: 7 })}>Ver pagos →</button></div>
          <div class="tbl-wrap"><table>
            <thead><tr><th>Pasarela</th><th>Pagados</th><th>Monto</th><th>Pendientes</th><th>Rechazados</th></tr></thead>
            <tbody>${d.ventas.length ? d.ventas.map((v) => `<tr class="clic" ${ir('ventas', { pasarela: v.pasarela, dias: 7 })} title="Ver los pagos de ${esc(pasarela(v.pasarela))}"><td class="nm">${pasarela(v.pasarela)}</td><td>${v.pagados}</td><td class="money">${clp(v.monto)}</td><td>${v.pendientes}</td><td>${v.rechazados}</td></tr>`).join('') : filaVacia(5, 'Sin pagos en los últimos 7 días.')}</tbody>
          </table></div>
        </div>
        <div class="panel">
          <h3>Carga por ejecutivo</h3>
          <div class="tbl-wrap"><table>
            <thead><tr><th>Ejecutivo</th><th>Contratos</th><th>Documentos</th><th>Carga</th></tr></thead>
            <tbody>${d.carga.length ? d.carga.map((c) => {
              const pct = Math.round((c.contratos + c.documentos) / maxC * 100);
              return `<tr class="clic" ${ir('contratos', { ejecutivo: c.id, etiqueta: `Ejecutivo: ${c.ejecutivo}` })} title="Ver los contratos de ${esc(c.ejecutivo)}"><td class="nm">${esc(c.ejecutivo)}</td><td>${c.contratos}</td><td>${c.documentos}</td><td><span class="barmini"><i class="${pct >= 80 ? 'low' : pct >= 50 ? 'mid' : ''}" style="width:${pct}%"></i></span></td></tr>`;
            }).join('') : filaVacia(4, 'Sin asignaciones.')}</tbody>
          </table></div>
        </div>
      </div></div>`;

    const volver = () => nav.ir('dashboard');
    const tablero = el.querySelector('#tablero');
    const recargar = () => {
      try { sessionStorage.setItem('eo_dash_periodo', JSON.stringify(per)); } catch { /* sin almacenamiento */ }
      this.render(el, { refrescarMenu }).catch((err) => { if (err.message !== 'sesion') toast(err.message, true); });
    };
    tablero.querySelector('.per-ctl').addEventListener('change', (e) => {
      const campo = { pPreset: 'preset', pDesde: 'desde', pHasta: 'hasta', pEjec: 'ejecutivo' }[e.target.id];
      if (!campo) return;
      per[campo] = e.target.value;
      if (per.preset === 'otro' && campo !== 'preset' && (!per.desde || !per.hasta || per.desde > per.hasta)) {
        return toast('Revise las fechas: la inicial debe ser anterior o igual a la final.', true);
      }
      recargar();
    });
    tablero.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-cliente],[data-revisar],[data-contrato],[data-ir]');
      if (!t) return;
      try {
        if (t.dataset.cliente) return await abrirFicha(t.dataset.cliente);
        if (t.dataset.revisar) return await revisarDocumento(t.dataset.revisar, volver);
        if (t.dataset.contrato) return await abrirContrato(t.dataset.contrato);
        nav.ir(t.dataset.ir, JSON.parse(t.dataset.f || '{}'));
      } catch (err) {
        if (err.message !== 'sesion') toast(err.message, true);
      }
    });
    tablero.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('.li.clic')) e.target.click();
    });
  }
};
