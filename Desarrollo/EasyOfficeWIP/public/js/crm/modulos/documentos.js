/* CRM · Documentos (documentos, documento_partes, documento_clausulas, plantillas_documento, clausulas_documento) */
import { get, post } from '../api.js';
import { esc, fecha, fechaHora, filaVacia, badge, toast, hoyISO, enlaceArchivo } from '../util.js';
import { estado, opciones, aOpciones } from '../estado.js';
import { abrirModal, cerrarModal, formularioHTML, leerFormulario, validar, confirmar } from '../modal.js';
import { registrarPago } from './ventas.js';

let contenedor = null;

const ACCIONES = {
  en_revision: ['Enviar a revisión', 'btn-g'],
  enviado_firma: ['Enviar a firma', 'btn-g'],
  firmado: ['Marcar firmado', 'btn-g'],
  rechazado: ['Rechazar', 'btn-peligro'],
  borrador: ['Volver a borrador', 'btn-o'],
  anulado: ['Anular', 'btn-peligro']
};

async function cargar() {
  const tb = contenedor.querySelector('#tbDocs');
  tb.innerHTML = filaVacia(7, 'Cargando…');
  try {
    const d = await get('/documentos?tipo=' + contenedor.querySelector('#fDocTipo').value);
    const e = d.etapas;
    contenedor.querySelector('#pipeDocs').innerHTML = [
      ['01', 'Borrador', 'Generado desde plantilla', e.borrador],
      ['02', 'En revisión', 'Esperando aprobación humana', e.en_revision],
      ['03', 'Aprobado', 'Listo para enviar a firma', e.aprobado],
      ['04', 'Enviado a firma', 'En la plataforma de firma', e.enviado_firma],
      ['05', 'Firmado', 'Con código de verificación', e.firmado]
    ].map(([n, t, s, c]) => `<div class="ps"><div class="num">${n}</div><div class="t">${t}</div><div class="d">${s}</div><div class="c">${c || 0}</div></div>`).join('');
    tb.innerHTML = d.documentos.length ? d.documentos.map((x) => `
      <tr class="clic" data-documento="${x.id}">
        <td><div class="nm">${esc(x.tipo)}</div><div class="sb mono">${esc(x.folio || 'DOC-' + x.id)} · ${fecha(x.generado)}</div></td>
        <td>${esc(x.cliente)}</td>
        <td>${x.requiere_revision ? '<span class="bg blu">Requiere revisión</span>' : '<span class="bg gry">Automático</span>'}</td>
        <td>${badge('documento', x.estado)}${x.firmado ? `<div class="sb">${fecha(x.firmado)}</div>` : ''}</td>
        <td>${esc(x.ejecutivo || '—')}</td>
        <td>${esc(x.revisor || '—')}</td>
        <td class="right">${x.estado === 'en_revision' ? `<button class="btn btn-g btn-row" data-aprobar="${x.id}">Aprobar</button>` : ''}</td>
      </tr>`).join('') : filaVacia(7, 'No hay documentos.');
  } catch (err) {
    if (err.message !== 'sesion') tb.innerHTML = filaVacia(7, err.message, true);
  }
}
const recargarLista = () => { if (contenedor && document.body.contains(contenedor)) cargar(); };

