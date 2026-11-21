/* CRM · Tienda del sitio web (tienda_familias, tienda_planes, plantilla_planes)
   Aquí se arma toda la tienda: servicios (pestañas de /contratar), sus planes con precio, vigencia y
   características, el orden en que aparecen, qué se muestra y los documentos Word que genera cada compra.
   Los cambios se ven en el sitio al instante. */
import { get, post, put, del } from '../api.js';
import { clp, esc, toast } from '../util.js';
import { abrirModal, cerrarModal, confirmar, formularioHTML, leerFormulario, validar } from '../modal.js';
import { verDocumentosTienda } from './documentosTienda.js';

const ENTREGA = { automatica: ['grn', 'Automática'], revision: ['blu', 'Con revisión'] };
const COBRO = { anual: 'Pago anual', semestral: 'Pago semestral', mensual: 'Mensual', bolsa: 'Bolsa (pago único)', unico: 'Pago único' };
const GRUPOS = { bolsas: 'Bolsas de firmas', planes: 'Planes de firmas', digitales: 'Servicios digitales' };

let contenedor = null;
let seccion = 'planes';
let datos = null;   // última lectura de /admin/tienda

const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const lineas = (a) => (a || []).join('\n');
const precioTexto = (p) => (p.precio === null ? (p.precio_texto || 'Se cotiza') : clp(p.precio));

