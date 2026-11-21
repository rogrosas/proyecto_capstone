/* CRM · Administración → Planes y documentos
   La tienda vista por servicio → plan → documentos que genera la compra (plantilla_planes).
   Es la vista inversa de "Documentos de la tienda": desde aquí se vinculan o quitan documentos de cada plan. */
import { get, put } from '../api.js';
import { clp, esc, toast } from '../util.js';
import { abrirModal, cerrarModal } from '../modal.js';

const ENTREGA = { automatica: ['grn', 'Automática'], revision: ['blu', 'Con revisión'] };

let panelActual = null;

export async function verPlanesTienda(panel) {
  panelActual = panel;
  const { plantillas, planes } = await get('/admin/documentos-tienda');
  const porPlan = {};
  plantillas.forEach((p) => p.planes.forEach((c) => (porPlan[c] ||= []).push(p)));

  const todos = planes.flatMap((f) => f.planes);
  const enLinea = todos.filter((p) => p.precio !== null);
  const sinDoc = enLinea.filter((p) => !(porPlan[p.codigo] || []).some((d) => d.activo));
  const conDoc = todos.filter((p) => (porPlan[p.codigo] || []).length);

  const docChip = (d) => `
    <span class="doc-plan${d.activo ? '' : ' inactivo'}" title="${esc(d.archivo_base)}">
      <b>${esc(d.tipo_documento)}</b> <span class="sb">v${d.version}</span>
      <span class="bg ${ENTREGA[d.entrega][0]}">${ENTREGA[d.entrega][1]}</span>
      ${d.activo ? '' : '<span class="sb">inactiva</span>'}
      ${d.marcas === null ? '<span class="rojo">Word con error</span>' : ''}
    </span>`;

  const fila = (p) => {
    const docs = porPlan[p.codigo] || [];
    const precio = p.precio === null ? `<span class="sb">${esc(p.precio_texto || 'Se cotiza')}</span>` : clp(p.precio);
    const aviso = !docs.length
      ? (p.precio === null ? '<span class="sb">Se cotiza: no se vende en línea</span>'
        : '<span class="amb-t">Sin documento: la compra no genera ninguno</span>')
      : '';
    return `
      <tr>
        <td><div class="nm">${esc(p.nombre)}</div><div class="sb">${esc(p.codigo)}${p.periodo ? ` · ${esc(p.periodo)}` : ''}</div></td>
        <td>${precio}</td>
        <td><div class="docs-plan">${docs.map(docChip).join('')}${aviso}</div></td>
        <td class="right"><button class="btn btn-o btn-row" data-plan="${esc(p.codigo)}">Documentos</button></td>
      </tr>`;
  };

  panel.innerHTML = `
    <div class="toolbar"><h3 class="tt-sec">Planes y documentos</h3><a class="btn btn-o" href="/contratar" target="_blank" rel="noopener">Ver la tienda</a></div>
    <div class="kpis kpis-p kpis-t">
      <div class="kpi"><div class="l">Servicios</div><div class="v">${planes.length}</div></div>
      <div class="kpi"><div class="l">Planes</div><div class="v">${todos.length}</div><div class="d nu">${enLinea.length} se venden en línea</div></div>
      <div class="kpi"><div class="l">Planes con documento</div><div class="v">${conDoc.length}</div></div>
      <div class="kpi ${sinDoc.length ? 'warn' : ''}"><div class="l">En línea sin documento</div><div class="v">${sinDoc.length}</div></div>
    </div>
    <div class="note" style="margin:0 0 14px;">Cada plan de la tienda con los documentos Word que se generan al comprarlo. Los servicios y
      precios vienen de <b>catalogo.js</b>; los documentos se suben en <b>Documentos de la tienda</b>.</div>
    ${planes.map((f) => `
      <h4 class="sub-h">${esc(f.familia)} <span class="hint">${f.planes.length} plan(es)</span></h4>
      <div class="tbl-wrap"><table class="tbl-planes">
        <thead><tr><th>Plan</th><th>Precio</th><th>Documentos que genera la compra</th><th></th></tr></thead>
        <tbody>${f.planes.map(fila).join('')}</tbody>
      </table></div>`).join('')}`;

  panel.onclick = (e) => {
    const b = e.target.closest('[data-plan]');
    if (b) elegirDocumentos(todos.find((p) => p.codigo === b.dataset.plan), plantillas);
  };
}

const recargar = () => { if (panelActual && document.body.contains(panelActual)) verPlanesTienda(panelActual); };

/* ---------- Vincular o quitar documentos de un plan ---------- */
function elegirDocumentos(plan, plantillas) {
  // Las inactivas solo aparecen si ya están vinculadas (para poder quitarlas)
  const visibles = plantillas.filter((p) => p.activo || p.planes.includes(plan.codigo));
  abrirModal({
    titulo: `Documentos · ${plan.nombre}`,
    contenido: visibles.length ? `
      <div class="sb" style="margin-bottom:10px;">Al comprar este plan se generan los documentos marcados, con los datos del cliente.
        ${plan.precio === null ? '<br><b>Este plan se cotiza</b>: no se compra en línea, así que los documentos solo se generan desde el CRM.' : ''}</div>
      <div class="lista-docs">${visibles.map((p) => `
        <label class="chk-doc">
          <input type="checkbox" name="doc" value="${p.id}" ${p.planes.includes(plan.codigo) ? 'checked' : ''}>
          <span><b>${esc(p.tipo_documento)}</b> <span class="sb">v${p.version}${p.activo ? '' : ' · inactiva'}</span>
            <span class="bg ${ENTREGA[p.entrega][0]}">${ENTREGA[p.entrega][1]}</span>
            <span class="sb d">${esc(p.archivo_base)}${p.planes.length ? ` · en ${p.planes.length} plan(es)` : ''}</span></span>
        </label>`).join('')}</div>`
      : '<div class="empty">No hay documentos Word. Súbalos en Administración → Documentos de la tienda.</div>',
    acciones: [{ texto: 'Cancelar' }, ...(visibles.length ? [{
      texto: 'Guardar', clase: 'btn-g', alHacer: async (c) => {
        await put(`/admin/tienda/planes/${encodeURIComponent(plan.codigo)}/documentos`, {
          plantillas: [...c.querySelectorAll('[name=doc]:checked')].map((x) => Number(x.value))
        });
        toast(`Documentos de "${plan.nombre}" guardados.`);
        cerrarModal();
        recargar();
      }
    }] : [])]
  });
}
