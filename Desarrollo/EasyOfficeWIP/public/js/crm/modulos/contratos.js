/* CRM · Contratos (contratos, contrato_servicios, alertas, pagos, vistas de impresión) */
import { get, post, patch, del } from '../api.js';
import { esc, clp, fecha, fechaHora, dias, filaVacia, badge, toast, hoyISO, CICLO, pasarela, enlaceArchivo } from '../util.js';
import { estado, opciones, aOpciones } from '../estado.js';
import { abrirModal, cerrarModal, formularioHTML, leerFormulario, validar, confirmar } from '../modal.js';
import { abrirDocumento, nuevoDocumento } from './documentos.js';
import { registrarPago, cambiarEstadoPago } from './ventas.js';

let contenedor = null;

async function cargar() {
  const tb = contenedor.querySelector('#tbContratos');
  tb.innerHTML = filaVacia(8, 'Cargando…');
  const p = new URLSearchParams({ q: contenedor.querySelector('#qContratos').value, estado: contenedor.querySelector('#fEstadoK').value });
  try {
    const { contratos } = await get('/contratos?' + p);
    tb.innerHTML = contratos.length ? contratos.map((k) => `
      <tr class="clic" data-contrato="${k.id}">
        <td class="mono nm">${esc(k.folio)}</td>
        <td><div class="nm">${esc(k.cliente)}</div><div class="sb">${esc(k.rut)}</div></td>
        <td>${esc(k.servicios || '—')}<div class="sb">${esc(k.emisora)} · ${esc(k.sucursal)}</div></td>
        <td>${fecha(k.inicio)} → ${fecha(k.vence)}<div class="sb">${k.duracion_meses} meses · ${dias(k.dias)}</div></td>
        <td class="money">${clp(k.total_servicios)}</td>
        <td class="money">${k.saldo > 0 ? `<span class="rojo">${clp(k.saldo)}</span>` : clp(k.saldo)}</td>
        <td>${esc(k.ejecutivo || '—')}</td>
        <td>${badge('contrato', k.estado)}</td>
      </tr>`).join('') : filaVacia(8, 'No hay contratos que coincidan.');
  } catch (err) {
    if (err.message !== 'sesion') tb.innerHTML = filaVacia(8, err.message, true);
  }
}
const recargarLista = () => { if (contenedor && document.body.contains(contenedor)) cargar(); };