/* ---------- Servicios y planes ---------- */
async function verPlanes(panel) {
  datos = await get('/admin/tienda');
  const { familias } = datos;
  const planes = familias.flatMap((f) => f.planes);
  const visibles = (f) => f.activo ? f.planes.filter((p) => p.activo) : [];
  const enLinea = familias.flatMap(visibles).filter((p) => p.precio !== null);
  const sinDoc = enLinea.filter((p) => !p.documentos.some((d) => d.activo));

  const docChip = (d) => `<span class="doc-plan${d.activo ? '' : ' inactivo'}"><b>${esc(d.tipo_documento)}</b> <span class="sb">v${d.version}</span>
    <span class="bg ${ENTREGA[d.entrega][0]}">${ENTREGA[d.entrega][1]}</span>${d.activo ? '' : '<span class="sb">inactiva</span>'}</span>`;

  const filaPlan = (f, p, i) => `
    <tr class="${p.activo && f.activo ? '' : 'inactivo'}">
      <td class="ord">${flechas('plan', p.codigo, i, f.planes.length)}</td>
      <td><div class="nm">${esc(p.nombre)} ${p.activo ? '' : '<span class="bg gry">Oculto</span>'}</div>
        <div class="sb">${esc(p.codigo)}${p.periodo ? ` · ${esc(p.periodo)}` : ''}${p.vendido ? ' · ya vendido' : ''}</div></td>
      <td><b>${precioTexto(p)}</b><div class="sb">${p.precio === null ? 'No se vende en línea' : esc(COBRO[p.recurrencia] || p.recurrencia)}</div></td>
      <td><div class="docs-plan">${p.documentos.map(docChip).join('')}
        ${p.documentos.length ? '' : p.precio === null ? '<span class="sb">Sin documento</span>' : '<span class="amb-t">Sin documento: la compra no genera ninguno</span>'}
        <button class="lnk" data-docs="${esc(p.codigo)}">${p.documentos.length ? 'Cambiar documentos' : '+ Vincular documento'}</button></div></td>
      <td class="right"><button class="btn btn-o btn-row" data-plan="${esc(p.codigo)}">Editar</button></td>
    </tr>`;

  panel.innerHTML = `
    <div class="toolbar"><h3 class="tt-sec">Servicios y planes</h3>
      <a class="btn btn-o" href="/contratar" target="_blank" rel="noopener">Ver la tienda ↗</a>
      <button class="btn btn-o" data-nuevo-servicio>Nuevo servicio</button>
      <button class="btn btn-g" data-nuevo-plan ${familias.length ? '' : 'disabled'}>Nuevo plan</button></div>
    <div class="kpis kpis-p kpis-t">
      <div class="kpi"><div class="l">Servicios en la tienda</div><div class="v">${familias.filter((f) => f.activo && visibles(f).length).length}</div><div class="d nu">${familias.length} en total</div></div>
      <div class="kpi"><div class="l">Planes visibles</div><div class="v">${familias.flatMap(visibles).length}</div><div class="d nu">${planes.length} en total</div></div>
      <div class="kpi"><div class="l">Se venden en línea</div><div class="v">${enLinea.length}</div><div class="d nu">el resto se cotiza</div></div>
      <div class="kpi ${sinDoc.length ? 'warn' : ''}"><div class="l">En línea sin documento</div><div class="v">${sinDoc.length}</div></div>
    </div>
    <div class="note" style="margin:0 0 16px;">Cada <b>servicio</b> es una pestaña de la tienda y cada <b>plan</b>, una tarjeta que se compra en línea o se cotiza.
      Los cambios se ven en el sitio al instante. Ordene con las flechas; lo <b>oculto</b> no aparece en el sitio pero se conserva.
      Las páginas de cada servicio (por ejemplo /contabilidad) muestran planes fijos: un plan nuevo aparece en <b>/contratar</b>.</div>
    ${familias.length ? familias.map((f, i) => `
      <section class="t-fam${f.activo ? '' : ' inactiva'}">
        <div class="t-fam-h">
          <div class="ord">${flechas('servicio', f.codigo, i, familias.length)}</div>
          <div class="t-fam-t">
            <h4>${esc(f.nombre)} ${f.activo ? '' : '<span class="bg gry">Oculto</span>'}</h4>
            <div class="sb">${esc(f.codigo)} · ${f.planes.length} plan(es)${f.nota ? ` · ${esc(f.nota)}` : ''}</div>
          </div>
          <div class="nowrap">
            <button class="btn btn-o btn-row" data-servicio="${esc(f.codigo)}">Editar servicio</button>
            <button class="btn btn-o btn-row" data-nuevo-plan="${esc(f.codigo)}">+ Plan</button>
          </div>
        </div>
        ${f.planes.length ? `<div class="tbl-wrap"><table class="tbl-tienda">
          <thead><tr><th></th><th>Plan</th><th>Precio</th><th>Documentos que genera la compra</th><th></th></tr></thead>
          <tbody>${f.planes.map((p, j) => filaPlan(f, p, j)).join('')}</tbody>
        </table></div>` : '<div class="empty">Sin planes todavía. Agregue el primero con “+ Plan”.</div>'}
      </section>`).join('') : '<div class="empty">La tienda está vacía. Cree el primer servicio.</div>'}`;

  panel.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if ('nuevoServicio' in d) return formServicio(null);
    if ('nuevoPlan' in d) return formPlan(null, d.nuevoPlan || null);
    if (d.servicio) return formServicio(familias.find((f) => f.codigo === d.servicio));
    if (d.plan) return formPlan(planes.find((p) => p.codigo === d.plan));
    if (d.docs) return elegirDocumentos(planes.find((p) => p.codigo === d.docs));
    if (d.mover) return mover(d.tipo, d.mover, Number(d.dir));
  };
}

const flechas = (tipo, codigo, i, n) => `
  <button class="ib" title="Subir" data-tipo="${tipo}" data-mover="${esc(codigo)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>▲</button>
  <button class="ib" title="Bajar" data-tipo="${tipo}" data-mover="${esc(codigo)}" data-dir="1" ${i === n - 1 ? 'disabled' : ''}>▼</button>`;

async function mover(tipo, codigo, dir) {
  const lista = tipo === 'servicio' ? datos.familias : datos.familias.find((f) => f.planes.some((p) => p.codigo === codigo)).planes;
  const codigos = lista.map((x) => x.codigo);
  const i = codigos.indexOf(codigo);
  const j = i + dir;
  if (j < 0 || j >= codigos.length) return;
  [codigos[i], codigos[j]] = [codigos[j], codigos[i]];
  try {
    await put(`/admin/tienda/orden/${tipo === 'servicio' ? 'familias' : 'planes'}`, { codigos });
    recargar();
  } catch (err) { if (err.message !== 'sesion') toast(err.message, true); }
}