/* ---------- Detalle ---------- */
export async function abrirDocumento(id) {
  const d = await get('/documentos/' + id);
  const doc = d.documento;
  const cuerpo = abrirModal({
    titulo: `${doc.tipo} · DOC-${doc.id}`, ancho: 'lg',
    contenido: `
      <div class="ficha-acciones">
        ${d.puedeAprobar ? '<button class="btn btn-g btn-s" data-aprobar>Aprobar</button>' : ''}
        ${d.siguientes.map((s) => `<button class="btn ${ACCIONES[s][1]} btn-s" data-estado="${s}">${ACCIONES[s][0]}</button>`).join('')}
        <button class="btn btn-o btn-s" data-pago>Registrar pago</button>
      </div>
      <div class="g2e">
        <div class="panel plano">
          <h3>${esc(doc.cliente)}</h3>
          <div class="kv"><span class="k">Plantilla</span><span class="v">${esc(doc.plantilla || '—')}</span></div>
          <div class="kv"><span class="k">Contrato</span><span class="v mono">${esc(doc.folio || '—')}</span></div>
          <div class="kv"><span class="k">Servicio</span><span class="v">${esc(doc.servicio || '—')}</span></div>
          <div class="kv"><span class="k">Lugar y fecha</span><span class="v">${esc(doc.lugar || '—')} · ${fecha(doc.fecha_documento)}</span></div>
          <div class="kv"><span class="k">Ejecutivo</span><span class="v">${esc(doc.ejecutivo || '—')}</span></div>
          <div class="kv"><span class="k">Archivo</span><span class="v">${enlaceArchivo(doc)}</span></div>
        </div>
        <div class="panel plano">
          <h3>Estado ${badge('documento', doc.estado)}</h3>
          <div class="kv"><span class="k">Revisión humana</span><span class="v">${doc.requiere_revision ? 'Requerida' : 'No requerida'}</span></div>
          <div class="kv"><span class="k">Aprobado por</span><span class="v">${doc.revisor ? `${esc(doc.revisor)} · ${fechaHora(doc.revisado_en)}` : '—'}</span></div>
          <div class="kv"><span class="k">Id en plataforma de firma</span><span class="v mono">${esc(doc.firma_id_externo || '—')}</span></div>
          <div class="kv"><span class="k">Firmado</span><span class="v">${fechaHora(doc.firmado_en)}</span></div>
          <div class="kv"><span class="k">Código de verificación</span><span class="v mono">${esc(doc.codigo_verificacion || '—')}</span></div>
        </div>
      </div>
      <h4 class="sub-h">Partes que comparecen</h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>#</th><th>Rol</th><th>Nombre</th><th>RUT</th><th>Detalle</th></tr></thead>
        <tbody>${d.partes.length ? d.partes.map((p) => `
          <tr><td>${p.orden}</td><td>${esc(p.rol)}</td><td class="nm">${esc(p.nombre)}<div class="sb">${p.tipo_persona === 'juridica' ? 'Persona jurídica' : 'Persona natural'}</div></td>
            <td class="mono">${esc(p.rut_fmt || '—')}</td>
            <td class="sb">${esc([p.nacionalidad, p.estado_civil, p.profesion, p.representante_nombre && `rep. ${p.representante_nombre} ${p.representante_rut || ''}`,
              p.cantidad_acciones !== null && `${p.cantidad_acciones.toLocaleString('es-CL')} acciones`].filter(Boolean).join(' · '))}</td></tr>`).join('')
          : filaVacia(5, 'Sin partes registradas.')}</tbody>
      </table></div>
      <h4 class="sub-h">Texto del documento</h4>
      <div class="doc-texto">${esc(d.texto || 'La plantilla no tiene contenido.')}</div>`
  });

  cuerpo.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-aprobar],[data-estado],[data-pago]');
    if (!t) return;
    try {
      if ('pago' in t.dataset) return registrarPago({ documento_id: doc.id }, () => abrirDocumento(id));
      if ('aprobar' in t.dataset) {
        await post(`/documentos/${id}/aprobar`);
        toast('Documento aprobado: quedó registrado con su nombre y la hora.');
      } else {
        const nuevo = t.dataset.estado;
        const extra = {};
        if (nuevo === 'enviado_firma') {
          const ok = await pedirDato('Enviar a firma', 'firma_id_externo', 'Id del documento en la plataforma de firma (opcional)');
          if (ok === null) return abrirDocumento(id);
          extra.firma_id_externo = ok || undefined;
        } else if (nuevo === 'firmado') {
          const ok = await pedirDato('Marcar firmado', 'url_archivo', 'URL del archivo firmado (opcional)');
          if (ok === null) return abrirDocumento(id);
          extra.url_archivo = ok || undefined;
        } else if (['rechazado', 'anulado'].includes(nuevo)) {
          if (!(await confirmar(`¿${ACCIONES[nuevo][0]} este documento?`, { textoSi: ACCIONES[nuevo][0], peligro: true }))) return abrirDocumento(id);
        }
        await post(`/documentos/${id}/estado`, { estado: nuevo, ...extra });
        toast('Estado del documento actualizado.');
      }
      recargarLista();
      abrirDocumento(id);
    } catch (err) {
      if (err.message !== 'sesion') toast(err.message, true);
    }
  });
}

function pedirDato(titulo, nombre, etiqueta) {
  return new Promise((resolver) => {
    abrirModal({
      titulo, ancho: 'sm', contenido: formularioHTML([{ nombre, etiqueta, ancho: 'full' }]),
      acciones: [
        { texto: 'Cancelar', alHacer: () => { cerrarModal(); resolver(null); } },
        { texto: 'Continuar', clase: 'btn-g', alHacer: (c) => { const v = leerFormulario(c)[nombre]; cerrarModal(); resolver(v || ''); } }
      ]
    });
  });
}