/* ---------- Detalle ---------- */
export async function abrirContrato(id) {
  const d = await get('/contratos/' + id);
  const k = d.contrato;
  const admin = estado.usuario.admin;
  const cuerpo = abrirModal({
    titulo: `Contrato ${k.folio}`, ancho: 'lg',
    contenido: `
      <div class="ficha-acciones">
        <button class="btn btn-g btn-s" data-acc="word">Generar contrato Word</button>
        <a class="btn btn-o btn-s" href="/crm-contrato.html?id=${k.id}" target="_blank" rel="noopener">Vista previa</a>
        <button class="btn btn-o btn-s" data-acc="editar">Editar condiciones</button>
        <button class="btn btn-g btn-s" data-acc="renovar">Renovar</button>
        <button class="btn btn-o btn-s" data-acc="pago">Registrar pago</button>
        <button class="btn btn-o btn-s" data-acc="documento">Nuevo documento</button>
      </div>
      <div class="g2e">
        <div class="panel plano">
          <h3>${esc(k.cliente)}</h3>
          <div class="kv"><span class="k">RUT</span><span class="v mono">${esc(k.rut)}</span></div>
          <div class="kv"><span class="k">Emisora · sucursal</span><span class="v">${esc(k.emisora)} · ${esc(k.sucursal)}</span></div>
          <div class="kv"><span class="k">Celebrado</span><span class="v">${esc(k.lugar_celebracion)}, ${fecha(k.fecha_celebracion)}</span></div>
          <div class="kv"><span class="k">Vigencia</span><span class="v">${fecha(k.inicio)} → ${fecha(k.vence)} (${k.duracion_meses} meses)</span></div>
          <div class="kv"><span class="k">Renovación automática</span><span class="v">${k.renovacion_automatica ? 'Sí' : 'No'}</span></div>
          <div class="kv"><span class="k">Medio de pago</span><span class="v">${k.link_pago ? `<a href="${esc(k.link_pago)}" target="_blank" rel="noopener">Link de pago</a>` : 'Transferencia a cuenta'}</span></div>
          <div class="kv"><span class="k">Ejecutivo</span><span class="v">${esc(k.ejecutivo || '—')}</span></div>
          <div class="kv"><span class="k">Estado</span><span class="v">${badge('contrato', k.estado)}</span></div>
          ${k.observaciones ? `<div class="obs">${esc(k.observaciones)}</div>` : ''}
        </div>
        <div class="panel plano">
          <h3>Saldo</h3>
          <div class="kv"><span class="k">Total neto de servicios</span><span class="v money">${clp(k.total_servicios)}</span></div>
          <div class="kv"><span class="k">Pagado</span><span class="v money">${clp(k.pagado)}</span></div>
          <div class="kv"><span class="k">Saldo pendiente</span><span class="v money ${k.saldo > 0 ? 'rojo' : ''}">${clp(k.saldo)}</span></div>
          <h3 style="margin-top:16px;">Alertas de vencimiento</h3>
          ${d.alertas.length ? `<div class="list">${d.alertas.map((a) => `
            <div class="li"><div><div class="n">${fecha(a.fecha)}</div><div class="s">${a.dias_anticipacion} días antes</div></div>
              <div class="r">${a.notificado ? '<span class="bg grn">Aviso enviado</span>'
                : `<button class="btn btn-o btn-row" data-alerta="${a.id}">Marcar enviado</button>`}</div></div>`).join('')}</div>
            ${d.alertas.some((a) => a.vencida && !a.notificado) ? '<button class="btn btn-d btn-s" data-acc="notificar">Marcar como enviados los avisos ya vencidos</button>' : ''}`
            : '<div class="empty">Sin alertas: la base de datos solo crea alertas con fecha futura.</div>'}
        </div>
      </div>
      <h4 class="sub-h">Servicios (Anexo 1) <button class="btn btn-o btn-row" data-acc="servicio">Agregar servicio</button></h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>#</th><th>Servicio</th><th>Ciclo</th><th>Precio neto</th><th>Contenido</th>${admin ? '<th></th>' : ''}</tr></thead>
        <tbody>${d.servicios.map((s) => `
          <tr><td>${s.orden}</td><td class="nm">${esc(s.nombre)}</td><td>${CICLO[s.ciclo_pago] || s.ciclo_pago}</td>
            <td class="money">${clp(s.precio)}</td><td class="sb">${esc(s.descripcion || '')}</td>
            ${admin ? `<td><button class="ib dg" title="Quitar servicio" data-quitar="${s.id}">✕</button></td>` : ''}</tr>`).join('')}</tbody>
      </table></div>
      <h4 class="sub-h">Pagos</h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Fecha</th><th>Monto</th><th>Pasarela</th><th>Cuota</th><th>Estado</th><th></th></tr></thead>
        <tbody>${d.pagos.length ? d.pagos.map((p) => `
          <tr><td>${fechaHora(p.fecha)}</td><td class="money">${clp(p.monto)}</td><td>${pasarela(p.pasarela)}</td>
            <td>${p.cuota} de ${p.total_cuotas}</td><td>${badge('pago', p.estado)}</td>
            <td><button class="btn btn-o btn-row" data-pago="${p.id}" data-estado="${p.estado}">Cambiar estado</button></td></tr>`).join('')
          : filaVacia(6, 'Sin pagos registrados.')}</tbody>
      </table></div>
      <h4 class="sub-h">Documentos del contrato</h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Documento</th><th>Generado</th><th>Estado</th><th>Archivo</th></tr></thead>
        <tbody>${d.documentos.length ? d.documentos.map((x) => `
          <tr class="clic" data-documento="${x.id}"><td class="nm">${esc(x.tipo)}</td><td>${fecha(x.generado)}</td><td>${badge('documento', x.estado)}</td>
            <td>${enlaceArchivo(x)}</td></tr>`).join('')
          : filaVacia(4, 'Sin documentos.')}</tbody>
      </table></div>`
  });

  const reabrir = () => { recargarLista(); return abrirContrato(id); };
  cuerpo.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-acc],[data-alerta],[data-quitar],[data-pago],[data-documento]');
    if (!t) return;
    try {
      if (e.target.closest('a[download]')) return;
      if (t.dataset.documento) return abrirDocumento(t.dataset.documento);
      if (t.dataset.alerta) { await post(`/alertas/${t.dataset.alerta}/notificar`); toast('Alerta marcada como enviada.'); return reabrir(); }
      if (t.dataset.pago) return cambiarEstadoPago(t.dataset.pago, t.dataset.estado, reabrir);
      if (t.dataset.quitar) {
        if (!(await confirmar('¿Quitar este servicio del contrato?', { textoSi: 'Quitar', peligro: true }))) return reabrir();
        await del(`/contratos/${id}/servicios/${t.dataset.quitar}`);
        toast('Servicio quitado.');
        return reabrir();
      }
      switch (t.dataset.acc) {
        case 'editar': return editarContrato(d, reabrir);
        case 'servicio': return agregarServicio(id, reabrir);
        case 'pago': return registrarPago({ contrato_id: id, monto: k.saldo > 0 ? k.saldo : '' }, reabrir);
        case 'documento': return nuevoDocumento({ cliente_id: k.cliente_id, contrato_id: k.id });
        case 'word': return generarWord(k, reabrir);
        case 'notificar': {
          const r = await post(`/contratos/${id}/notificar-alertas`);
          toast(`${r.notificadas} aviso(s) marcados como enviados.`);
          return reabrir();
        }
        case 'renovar': {
          if (!(await confirmar(`Se creará un nuevo contrato desde el ${fecha(addDia(k.vence))} por ${k.duracion_meses} meses, con los mismos servicios a precio de catálogo vigente.`, { titulo: `Renovar ${k.folio}`, textoSi: 'Renovar' }))) return reabrir();
          const r = await post(`/contratos/${id}/renovar`);
          toast(`Contrato renovado: ${r.folio}.`);
          recargarLista();
          return abrirContrato(r.id);
        }
      }
    } catch (err) {
      if (err.message !== 'sesion') toast(err.message, true);
    }
  });
}