const recargar = () => { if (contenedor) mostrar(seccion); };

/* ---------- Servicio (pestaña de la tienda) ---------- */
function formServicio(f) {
  const nuevo = !f;
  const cuerpo = abrirModal({
    titulo: nuevo ? 'Nuevo servicio de la tienda' : `Servicio · ${f.nombre}`,
    contenido: formularioHTML([
      { nombre: 'nombre', etiqueta: 'Nombre (pestaña de la tienda)', requerido: true, ancho: 'full', valor: f?.nombre, placeholder: 'Domicilio tributario' },
      nuevo ? { nombre: 'codigo', etiqueta: 'Código', requerido: true, placeholder: 'domicilio', ayuda: 'Minúsculas y guiones. No se puede cambiar después.' }
        : { nombre: '_cod', tipo: 'html', html: `<label>Código</label><div class="mono" style="padding-top:8px;">${esc(f.codigo)}</div>` },
      { nombre: 'activo', etiqueta: 'Visible en la tienda', tipo: 'bool', valor: f ? f.activo : true },
      { nombre: 'nota', etiqueta: 'Nota bajo las pestañas', tipo: 'textarea', filas: 3, valor: f?.nota, ayuda: 'Texto corto que explica el servicio (cobertura, condiciones…).' }
    ]),
    acciones: [
      ...(!nuevo && !f.planes.length ? [{ texto: 'Borrar', clase: 'btn-peligro', alHacer: async () => {
        if (!(await confirmar(`¿Borrar el servicio "${f.nombre}"?`, { textoSi: 'Borrar', peligro: true }))) return;
        await del(`/admin/tienda/servicios/${encodeURIComponent(f.codigo)}`);
        toast('Servicio borrado.');
        recargar();
      } }] : []),
      { texto: 'Cancelar' },
      { texto: 'Guardar', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        const d = leerFormulario(c);
        if (nuevo) await post('/admin/tienda/servicios', d);
        else await put(`/admin/tienda/servicios/${encodeURIComponent(f.codigo)}`, d);
        toast(nuevo ? 'Servicio creado.' : 'Servicio guardado.');
        cerrarModal();
        recargar();
      } }
    ]
  });
  if (nuevo) autoCodigo(cuerpo, 'nombre', 'codigo');
}

// En un registro nuevo el código se sugiere desde el nombre hasta que se edita a mano
function autoCodigo(cuerpo, desde, hacia, prefijo = () => '') {
  const origen = cuerpo.querySelector(`[name="${desde}"]`);
  const destino = cuerpo.querySelector(`[name="${hacia}"]`);
  let tocado = false;
  destino.addEventListener('input', () => { tocado = true; });
  const sugerir = () => { if (!tocado) destino.value = slug(prefijo() + ' ' + origen.value); };
  origen.addEventListener('input', sugerir);
  return sugerir;
}