/* ---------- Nuevo documento ---------- */
export async function nuevoDocumento(pre = {}) {
  const op = await opciones();
  const { clientes } = await get('/clientes');
  const plantillas = op.plantillas.filter((p) => p.activo);
  let contratosCliente = [];

  const filaParte = (i) => `
    <div class="parte" data-parte>
      <div class="grid4">
        <div class="f"><label>Rol</label><input name="partes.${i}.rol" placeholder="accionista, apoderado…"></div>
        <div class="f"><label>Tipo</label><select name="partes.${i}.tipo_persona" data-tipo><option value="natural">Natural</option><option value="juridica">Jurídica</option></select></div>
        <div class="f"><label>Nombre o razón social</label><input name="partes.${i}.nombre"></div>
        <div class="f"><label>RUT</label><input name="partes.${i}.rut"></div>
        <div class="f"><label>Nacionalidad</label><input name="partes.${i}.nacionalidad"></div>
        <div class="f"><label>Estado civil</label><input name="partes.${i}.estado_civil"></div>
        <div class="f"><label>Profesión</label><input name="partes.${i}.profesion"></div>
        <div class="f"><label>Acciones</label><input type="number" min="0" name="partes.${i}.cantidad_acciones"></div>
        <div class="f" data-jur hidden><label>Representante</label><input name="partes.${i}.representante_nombre"></div>
        <div class="f" data-jur hidden><label>RUT representante</label><input name="partes.${i}.representante_rut"></div>
        <div class="f"><label>Correo</label><input type="email" name="partes.${i}.email"></div>
        <div class="f"><label>Teléfono</label><input name="partes.${i}.telefono"></div>
      </div>
      <button type="button" class="btn btn-o btn-row" data-quitar-parte>Quitar parte</button>
    </div>`;

  const cuerpo = abrirModal({
    titulo: 'Nuevo documento', ancho: 'lg',
    contenido: `
      ${formularioHTML([
        { nombre: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', requerido: true, valor: pre.cliente_id, opciones: clientes.map((c) => ({ valor: c.id, texto: `${c.razon_social} · ${c.rut_fmt}` })) },
        { nombre: 'contrato_id', etiqueta: 'Contrato (opcional)', tipo: 'select', opciones: [] },
        { nombre: 'plantilla_id', etiqueta: 'Plantilla', tipo: 'select', requerido: true, opciones: plantillas.map((p) => ({ valor: p.id, texto: `${p.nombre} v${p.version}${p.requiere_revision ? ' · requiere revisión' : ''}` })) },
        { nombre: 'servicio_id', etiqueta: 'Servicio vendido (opcional)', tipo: 'select', opciones: aOpciones(op.servicios, { soloActivos: true }) },
        { nombre: 'lugar', etiqueta: 'Lugar', valor: 'Santiago' },
        { nombre: 'fecha_documento', etiqueta: 'Fecha del documento', tipo: 'fecha', valor: hoyISO() },
        estado.usuario.admin ? { nombre: 'ejecutivo_id', etiqueta: 'Ejecutivo', tipo: 'select', valor: estado.usuario.id, opciones: aOpciones(op.usuarios, { soloActivos: true }) } : { nombre: '_x', tipo: 'html', html: '' }
      ])}
      <h4 class="sub-h">Datos de la plantilla</h4>
      <div id="camposPlantilla" class="grid2"><div class="empty full">Elija una plantilla.</div></div>
      <h4 class="sub-h">Cláusulas <span class="hint">(se agregan en el orden marcado)</span></h4>
      <div id="clausulas"><div class="empty">Elija una plantilla para ver sus cláusulas.</div></div>
      <h4 class="sub-h">Partes que comparecen</h4>
      <div id="partes">${filaParte(0)}</div>
      <button type="button" class="btn btn-o btn-s" id="masParte">Agregar parte</button>`,
    acciones: [{ texto: 'Cancelar' }, {
      texto: 'Crear documento', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        const datos = leerFormulario(c);
        datos.partes = Object.values(datos.partes || {}).filter((p) => p.nombre);
        datos.clausulas = [...c.querySelectorAll('[data-clausula]:checked')].map((x) => ({
          clausula_id: Number(x.value),
          valores: Object.fromEntries([...c.querySelectorAll(`[data-de-clausula="${x.value}"]`)].map((i) => [i.dataset.clave, i.value]))
        }));
        delete datos.cl; delete datos._x;
        const r = await post('/documentos', datos);
        toast('Documento creado como borrador.');
        recargarLista();
        abrirDocumento(r.id);
      }
    }]
  });

  const selCliente = cuerpo.querySelector('[name=cliente_id]');
  const selContrato = cuerpo.querySelector('[name=contrato_id]');
  const cargarContratos = async () => {
    selContrato.innerHTML = '<option value="">—</option>';
    if (!selCliente.value) return;
    try {
      const f = await get('/clientes/' + selCliente.value);
      contratosCliente = f.contratos;
      selContrato.innerHTML += contratosCliente.map((k) => `<option value="${k.id}" ${String(k.id) === String(pre.contrato_id) ? 'selected' : ''}>${esc(k.folio)} · ${esc(k.servicios || '')}</option>`).join('');
    } catch (err) { toast(err.message, true); }
  };
  selCliente.addEventListener('change', cargarContratos);
  cargarContratos();

  const campos = (lista, atributos = '') => (Array.isArray(lista) ? lista : []).map((x) =>
    `<div class="f"><label>${esc(x.etiqueta || x.clave)}</label><input ${atributos} data-clave="${esc(x.clave)}" ${atributos ? '' : `name="datos.${esc(x.clave)}"`}></div>`).join('');

  cuerpo.querySelector('[name=plantilla_id]').addEventListener('change', (e) => {
    const p = plantillas.find((x) => String(x.id) === e.target.value);
    cuerpo.querySelector('#camposPlantilla').innerHTML = p && p.campos?.length ? campos(p.campos) : '<div class="empty full">La plantilla no define variables.</div>';
    const cls = p ? op.clausulas.filter((c) => c.familia === p.familia && c.activo) : [];
    cuerpo.querySelector('#clausulas').innerHTML = cls.length ? cls.map((c) => `
      <div class="clausula">
        <label class="chk"><input type="checkbox" data-clausula value="${c.id}"> <b>${esc(c.codigo)}</b> · ${esc(c.titulo)}</label>
        <div class="grid2">${campos(c.campos, `data-de-clausula="${c.id}"`)}</div>
      </div>`).join('') : '<div class="empty">No hay cláusulas para esta familia de documento.</div>';
  });

  let n = 1;
  cuerpo.querySelector('#masParte').addEventListener('click', () => cuerpo.querySelector('#partes').insertAdjacentHTML('beforeend', filaParte(n++)));
  cuerpo.addEventListener('click', (e) => { if (e.target.closest('[data-quitar-parte]')) e.target.closest('[data-parte]').remove(); });
  cuerpo.addEventListener('change', (e) => {
    if (!e.target.matches('[data-tipo]')) return;
    e.target.closest('[data-parte]').querySelectorAll('[data-jur]').forEach((x) => { x.hidden = e.target.value !== 'juridica'; });
  });
}