/* ---------- Contrato Word desde la plantilla (combinación con los datos de la BD) ---------- */

async function generarWord(k, alTerminar) {
  const { plantillas } = await get('/plantillas-word');
  if (!plantillas.length) {
    toast('No hay plantillas con archivo Word. Asócielas en Administración → Plantillas de documento.', true);
    return alTerminar();
  }
  const sugerida = plantillas.find((p) => p.familia === 'CONTRATO_SERVICIO') || plantillas[0];
  const cuerpo = abrirModal({
    titulo: `Generar contrato Word · ${k.folio}`,
    contenido: formularioHTML([
      { nombre: 'plantilla_id', etiqueta: 'Plantilla', tipo: 'select', requerido: true, ancho: 'full', valor: sugerida.id,
        opciones: plantillas.map((p) => ({ valor: p.id, texto: `${p.tipo_documento} v${p.version} · ${p.archivo_base.split('/').pop()}` })) },
      { nombre: '_n', tipo: 'html', ancho: 'full', html: '<div class="note">Los campos del Word se completan con los datos actuales del contrato, el cliente y la sucursal. Cada vez que se genera queda una versión nueva; las anteriores se conservan.</div>' },
      { nombre: '_p', tipo: 'html', ancho: 'full', html: '<div id="pregWord"></div>' }
    ]),
    acciones: [{ texto: 'Cancelar', alHacer: alTerminar }, {
      texto: 'Generar', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        const valores = Object.fromEntries([...c.querySelectorAll('[data-marca]')].map((x) => [x.dataset.marca, x.value.trim()]));
        const r = await post(`/contratos/${k.id}/generar`, { plantilla_id: leerFormulario(c).plantilla_id, valores });
        const avisos = [
          r.pendientes.length && `sin completar: ${r.pendientes.map((x) => x.etiqueta).join(', ')}`,
          r.sin_dato.length && `faltan datos: ${r.sin_dato.join(', ')}`,
          r.servicios_omitidos && `${r.servicios_omitidos} servicio(s) no caben en la plantilla (máx. 3)`,
          r.campos_desconocidos.length && `campos sin equivalencia: ${r.campos_desconocidos.join(', ')}`
        ].filter(Boolean);
        toast(`Versión ${r.version} generada${r.publicado ? ' y publicada al cliente para su revisión' : ''}.${avisos.length ? ' Revise: ' + avisos.join(' · ') : ''}`, avisos.length > 0);
        const a = document.createElement('a');
        a.href = `/api/crm/documentos/${r.documento_id}/archivo`; a.download = '';
        document.body.appendChild(a); a.click(); a.remove();
        alTerminar();
      }
    }]
  });

  // Datos que no salen de la base: los completa el personal (con lo que respondió el comprador, si lo hay)
  const pintarPreguntas = async () => {
    const caja = cuerpo.querySelector('#pregWord');
    const id = cuerpo.querySelector('[name="plantilla_id"]').value;
    caja.innerHTML = '';
    try {
      const { preguntas } = await get(`/plantillas/${id}/preguntas?contrato=${k.id}`);
      if (!preguntas.length) return;
      caja.innerHTML = `<h4 class="sub-h">Datos para completar</h4><div class="grid2">${preguntas.map((q) => `
        <div class="f"><label>${esc(q.etiqueta)} <span class="sb mono">${esc(q.marca)}</span></label>
          <input data-marca="${esc(q.marca)}" value="${esc(q.valor)}">${q.fuente === '_tienda' ? '<span class="hint">Lo responde el cliente en la tienda</span>' : ''}</div>`).join('')}</div>`;
    } catch (err) {
      if (err.message !== 'sesion') caja.innerHTML = `<div class="note warn">${esc(err.message)}</div>`;
    }
  };
  cuerpo.querySelector('[name="plantilla_id"]').addEventListener('change', pintarPreguntas);
  pintarPreguntas();
}

