/* CRM · Administración → Documentos de la tienda (plantillas_documento, plantilla_planes)
   Subir un Word, vincularlo a planes de la tienda, elegir la entrega y decidir qué dato va en cada marca. */
import { get, post, put } from '../api.js';
import { esc, filaVacia, toast } from '../util.js';
import { abrirModal, cerrarModal, formularioHTML, leerFormulario, validar } from '../modal.js';

const FAMILIAS = ['CONTRATO_SERVICIO', 'PODER', 'ACUERDO_ACCIONISTAS', 'ARRIENDO', 'OTRO'];
const FUENTE = {
  _tienda: 'Lo responde el cliente en la tienda',
  _ejecutivo: 'Lo completa el personal al generar',
  _ignorar: 'Dejar tal cual en el documento'
};
const ENTREGA = {
  automatica: ['grn', 'Automática', 'Al comprar se genera y el cliente recibe el borrador para revisarlo y aceptarlo.'],
  revision: ['blu', 'Con revisión', 'Al comprar se genera y queda esperando que el personal lo revise y lo publique al cliente.']
};

let panelActual = null;

export async function verDocumentosTienda(panel) {
  panelActual = panel;
  const { plantillas, planes } = await get('/admin/documentos-tienda');
  const nombrePlan = Object.fromEntries(planes.flatMap((f) => f.planes.map((p) => [p.codigo, `${f.familia} · ${p.nombre}`])));
  panel.innerHTML = `
    <div class="toolbar"><h3 class="tt-sec">Documentos de la tienda</h3><button class="btn btn-g" data-nuevo>Subir documento</button></div>
    <div class="note" style="margin:0 0 12px;">Cada documento Word se guarda en la carpeta <b>base de datos/Contratos</b>. Vincúlelo a los planes de la tienda:
      al comprar uno de ellos se genera con los datos del cliente. El cliente siempre revisa primero un borrador con marca de agua y debe aceptarlo
      para recibir el documento final; si no está de acuerdo, envía un ticket.</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Documento</th><th>Planes de la tienda</th><th>Entrega</th><th>Campos</th><th></th></tr></thead>
      <tbody>${plantillas.length ? plantillas.map((p) => `
        <tr${p.activo ? '' : ' class="inactivo"'}>
          <td><div class="nm">${esc(p.tipo_documento)} <span class="sb">v${p.version}</span></div><div class="sb">${esc(p.archivo_base)}</div></td>
          <td>${p.planes.length ? p.planes.map((c) => `<span class="chip">${esc(nombrePlan[c] || c)}</span>`).join(' ') : '<span class="sb">Sin planes: solo se genera desde el CRM</span>'}</td>
          <td><span class="bg ${ENTREGA[p.entrega][0]}">${ENTREGA[p.entrega][1]}</span></td>
          <td>${p.marcas === null ? `<span class="rojo">${esc(p.error)}</span>`
            : !p.marcas ? '<span class="amb-t">Sin marcas</span><div class="sb">El Word no tiene campos ni [corchetes]: no se completa con datos</div>'
            : `${p.marcas} marca(s)${p.manuales ? `<div class="sb">${p.manuales} se piden al cliente o al personal</div>` : ''}${p.configurada ? '' : '<div class="sb amb-t">Sin revisar: usa lo sugerido</div>'}`}</td>
          <td class="right"><button class="btn btn-o btn-row" data-configurar="${p.id}" ${p.marcas === null ? 'disabled' : ''}>Configurar</button></td>
        </tr>`).join('') : filaVacia(5, 'No hay documentos con archivo Word. Suba el primero.')}</tbody>
    </table></div>`;

  panel.querySelector('[data-nuevo]').addEventListener('click', subirDocumento);
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-configurar]');
    if (b) configurar(b.dataset.configurar);
  });
}

const recargar = () => { if (panelActual && document.body.contains(panelActual)) verDocumentosTienda(panelActual); };

/* ---------- Subir un Word nuevo y crear su plantilla ---------- */
function subirDocumento() {
  abrirModal({
    titulo: 'Subir documento de la tienda',
    contenido: formularioHTML([
      { nombre: 'tipo_documento', etiqueta: 'Nombre del documento', requerido: true, ancho: 'full', placeholder: 'CONTRATO DE ARRIENDO DE VEHÍCULO' },
      { nombre: 'familia', etiqueta: 'Familia', tipo: 'select', requerido: true, valor: 'CONTRATO_SERVICIO', opciones: FAMILIAS.map((f) => ({ valor: f, texto: f })) },
      { nombre: '_archivo', tipo: 'html', ancho: 'full', html: `
        <div class="f full"><label>Archivo Word (.docx) <span class="req">*</span></label>
          <input type="file" id="tdArchivo" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
          <span class="hint">Marque dónde van los datos con campos de combinación de Word o escribiéndolos entre corchetes, por ejemplo
          [RAZÓN SOCIAL DE LA EMPRESA], [RUT EMPRESA] o [FECHA]. Se guarda en base de datos/Contratos/plantillas.</span></div>` }
    ]),
    acciones: [{ texto: 'Cancelar' }, {
      texto: 'Subir y configurar', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        const archivo = c.querySelector('#tdArchivo').files[0];
        if (!archivo) throw new Error('Elija el archivo .docx.');
        const res = await fetch('/api/crm/admin/archivos?' + new URLSearchParams({ nombre: archivo.name, reemplazar: '0' }), {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo
        });
        const sub = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(sub.error || 'No se pudo subir el archivo.');
        if (!sub.campos) throw new Error('El Word no tiene campos de combinación ni marcas entre corchetes: no hay dónde poner los datos del cliente.');
        const d = leerFormulario(c);
        const { clave } = await post('/admin/catalogos/plantillas_documento', {
          tipo_documento: d.tipo_documento.trim().toLocaleUpperCase('es-CL'), version: 1, familia: d.familia,
          archivo_base: sub.archivo, requiere_revision: false, activo: true
        });
        toast(`Documento subido: ${sub.campos} marca(s) detectadas.`);
        recargar();
        configurar(clave);
      }
    }]
  });
}

