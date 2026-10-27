/* CRM · Dashboard (contratos, alertas, documentos, pagos, usuarios) */
import { get } from '../api.js';
import { esc, clp, dias, mesCorto, filaVacia, pasarela } from '../util.js';
import { estado } from '../estado.js';

export default {
  id: 'dashboard',
  titulo: 'Dashboard',
  sub: () => `Resumen operativo · ${new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}`,
  async render(el, { refrescarMenu }) {
    el.innerHTML = '<div class="kpis"><div class="kpi"><div class="l">Cargando…</div></div></div>';
    const d = await get('/dashboard');
    estado.conteos = d.conteos;
    refrescarMenu();
    const k = d.kpi;
    const max = Math.max(1, ...d.barras.map((b) => b.total));
    const maxC = Math.max(1, ...d.carga.map((c) => c.contratos + c.documentos));
    const TIPOS = { vencido: ['red', 'Vencido'], por_vencer: ['amb', 'Por vencer'], revisar: ['blu', 'Revisar'] };

    el.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="l">Contratos vigentes</div><div class="v">${k.activos.toLocaleString('es-CL')}</div><div class="d up">+${k.nuevosMes} creados este mes</div></div>
        <div class="kpi bad"><div class="l">Vencidos sin renovar</div><div class="v">${k.vencidos}</div><div class="d dn">${clp(k.montoRiesgo)} netos en riesgo</div></div>
        <div class="kpi warn"><div class="l">Vencen en 30 días</div><div class="v">${k.vencen30}</div><div class="d nu">${k.vencen30SinAviso} sin aviso enviado</div></div>
        <div class="kpi"><div class="l">Ingreso recurrente mensual</div><div class="v">${clp(k.mrr)}</div><div class="d nu">neto, contratos vigentes</div></div>
      </div>
      <div class="g2 mb18">
        <div class="panel">
          <h3>Renovaciones por vencer</h3>
          <div class="ph">Contratos activos que vencen en los próximos 6 meses.</div>
          <div class="bars">${d.barras.map((b) => {
            const [y, m] = b.mes.split('-').map(Number);
            const lvl = b.total && b.total >= max * 0.75 ? 'hi' : b.total && b.total >= max * 0.4 ? 'md' : '';
            return `<div class="bcol"><div class="bval">${b.total}</div><div class="btrack"><div class="bfill ${lvl}" style="height:${Math.round(b.total / max * 100)}%"></div></div><div class="blab">${mesCorto(m)} ${String(y).slice(2)}</div></div>`;
          }).join('')}</div>
        </div>
        <div class="panel">
          <h3>Requiere acción hoy</h3>
          <div class="ph">Vencidos sin renovar, vencimientos de esta semana y documentos esperando revisión.</div>
          <div class="list">${d.accion.length ? d.accion.map((a) => {
            const [bg, txt] = TIPOS[a.tipo];
            const det = a.tipo === 'revisar' ? `Documento esperando revisión · ${esc(a.folio)}`
              : `${esc(a.folio)} · ${a.tipo === 'vencido' ? 'venció' : 'vence'} ${dias(a.tipo === 'vencido' ? -a.dias : a.dias)}${a.monto ? ' · ' + clp(a.monto) : ''}`;
            return `<div class="li"><div><div class="n">${esc(a.cliente)}</div><div class="s">${det}</div></div><div class="r"><span class="bg ${bg}">${txt}</span></div></div>`;
          }).join('') : '<div class="empty">Nada pendiente para hoy.</div>'}</div>
        </div>
      </div>
      <div class="g2b">
        <div class="panel">
          <h3>Pagos · últimos 7 días</h3>
          <div class="tbl-wrap"><table>
            <thead><tr><th>Pasarela</th><th>Pagados</th><th>Monto</th><th>Pendientes</th><th>Rechazados</th></tr></thead>
            <tbody>${d.ventas.length ? d.ventas.map((v) => `<tr><td class="nm">${pasarela(v.pasarela)}</td><td>${v.pagados}</td><td class="money">${clp(v.monto)}</td><td>${v.pendientes}</td><td>${v.rechazados}</td></tr>`).join('') : filaVacia(5, 'Sin pagos en los últimos 7 días.')}</tbody>
          </table></div>
        </div>
        <div class="panel">
          <h3>Carga por ejecutivo</h3>
          <div class="tbl-wrap"><table>
            <thead><tr><th>Ejecutivo</th><th>Contratos</th><th>Documentos</th><th>Carga</th></tr></thead>
            <tbody>${d.carga.length ? d.carga.map((c) => {
              const pct = Math.round((c.contratos + c.documentos) / maxC * 100);
              return `<tr><td class="nm">${esc(c.ejecutivo)}</td><td>${c.contratos}</td><td>${c.documentos}</td><td><span class="barmini"><i class="${pct >= 80 ? 'low' : pct >= 50 ? 'mid' : ''}" style="width:${pct}%"></i></span></td></tr>`;
            }).join('') : filaVacia(4, 'Sin asignaciones.')}</tbody>
          </table></div>
        </div>
      </div>`;
  }
};