const addDia = (iso) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };

async function editarContrato(d, alGuardar) {
  const k = d.contrato;
  const op = await opciones();
  const campos = [
    { nombre: 'estado', etiqueta: 'Estado', tipo: 'select', requerido: true, valor: k.estado, opciones: op.estadosContrato.map((x) => ({ valor: x, texto: x })) },
    { nombre: 'fecha_vencimiento', etiqueta: 'Fecha de vencimiento', tipo: 'fecha', requerido: true, valor: k.vence, ayuda: 'Al cambiarla, la base de datos regenera las alertas pendientes.' },
    { nombre: 'link_pago', etiqueta: 'Link de pago', valor: k.link_pago },
    { nombre: 'renovacion_automatica', etiqueta: 'Renovación automática', tipo: 'bool', valor: k.renovacion_automatica },
    { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', valor: k.observaciones, ancho: 'full' }
  ];
  if (estado.usuario.admin) campos.splice(1, 0, { nombre: 'ejecutivo_id', etiqueta: 'Ejecutivo', tipo: 'select', requerido: true, valor: k.ejecutivo_id, opciones: aOpciones(op.usuarios, { soloActivos: true }) });
  abrirModal({
    titulo: `Editar ${k.folio}`, contenido: formularioHTML(campos),
    acciones: [{ texto: 'Cancelar', alHacer: alGuardar }, {
      texto: 'Guardar', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        const datos = leerFormulario(c);
        if (datos.fecha_vencimiento === k.vence) delete datos.fecha_vencimiento;
        if (!estado.usuario.admin) delete datos.ejecutivo_id;
        await patch('/contratos/' + k.id, datos);
        toast('Contrato actualizado.');
        alGuardar();
      }
    }]
  });
}