/* ---------- Configurar planes, entrega y datos de cada marca ---------- */
async function configurar(id) {
  const d = await get(`/admin/plantillas/${id}/campos`);
  const p = d.plantilla;
  const grupos = {};
  d.datos.forEach((x) => (grupos[x.grupo] ||= []).push(x));
  const opcionesFuente = (sel) => `
    ${Object.entries(grupos).map(([g, lista]) => `<optgroup label="Dato del cliente · ${esc(g)}">${lista.map((x) =>
      `<option value="${esc(x.clave)}" ${x.clave === sel ? 'selected' : ''}>${esc(x.etiqueta)}</option>`).join('')}</optgroup>`).join('')}
    <optgroup label="Otro">${Object.entries(FUENTE).map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`;

  const cuerpo = abrirModal({
    titulo: `Configurar · ${p.tipo_documento}`, ancho: 'lg',
    contenido: `
      <div class="sb" style="margin-bottom:12px;">${esc(p.archivo_base)} · <a href="/api/crm/plantillas/${p.id}/archivo" download>Descargar Word</a></div>
      <h4 class="sub-h">Entrega al comprar en la tienda</h4>
      <div class="entregas">${Object.entries(ENTREGA).map(([k, [, t, s]]) => `
        <label class="entrega"><input type="radio" name="entrega" value="${k}" ${p.entrega === k ? 'checked' : ''}>
          <span><b>${t}</b><span class="sb">${s}</span></span></label>`).join('')}</div>
      <h4 class="sub-h">Planes de la tienda que generan este documento</h4>
      <div class="planes-sel">${d.planes.map((f) => `
        <fieldset><legend>${esc(f.familia)}</legend>${f.planes.map((x) => `
          <label class="chk-f"><input type="checkbox" name="plan" value="${esc(x.codigo)}" ${p.planes.includes(x.codigo) ? 'checked' : ''}>
            ${esc(x.nombre)}${x.precio === null ? ' <span class="sb">(se cotiza: no se vende en línea)</span>' : ''}</label>`).join('')}
        </fieldset>`).join('')}</div>
      <h4 class="sub-h">Dónde van los datos del cliente <span class="hint">(${d.marcas.length} marca(s) detectadas en el Word)</span></h4>
      <div class="tbl-wrap"><table class="tbl-campos">
        <thead><tr><th>Marca en el Word</th><th>Dato que va</th><th>Pregunta (si se pide)</th></tr></thead>
        <tbody>${d.marcas.map((m, i) => `
          <tr data-i="${i}">
            <td><span class="mono">${esc(m.marca)}</span><div class="sb">${m.tipo === 'campo' ? 'Campo de combinación' : 'Texto entre corchetes'}${!m.guardada && m.sugerida === m.dato && !m.dato.startsWith('_') ? ' · sugerido' : ''}</div></td>
            <td><select data-fuente>${opcionesFuente(m.dato)}</select></td>
            <td><input data-etiqueta value="${esc(m.etiqueta || '')}" placeholder="Etiqueta que verá quien lo responda" ${['_tienda', '_ejecutivo'].includes(m.dato) ? '' : 'disabled'}></td>
          </tr>`).join('')}</tbody>
      </table></div>`,
    acciones: [{ texto: 'Cancelar' }, {
      texto: 'Guardar', clase: 'btn-g', alHacer: async (c) => {
        const mapa = {};
        c.querySelectorAll('tr[data-i]').forEach((tr) => {
          const m = d.marcas[Number(tr.dataset.i)];
          mapa[m.marca] = { dato: tr.querySelector('[data-fuente]').value, etiqueta: tr.querySelector('[data-etiqueta]').value.trim() || undefined };
        });
        await put(`/admin/plantillas/${id}/tienda`, {
          entrega: c.querySelector('[name=entrega]:checked').value,
          planes: [...c.querySelectorAll('[name=plan]:checked')].map((x) => x.value),
          mapa
        });
        toast('Documento de la tienda guardado.');
        recargar();
        cerrarModal();
      }
    }]
  });

  // La pregunta solo aplica a lo que responde el cliente o el personal
  cuerpo.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-fuente]');
    if (!sel) return;
    const input = sel.closest('tr').querySelector('[data-etiqueta]');
    input.disabled = !['_tienda', '_ejecutivo'].includes(sel.value);
    if (!input.disabled && !input.value) input.value = d.marcas[Number(sel.closest('tr').dataset.i)].marca.replace(/^\[|\]$/g, '');
  });
}