/* ---------- Plan (tarjeta de la tienda) ---------- */
function formPlan(p, familiaPre) {
  const nuevo = !p;
  const fam = p ? datos.familias.find((f) => f.id === p.familia_id) : datos.familias.find((f) => f.codigo === familiaPre);
  const cotiza = p ? p.precio === null : false;
  const cuerpo = abrirModal({
    titulo: nuevo ? 'Nuevo plan' : `Plan · ${p.nombre}`, ancho: 'lg',
    contenido: `
      <div class="t-editor">
        <div>${formularioHTML([
          { nombre: 'familia', etiqueta: 'Servicio', tipo: 'select', requerido: true, valor: fam?.codigo,
            opciones: datos.familias.map((f) => ({ valor: f.codigo, texto: f.nombre })) },
          nuevo ? { nombre: 'codigo', etiqueta: 'Código', requerido: true, placeholder: 'dom-anual', ayuda: 'Minúsculas y guiones. No se puede cambiar después.' }
            : { nombre: '_cod', tipo: 'html', html: `<label>Código</label><div class="mono" style="padding-top:8px;">${esc(p.codigo)}${p.vendido ? ' <span class="sb">· ya vendido</span>' : ''}</div>` },
          { nombre: 'nombre', etiqueta: 'Nombre del plan', requerido: true, ancho: 'full', valor: p?.nombre, placeholder: 'Plan Anual' },
          { nombre: 'cotiza', etiqueta: 'Se cotiza (no se vende en línea: termina en agendar con un ejecutivo)', tipo: 'bool', ancho: 'full', valor: cotiza },
          { nombre: 'precio', etiqueta: 'Precio (CLP)', tipo: 'numero', min: 0, paso: 1, valor: p?.precio ?? '', placeholder: '59990' },
          { nombre: 'recurrencia', etiqueta: 'Cobro', tipo: 'select', valor: p && p.recurrencia !== 'cotiza' ? p.recurrencia : 'unico',
            opciones: Object.entries(COBRO).map(([valor, texto]) => ({ valor, texto })) },
          { nombre: 'precio_texto', etiqueta: 'Texto del precio', valor: p?.precio_texto, placeholder: 'UF 14', ayuda: 'Lo que se muestra en vez del precio. Vacío: “A convenir”.' },
          { nombre: 'periodo', etiqueta: 'Vigencia o periodicidad', valor: p?.periodo, placeholder: '12 meses · pago único' },
          { nombre: 'activo', etiqueta: 'Visible en la tienda', tipo: 'bool', valor: p ? p.activo : true },
          { nombre: 'caracteristicas', etiqueta: 'Características (una por línea)', tipo: 'textarea', filas: 5, requerido: true, valor: lineas(p?.caracteristicas),
            ayuda: 'Resumen de la tarjeta en /contratar.' },
          { nombre: 'detalle', etiqueta: 'Detalle completo (opcional, una por línea)', tipo: 'textarea', filas: 4, valor: lineas(p?.detalle),
            ayuda: 'Se muestra en la página del servicio. Vacío: se usan las características.' },
          { nombre: 'grupo', etiqueta: 'Lista de precios (página de firmas)', tipo: 'select', valor: p?.grupo,
            opciones: Object.entries(GRUPOS).map(([valor, texto]) => ({ valor, texto })) },
          { nombre: 'corto', etiqueta: 'Texto en la lista de precios', valor: p?.corto, placeholder: '10 firmas electrónicas avanzadas' }
        ])}</div>
        <div class="t-prev"><div class="sb" style="margin-bottom:8px;">Vista previa de la tarjeta</div><div id="tPrev"></div></div>
      </div>`,
    acciones: [
      ...(!nuevo && !p.vendido ? [{ texto: 'Borrar plan', clase: 'btn-peligro', alHacer: async () => {
        if (!(await confirmar(`¿Borrar el plan "${p.nombre}"? También se quitan sus documentos vinculados.`, { textoSi: 'Borrar', peligro: true }))) return;
        await del(`/admin/tienda/planes/${encodeURIComponent(p.codigo)}`);
        toast('Plan borrado.');
        recargar();
      } }] : []),
      { texto: 'Cancelar' },
      { texto: 'Guardar', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        const d = leerFormulario(c);
        if (nuevo) await post('/admin/tienda/planes', d);
        else await put(`/admin/tienda/planes/${encodeURIComponent(p.codigo)}`, d);
        toast(nuevo ? 'Plan creado: ya aparece en la tienda.' : 'Plan guardado.');
        cerrarModal();
        recargar();
      } }
    ]
  });

  const $c = (n) => cuerpo.querySelector(`[name="${n}"]`);
  const actualizar = () => {
    const sinPrecio = $c('cotiza').checked;
    $c('precio').disabled = sinPrecio;
    $c('precio').required = !sinPrecio;
    $c('recurrencia').disabled = sinPrecio;
    $c('precio_texto').disabled = !sinPrecio;
    $c('corto').disabled = !$c('grupo').value;
    const precio = sinPrecio ? ($c('precio_texto').value || 'A convenir') : $c('precio').value ? clp($c('precio').value) : '$—';
    const items = ($c('caracteristicas').value || '').split('\n').map((x) => x.trim()).filter(Boolean);
    cuerpo.querySelector('#tPrev').innerHTML = `
      <div class="t-card">
        <div class="t-card-h">${esc($c('nombre').value || 'Nombre del plan')}</div>
        ${sinPrecio ? '<div class="t-card-r">requiere cotización</div>' : ''}
        <div class="t-card-p">${esc(precio)}</div>
        <div class="t-card-per">${esc($c('periodo').value)}</div>
        <ul>${items.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="sb">Agregue características</li>'}</ul>
        <div class="t-card-cta">${sinPrecio ? 'Agendar asesoría' : 'Contratar aquí'}</div>
      </div>`;
  };
  cuerpo.addEventListener('input', actualizar);
  cuerpo.addEventListener('change', actualizar);
  if (nuevo) {
    const sugerir = autoCodigo(cuerpo, 'nombre', 'codigo', () => $c('familia').value.split('-')[0].slice(0, 4));
    $c('familia').addEventListener('change', sugerir);
  }
  actualizar();
}