async function agregarServicio(id, alGuardar) {
  const op = await opciones();
  abrirModal({
    titulo: 'Agregar servicio al contrato',
    contenido: formularioHTML([
      { nombre: 'servicio_id', etiqueta: 'Servicio', tipo: 'select', requerido: true, ancho: 'full', opciones: aOpciones(op.servicios, { soloActivos: true, texto: (s) => `${s.nombre} · ${s.precio_lista === null ? 'por cotizar' : clp(s.precio_lista)} ${CICLO[s.ciclo_pago_defecto]}` }) },
      { nombre: 'precio', etiqueta: 'Precio neto acordado', tipo: 'numero', min: 0, ayuda: 'Vacío = precio de lista del catálogo' },
      { nombre: 'ciclo_pago', etiqueta: 'Ciclo de pago', tipo: 'select', opciones: op.ciclos.map((x) => ({ valor: x, texto: CICLO[x] })), ayuda: 'Vacío = ciclo del catálogo' },
      { nombre: 'descripcion', etiqueta: 'Contenido en el contrato', tipo: 'textarea', ayuda: 'Vacío = descripción del catálogo' }
    ]),
    acciones: [{ texto: 'Cancelar', alHacer: alGuardar }, {
      texto: 'Agregar', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        await post(`/contratos/${id}/servicios`, leerFormulario(c));
        toast('Servicio agregado.');
        alGuardar();
      }
    }]
  });
}

/* ---------- Nuevo contrato ---------- */
export async function nuevoContrato(pre = {}) {
  const op = await opciones();
  const { clientes } = await get('/clientes');
  const admin = estado.usuario.admin;
  const filaServicio = (i) => `
    <div class="serv-fila" data-serv>
      <select name="servicios.${i}.servicio_id" required><option value="">Servicio…</option>
        ${op.servicios.filter((s) => s.activo).map((s) => `<option value="${s.id}" data-precio="${s.precio_lista ?? ''}" data-ciclo="${s.ciclo_pago_defecto}">${esc(s.nombre)}</option>`).join('')}
      </select>
      <input type="number" min="0" name="servicios.${i}.precio" placeholder="Precio de lista">
      <select name="servicios.${i}.ciclo_pago"><option value="">Ciclo del catálogo</option>${op.ciclos.map((c) => `<option value="${c}">${CICLO[c]}</option>`).join('')}</select>
      <button type="button" class="ib dg" data-quitar-serv title="Quitar">✕</button>
    </div>`;

  const cuerpo = abrirModal({
    titulo: 'Nuevo contrato', ancho: 'lg',
    contenido: `
      ${formularioHTML([
        { nombre: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', requerido: true, ancho: 'full', valor: pre.cliente_id, opciones: clientes.map((c) => ({ valor: c.id, texto: `${c.razon_social} · ${c.rut_fmt}` })) },
        { nombre: 'empresa_id', etiqueta: 'Empresa emisora', tipo: 'select', requerido: true, opciones: aOpciones(op.empresas, { soloActivos: true }) },
        { nombre: 'sucursal_id', etiqueta: 'Sucursal (define el prefijo del folio)', tipo: 'select', requerido: true, opciones: [] },
        { nombre: 'cuenta_recaudacion_id', etiqueta: 'Cuenta para transferencia', tipo: 'select', opciones: [] },
        { nombre: 'link_pago', etiqueta: 'o link de pago', placeholder: 'https://…' },
        { nombre: 'fecha_inicio', etiqueta: 'Inicio de la vigencia', tipo: 'fecha', requerido: true, valor: hoyISO() },
        { nombre: 'duracion_meses', etiqueta: 'Duración', tipo: 'select', requerido: true, valor: 12, opciones: [12, 6, 4, 3, 1].map((m) => ({ valor: m, texto: `${m} ${m === 1 ? 'mes' : 'meses'}` })) },
        { nombre: 'lugar_celebracion', etiqueta: 'Lugar de celebración', valor: 'Santiago' },
        { nombre: 'fecha_celebracion', etiqueta: 'Fecha de celebración', tipo: 'fecha', valor: hoyISO(), ayuda: 'Define el año del folio' },
        { nombre: 'estado', etiqueta: 'Estado inicial', tipo: 'select', requerido: true, valor: 'activo', opciones: [{ valor: 'activo', texto: 'Activo' }, { valor: 'pendiente', texto: 'Pendiente' }] },
        admin ? { nombre: 'ejecutivo_id', etiqueta: 'Ejecutivo a cargo', tipo: 'select', valor: estado.usuario.id, opciones: aOpciones(op.usuarios, { soloActivos: true }) }
          : { nombre: '_ej', tipo: 'html', html: `<label>Ejecutivo a cargo</label><div class="ro">${esc(estado.usuario.nombre)}</div>` },
        { nombre: 'renovacion_automatica', etiqueta: 'Renovación automática (cláusula QUINTO)', tipo: 'bool', valor: true },
        { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', ancho: 'full', filas: 2 }
      ])}
      <h4 class="sub-h">Servicios <span class="hint">Precio y ciclo vacíos = los del catálogo (los copia la base de datos)</span></h4>
      <div id="servicios">${filaServicio(0)}</div>
      <button type="button" class="btn btn-o btn-s" id="masServicio">Agregar otro servicio</button>
      <p class="hint" style="margin-top:12px;">El folio, la fecha de vencimiento y las alertas los asigna la base de datos al guardar.</p>`,
    acciones: [{ texto: 'Cancelar' }, {
      texto: 'Crear contrato', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        const datos = leerFormulario(c);
        datos.servicios = Object.values(datos.servicios || {}).filter((s) => s.servicio_id);
        delete datos._ej;
        const r = await post('/contratos', datos);
        toast(`Contrato ${r.folio} creado.`);
        recargarLista();
        abrirContrato(r.id);
      }
    }]
  });

  // Sucursales y cuentas dependen de la emisora
  const emp = cuerpo.querySelector('[name=empresa_id]');
  const llenar = () => {
    const e = Number(emp.value);
    cuerpo.querySelector('[name=sucursal_id]').innerHTML = '<option value="">Seleccione…</option>' +
      op.sucursales.filter((s) => s.empresa_id === e && s.activo).map((s) => `<option value="${s.id}">${esc(s.nombre)} (${s.prefijo_folio})</option>`).join('');
    cuerpo.querySelector('[name=cuenta_recaudacion_id]').innerHTML = '<option value="">—</option>' +
      op.cuentas.filter((s) => s.empresa_id === e && s.activo).map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('');
  };
  emp.addEventListener('change', llenar);
  if (op.empresas.filter((x) => x.activo).length === 1) { emp.value = op.empresas.find((x) => x.activo).id; }
  llenar();

  let n = 1;
  cuerpo.querySelector('#masServicio').addEventListener('click', () => cuerpo.querySelector('#servicios').insertAdjacentHTML('beforeend', filaServicio(n++)));
  cuerpo.addEventListener('click', (e) => { if (e.target.closest('[data-quitar-serv]') && cuerpo.querySelectorAll('[data-serv]').length > 1) e.target.closest('[data-serv]').remove(); });
  cuerpo.addEventListener('change', (e) => {
    if (!e.target.name?.endsWith('.servicio_id')) return;
    const o = e.target.selectedOptions[0];
    const fila = e.target.closest('[data-serv]');
    fila.querySelector('[name$=".precio"]').placeholder = o?.dataset.precio ? `Lista: ${clp(o.dataset.precio)}` : 'Por cotizar: indique precio';
  });
}