export default {
  id: 'documentos',
  titulo: 'Documentos y firmas',
  sub: () => 'Generación desde plantilla, verificación humana y firma',
  cnt: 'enRevision',
  async render(el) {
    contenedor = el;
    el.innerHTML = `
      <div class="sh"><p>Los documentos cuya plantilla "requiere revisión" no pueden enviarse a firma sin la aprobación de una persona identificada: la base de datos lo impide. Al firmar se genera el código de verificación.</p></div>
      <div class="pipe" id="pipeDocs"></div>
      <div class="toolbar">
        <select class="fl" id="fDocTipo"><option value="">Todos los tipos</option><option value="automatico">Automático</option><option value="revision">Requiere revisión</option></select>
        <button class="btn btn-g" id="btnNuevoDoc">Nuevo documento</button>
      </div>
      <div class="panel tbl-panel tbl-wrap"><table>
        <thead><tr><th>Documento</th><th>Cliente</th><th>Origen</th><th>Estado</th><th>Ejecutivo</th><th>Revisó</th><th></th></tr></thead>
        <tbody id="tbDocs"></tbody>
      </table></div>`;
    el.querySelector('#fDocTipo').addEventListener('change', cargar);
    el.querySelector('#btnNuevoDoc').addEventListener('click', () => nuevoDocumento().catch((err) => toast(err.message, true)));
    el.querySelector('#tbDocs').addEventListener('click', async (e) => {
      const ap = e.target.closest('[data-aprobar]');
      if (ap) {
        e.stopPropagation();
        try { await post(`/documentos/${ap.dataset.aprobar}/aprobar`); toast('Documento aprobado.'); cargar(); } catch (err) { toast(err.message, true); }
        return;
      }
      const f = e.target.closest('[data-documento]');
      if (f) abrirDocumento(f.dataset.documento).catch((err) => toast(err.message, true));
    });
    await cargar();
  }
};