/* ---------- Documentos que genera la compra de un plan ---------- */
function elegirDocumentos(plan) {
  const vinculados = new Set(plan.documentos.map((d) => d.id));
  // Las inactivas solo aparecen si ya están vinculadas (para poder quitarlas)
  const visibles = datos.plantillas.filter((p) => p.activo || vinculados.has(p.id));
  abrirModal({
    titulo: `Documentos · ${plan.nombre}`,
    contenido: visibles.length ? `
      <div class="sb" style="margin-bottom:10px;">Al comprar este plan se generan los documentos marcados, con los datos del cliente.
        ${plan.precio === null ? '<br><b>Este plan se cotiza</b>: no se compra en línea, así que los documentos solo se generan desde el CRM.' : ''}</div>
      <div class="lista-docs">${visibles.map((p) => `
        <label class="chk-doc">
          <input type="checkbox" name="doc" value="${p.id}" ${vinculados.has(p.id) ? 'checked' : ''}>
          <span><b>${esc(p.tipo_documento)}</b> <span class="sb">v${p.version}${p.activo ? '' : ' · inactiva'}</span>
            <span class="bg ${ENTREGA[p.entrega][0]}">${ENTREGA[p.entrega][1]}</span>
            <span class="sb d">${esc(p.archivo_base)}${p.planes.length ? ` · en ${p.planes.length} plan(es)` : ''}</span></span>
        </label>`).join('')}</div>`
      : '<div class="empty">No hay documentos Word. Súbalos en Tienda → Documentos Word.</div>',
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

/* ---------- Navegación interna ---------- */
async function mostrar(nombre) {
  seccion = nombre;
  contenedor.querySelectorAll('[data-sec]').forEach((b) => b.classList.toggle('on', b.dataset.sec === nombre));
  const panel = contenedor.querySelector('#tiendaPanel');
  const nuevo = panel.cloneNode(false); // descarta listeners anteriores
  panel.replaceWith(nuevo);
  nuevo.innerHTML = '<div class="empty">Cargando…</div>';
  try {
    if (nombre === 'documentos') await verDocumentosTienda(nuevo);
    else await verPlanes(nuevo);
  } catch (err) {
    if (err.message !== 'sesion') nuevo.innerHTML = `<div class="empty err">${esc(err.message)}</div>`;
  }
}

export default {
  id: 'tienda',
  titulo: 'Tienda',
  sub: () => 'Servicios, planes, precios y documentos de la tienda del sitio',
  permisos: ['administrar_catalogos'],
  async render(el) {
    contenedor = el;
    el.innerHTML = `
      <div class="adm">
        <aside class="adm-menu">
          <div class="adm-g">Tienda</div>
          <button data-sec="planes">Servicios y planes</button>
          <button data-sec="documentos">Documentos Word</button>
          <div class="adm-g">Sitio</div>
          <a class="adm-link" href="/contratar" target="_blank" rel="noopener">Abrir /contratar ↗</a>
        </aside>
        <div class="panel" id="tiendaPanel"></div>
      </div>`;
    el.querySelector('.adm-menu').addEventListener('click', (e) => { const b = e.target.closest('[data-sec]'); if (b) mostrar(b.dataset.sec); });
    await mostrar(seccion);
  }
};