export default {
  id: 'contratos',
  titulo: 'Contratos',
  sub: () => 'Folios, servicios, vigencia, saldo y alertas',
  async render(el) {
    contenedor = el;
    el.innerHTML = `
      <div class="toolbar">
        <input class="search" id="qContratos" placeholder="Buscar por folio o cliente…">
        <select class="fl" id="fEstadoK"><option value="">Todos los estados</option><option value="activo">Activo</option><option value="pendiente">Pendiente</option><option value="vencido">Vencido</option><option value="cancelado">Cancelado</option></select>
        <button class="btn btn-g" id="btnNuevoContrato">Nuevo contrato</button>
      </div>
      <div class="panel tbl-panel tbl-wrap"><table>
        <thead><tr><th>Folio</th><th>Cliente</th><th>Servicios</th><th>Vigencia</th><th>Total neto</th><th>Saldo</th><th>Ejecutivo</th><th>Estado</th></tr></thead>
        <tbody id="tbContratos"></tbody>
      </table></div>`;
    let t;
    el.querySelector('#qContratos').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 300); });
    el.querySelector('#fEstadoK').addEventListener('change', cargar);
    el.querySelector('#btnNuevoContrato').addEventListener('click', () => nuevoContrato().catch((err) => toast(err.message, true)));
    el.querySelector('#tbContratos').addEventListener('click', (e) => {
      const f = e.target.closest('[data-contrato]');
      if (f) abrirContrato(f.dataset.contrato).catch((err) => toast(err.message, true));
    });
    await cargar();
  }
};
