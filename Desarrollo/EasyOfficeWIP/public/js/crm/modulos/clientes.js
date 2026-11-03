/* CRM · Clientes (clientes, representantes_legales, direcciones) */
import { get, post, put, del, exportar } from '../api.js';
import { esc, clp, fecha, fechaHora, filaVacia, badge, toast, hoyISO } from '../util.js';
import { estado, opciones, tomarFiltros } from '../estado.js';
import { abrirModal, cerrarModal, formularioHTML, leerFormulario, validar, confirmar } from '../modal.js';
import { direccionHTML, activarDirecciones, direccionLimpia } from '../direccion.js';
import { abrirContrato, nuevoContrato } from './contratos.js';
import { abrirDocumento, nuevoDocumento, revisarDocumento } from './documentos.js';

let contenedor = null;

async function cargar() {
  const tb = contenedor.querySelector('#tbClientes');
  tb.innerHTML = filaVacia(7, 'Cargando…');
  const p = new URLSearchParams({ q: contenedor.querySelector('#qClientes').value, estado: contenedor.querySelector('#fEstado').value });
  try {
    const { clientes } = await get('/clientes?' + p);
    tb.innerHTML = clientes.length ? clientes.map((c) => `
      <tr class="clic" data-cliente="${c.id}">
        <td><div class="nm">${esc(c.razon_social)}</div><div class="sb">${esc(c.nombre_fantasia || c.email || '')}</div></td>
        <td class="mono">${esc(c.rut_fmt)}</td>
        <td>${esc(c.servicios || '—')}</td>
        <td>${esc(c.ejecutivo || '—')}</td>
        <td>${c.vence ? fecha(c.vence) : '—'}${c.folio ? `<div class="sb"><button class="lnk mono" data-contrato="${c.contrato_id}" title="Abrir el contrato">${esc(c.folio)}</button></div>` : ''}</td>
        <td>${badge('cliente', c.estado)}${c.docs_por_revisar ? `<div style="margin-top:4px;"><span class="bg amb" title="Documentos pendientes de revisión">${c.docs_por_revisar} por revisar</span></div>` : ''}</td>
        <td class="right"><button class="btn btn-o btn-row" data-cliente="${c.id}">Ficha</button></td>
      </tr>`).join('') : filaVacia(7, 'No hay clientes que coincidan.');
    contenedor.querySelector('#ntClientes').textContent = estado.usuario.admin
      ? `${clientes.length} cliente(s) de todos los ejecutivos.`
      : `${clientes.length} cliente(s) de su cartera: los que registró y los de sus contratos o documentos.`;
  } catch (err) {
    if (err.message !== 'sesion') tb.innerHTML = filaVacia(7, err.message, true);
  }
}

/* ---------- Acceso al portal (/mi-cuenta) ---------- */
const VINCULO = { titular: 'Titular', representante: 'Representante legal', autorizado: 'Autorizada' };

function accesosHTML(c, accesos) {
  const empresa = c.tipo_persona === 'juridica';
  const sinTitular = empresa
    ? 'El representante legal no tiene correo: agréguelo en "Editar datos" para que pueda ingresar.'
    : 'El cliente no tiene correo: agréguelo en "Editar datos" para que pueda ingresar.';
  const filas = accesos.map((a) => `
    <tr>
      <td><div class="nm">${esc(a.nombre || '—')}</div><div class="sb">${esc(a.email)}</div></td>
      <td>${VINCULO[a.vinculo]}</td>
      <td>${!a.activo ? '<span class="bg red">Bloqueado</span>'
        : a.con_clave ? `<span class="bg grn">Con contraseña</span>${a.ultimo_ingreso ? `<div class="sb">Último ingreso ${fechaHora(a.ultimo_ingreso)}</div>` : ''}`
        : '<span class="bg gry">Sin contraseña</span>'}</td>
      <td class="right">
        <button class="btn btn-o btn-row" data-acceso="${esc(a.email)}" data-activo="${a.activo ? 'false' : 'true'}">${a.activo ? 'Bloquear' : 'Permitir'}</button>
        ${a.vinculo === 'autorizado' ? `<button class="btn btn-o btn-row" data-acceso="${esc(a.email)}" data-quitar>Quitar</button>` : ''}
      </td>
    </tr>`).join('');
  return `
    <h4 class="sub-h" id="sec-portal">Acceso al portal de clientes
      <span class="hint">(${empresa ? 'RUT de la empresa + correo + contraseña' : 'correo + contraseña'})</span></h4>
    ${empresa ? '<div class="ficha-acciones"><button class="btn btn-o btn-s" data-acc="autorizar">Autorizar persona</button></div>' : ''}
    <div class="tbl-wrap"><table>
      <thead><tr><th>Persona</th><th>Vínculo</th><th>Estado</th><th></th></tr></thead>
      <tbody>${filas || ''}${accesos.some((a) => a.vinculo !== 'autorizado') ? '' : `<tr><td colspan="4" class="empty">${sinTitular}</td></tr>`}</tbody>
    </table></div>`;
}

function autorizarPersona(c) {
  abrirModal({
    titulo: `Autorizar persona · ${c.razon_social}`,
    contenido: `
      <p class="hint" style="margin-top:0;">Podrá ingresar a /mi-cuenta con el RUT de la empresa (${esc(c.rut_fmt)}), su correo y una contraseña que ella misma crea con "Crear o recuperar contraseña".</p>
      ${formularioHTML([
        { nombre: 'nombre', etiqueta: 'Nombre completo', requerido: true },
        { nombre: 'email', etiqueta: 'Correo', tipo: 'email', requerido: true }
      ])}`,
    acciones: [
      { texto: 'Cancelar', alHacer: async () => abrirFicha(c.id) },
      {
        texto: 'Autorizar', clase: 'btn-g',
        alHacer: async (cuerpoEl) => {
          validar(cuerpoEl);
          await put(`/clientes/${c.id}/accesos`, { ...leerFormulario(cuerpoEl), autorizado: true, activo: true });
          toast('Persona autorizada para el portal.');
          abrirFicha(c.id);
        }
      }
    ]
  });
}

/* ---------- Ficha ---------- */
export async function abrirFicha(id) {
  const f = await get('/clientes/' + id);
  const c = f.cliente, r = f.representante;
  const pendientes = f.documentos.filter((d) => d.por_revisar);
  const vigentes = f.contratos.filter((k) => ['activo', 'pendiente'].includes(k.estado));
  const saldo = f.contratos.reduce((s, k) => s + Math.max(0, Number(k.saldo) || 0), 0);
  const proxima = f.gestiones.map((g) => g.proxima).filter((p) => p && p >= hoyISO()).sort()[0];
  const cuerpo = abrirModal({
    titulo: c.razon_social, ancho: 'lg',
    contenido: `
      <div class="ficha-acciones">
        <button class="btn btn-o btn-s" data-acc="editar">Editar datos</button>
        <button class="btn btn-g btn-s" data-acc="contrato">Nuevo contrato</button>
        <button class="btn btn-o btn-s" data-acc="documento">Nuevo documento</button>
        ${estado.usuario.admin ? '<button class="btn btn-peligro btn-s" data-acc="eliminar">Eliminar</button>' : ''}
      </div>
      ${pendientes.length ? `<div class="pend-rev">
        <div class="pr-t">${pendientes.length === 1 ? 'Hay un documento pendiente de revisión' : `Hay ${pendientes.length} documentos pendientes de revisión`}</div>
        ${pendientes.map((d) => `<div class="pr-i"><div><b>${esc(d.tipo)}</b><span class="sb"> · ${esc(d.folio || 'DOC-' + d.id)} · generado ${fecha(d.generado)}</span></div>
          <button class="btn btn-g btn-row" data-revisar="${d.id}">Ver y aprobar</button></div>`).join('')}
      </div>` : ''}
      <div class="resumen-ficha">
        <button class="rs" data-ir-sec="contratos" title="Ir a sus contratos"><span class="v">${vigentes.length}</span><span class="l">contrato(s) vigente(s) de ${f.contratos.length}</span></button>
        <button class="rs" data-ir-sec="documentos" title="Ir a sus documentos"><span class="v">${f.documentos.length}</span><span class="l">documento(s)${pendientes.length ? ` · ${pendientes.length} por revisar` : ''}</span></button>
        <button class="rs" data-ir-sec="pagos" title="Ir a sus pagos"><span class="v">${clp(saldo)}</span><span class="l">saldo por cobrar · ${f.pagos.length} pago(s)</span></button>
        <button class="rs" data-ir-sec="portal" title="Ir al acceso al portal"><span class="v">${(f.accesos || []).filter((a) => a.con_clave && a.activo).length}</span><span class="l">persona(s) con acceso a Mi cuenta</span></button>
        <button class="rs" data-ir-sec="gestiones" title="Ir a la bitácora de gestiones"><span class="v">${f.gestiones.length}</span><span class="l">gestión(es)${proxima ? ` · próxima ${fecha(proxima)}` : ''}</span></button>
        ${f.firmas ? `<div class="rs" title="Bolsas y planes con firmas incluidas"><span class="v">${f.firmas.disponibles}</span><span class="l">firma(s) disponible(s) de ${f.firmas.compradas}${f.firmas.vence ? ` · vencen ${fecha(f.firmas.vence)}` : ''}</span></div>` : ''}
      </div>
      <div class="g2e">
        <div class="panel plano">
          <h3>Datos del cliente</h3>
          <div class="kv"><span class="k">Tipo</span><span class="v">${c.tipo_persona === 'juridica' ? 'Empresa' : 'Persona natural'}</span></div>
          <div class="kv"><span class="k">RUT</span><span class="v mono">${esc(c.rut_fmt)}</span></div>
          <div class="kv"><span class="k">Nombre de fantasía</span><span class="v">${esc(c.nombre_fantasia || '—')}</span></div>
          <div class="kv"><span class="k">Giro</span><span class="v">${esc(c.giro_principal || '—')}</span></div>
          <div class="kv"><span class="k">Correo</span><span class="v">${esc(c.email || '—')}</span></div>
          <div class="kv"><span class="k">Celular</span><span class="v">${c.celular ? '+56 ' + esc(c.celular) : '—'}</span></div>
          <div class="kv"><span class="k">Escritura</span><span class="v">${fecha(c.fecha_escritura)}${c.sitio_notaria ? ' · ' + esc(c.sitio_notaria) : ''}</span></div>
          <div class="kv"><span class="k">Registrado por</span><span class="v">${esc(c.registrado_por || 'Tienda en línea')} · ${fecha(c.creado_en)}</span></div>
        </div>
        <div class="panel plano">
          <h3>Representante legal</h3>
          ${r ? `
            <div class="kv"><span class="k">Nombre</span><span class="v">${esc(r.nombre_completo)}</span></div>
            <div class="kv"><span class="k">RUT</span><span class="v mono">${esc(r.rut_fmt)}</span></div>
            <div class="kv"><span class="k">Correo</span><span class="v">${esc(r.email || '—')}</span></div>
            <div class="kv"><span class="k">Nacionalidad · estado civil</span><span class="v">${esc([r.nacionalidad, r.estado_civil].filter(Boolean).join(' · ') || '—')}</span></div>
            <div class="kv"><span class="k">Profesión</span><span class="v">${esc(r.profesion || '—')}</span></div>
            <div class="kv"><span class="k">Domicilio</span><span class="v">${esc(r.direccion ? `${r.direccion.texto}, ${r.direccion.region}` : '—')}</span></div>`
            : '<div class="empty">Sin representante registrado.</div>'}
        </div>
      </div>
      ${accesosHTML(c, f.accesos || [])}
      <h4 class="sub-h" id="sec-contratos">Contratos</h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Folio</th><th>Servicios</th><th>Vigencia</th><th>Total neto</th><th>Saldo</th><th>Estado</th></tr></thead>
        <tbody>${f.contratos.length ? f.contratos.map((k) => `
          <tr class="clic" data-contrato="${k.id}"><td class="mono">${esc(k.folio)}</td><td>${esc(k.servicios || '—')}</td>
            <td>${fecha(k.inicio)} → ${fecha(k.vence)}</td><td class="money">${clp(k.total_servicios)}</td>
            <td class="money">${k.saldo > 0 ? `<span class="rojo">${clp(k.saldo)}</span>` : clp(k.saldo)}</td><td>${badge('contrato', k.estado)}</td></tr>`).join('')
          : filaVacia(6, 'Sin contratos.')}</tbody>
      </table></div>
      <h4 class="sub-h" id="sec-documentos">Documentos</h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Documento</th><th>Folio</th><th>Generado</th><th>Estado</th><th>Cliente</th><th>Código</th><th></th></tr></thead>
        <tbody>${f.documentos.length ? f.documentos.map((d) => `
          <tr class="clic" data-documento="${d.id}"><td class="nm">${esc(d.tipo)}</td><td class="mono">${esc(d.folio || '—')}</td>
            <td>${fecha(d.generado)}</td><td>${badge('documento', d.estado)}</td>
            <td>${d.por_revisar ? '<span class="bg amb">Por revisar</span>' : d.estado_cliente ? badge('cliente_doc', d.estado_cliente) : '<span class="sb">—</span>'}</td>
            <td class="mono">${esc(d.codigo_verificacion || '—')}</td>
            <td class="right">${d.por_revisar ? `<button class="btn btn-g btn-row" data-revisar="${d.id}">Ver y aprobar</button>` : ''}</td></tr>`).join('')
          : filaVacia(7, 'Sin documentos.')}</tbody>
      </table></div>
      <h4 class="sub-h" id="sec-pagos">Pagos</h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Fecha</th><th>Referencia</th><th>Monto</th><th>Cuota</th><th>Estado</th></tr></thead>
        <tbody>${f.pagos.length ? f.pagos.map((p) => `
          <tr class="clic" ${p.contrato_id ? `data-contrato="${p.contrato_id}"` : `data-documento="${p.documento_id}"`} title="Abrir el ${p.contrato_id ? 'contrato' : 'documento'}"><td>${fechaHora(p.fecha)}</td><td class="mono">${esc(p.referencia)}</td><td class="money">${clp(p.monto)}</td>
            <td>${p.cuota} de ${p.total_cuotas}</td><td>${badge('pago', p.estado)}</td></tr>`).join('')
          : filaVacia(5, 'Sin pagos.')}</tbody>
      </table></div>
      <h4 class="sub-h" id="sec-gestiones">Bitácora de gestiones <button class="btn btn-o btn-row" data-acc="gestion">Registrar gestión</button></h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Fecha</th><th>Gestión</th><th>Resultado</th><th>Nota</th><th>Próxima acción</th></tr></thead>
        <tbody>${f.gestiones.length ? f.gestiones.map((g) => `
          <tr><td>${fechaHora(g.fecha)}<div class="sb">${esc(g.usuario)}</div></td>
            <td>${TIPO_GESTION[g.tipo] || esc(g.tipo)}${g.folio ? `<div class="sb mono">${esc(g.folio)}</div>` : ''}</td>
            <td>${g.resultado ? `<span class="bg ${RESULTADO_GESTION[g.resultado][0]}">${RESULTADO_GESTION[g.resultado][1]}</span>` : '<span class="sb">—</span>'}</td>
            <td style="white-space:pre-wrap;max-width:340px;">${esc(g.nota || '')}</td>
            <td>${g.proxima ? `${fecha(g.proxima)}${g.proxima < hoyISO() ? ' <span class="bg red">Atrasada</span>' : ''}` : '<span class="sb">—</span>'}</td></tr>`).join('')
          : filaVacia(5, 'Sin gestiones registradas. Anote aquí llamadas, correos, reuniones y acuerdos con el cliente.')}</tbody>
      </table></div>`
  });

  cuerpo.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-acc],[data-contrato],[data-documento],[data-acceso],[data-revisar],[data-ir-sec]');
    if (!t) return;
    if (t.dataset.irSec) return cuerpo.querySelector('#sec-' + t.dataset.irSec)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (t.dataset.revisar) return revisarDocumento(t.dataset.revisar, () => abrirFicha(id)).catch((err) => toast(err.message, true));
    if (t.dataset.acceso) {
      const quitar = t.dataset.quitar !== undefined;
      const datos = quitar ? { email: t.dataset.acceso, autorizado: false } : { email: t.dataset.acceso, activo: t.dataset.activo === 'true' };
      if (quitar && !(await confirmar(`¿Quitar la autorización de ${t.dataset.acceso}? Ya no podrá ingresar al portal por esta empresa.`, { textoSi: 'Quitar', peligro: true }))) return abrirFicha(id);
      try {
        await put(`/clientes/${id}/accesos`, datos);
        toast(quitar ? 'Autorización quitada.' : datos.activo ? 'Acceso al portal permitido.' : 'Acceso al portal bloqueado.');
      } catch (err) {
        toast(err.message, true);
      }
      return abrirFicha(id);
    }
    if (t.dataset.acc === 'autorizar') return autorizarPersona(c);
    if (t.dataset.acc === 'gestion') return registrarGestion(c, f.contratos);
    if (t.dataset.contrato) return abrirContrato(t.dataset.contrato);
    if (t.dataset.documento) return abrirDocumento(t.dataset.documento);
    if (t.dataset.acc === 'editar') return formularioCliente(f);
    if (t.dataset.acc === 'contrato') return nuevoContrato({ cliente_id: c.id });
    if (t.dataset.acc === 'documento') return nuevoDocumento({ cliente_id: c.id });
    if (t.dataset.acc === 'eliminar') {
      if (!(await confirmar(`¿Eliminar a "${c.razon_social}"? Solo es posible si no tiene contratos, documentos ni pagos.`, { textoSi: 'Eliminar', peligro: true }))) return abrirFicha(id);
      try {
        await del('/clientes/' + id);
        toast('Cliente eliminado. Quedó registrado en auditoría.');
        cerrarModal();
        if (contenedor) cargar();
      } catch (err) {
        toast(err.message, true);
        abrirFicha(id);
      }
    }
  });
}

/* ---------- Bitácora de gestiones ---------- */
const TIPO_GESTION = { llamada: 'Llamada', correo: 'Correo', whatsapp: 'WhatsApp', reunion: 'Reunión', link_pago: 'Link de pago', nota: 'Nota' };
const RESULTADO_GESTION = {
  contactado: ['grn', 'Contactado'], sin_respuesta: ['gry', 'Sin respuesta'], promete_pago: ['blu', 'Promete pagar'],
  renueva: ['grn', 'Renueva'], no_renueva: ['red', 'No renueva'], otro: ['gry', 'Otro']
};

function registrarGestion(c, contratos) {
  abrirModal({
    titulo: `Registrar gestión · ${c.razon_social}`,
    contenido: formularioHTML([
      { nombre: 'tipo', etiqueta: 'Gestión', tipo: 'select', requerido: true, valor: 'llamada', opciones: Object.entries(TIPO_GESTION).map(([valor, texto]) => ({ valor, texto })) },
      { nombre: 'resultado', etiqueta: 'Resultado', tipo: 'select', opciones: [{ valor: '', texto: '—' }, ...Object.entries(RESULTADO_GESTION).map(([valor, [, texto]]) => ({ valor, texto }))] },
      { nombre: 'contrato_id', etiqueta: 'Contrato (opcional)', tipo: 'select', opciones: [{ valor: '', texto: '—' }, ...contratos.map((k) => ({ valor: k.id, texto: `${k.folio} · ${k.servicios || ''}` }))] },
      { nombre: 'proxima_accion_en', etiqueta: 'Próxima acción', tipo: 'fecha' },
      { nombre: 'nota', etiqueta: 'Nota', tipo: 'textarea', ancho: 'full', placeholder: 'Qué se conversó, acuerdos, compromisos…' }
    ]),
    acciones: [{ texto: 'Cancelar' }, {
      texto: 'Guardar', clase: 'btn-g', alHacer: async (cont) => {
        validar(cont);
        await post(`/clientes/${c.id}/gestiones`, leerFormulario(cont));
        toast('Gestión registrada.');
        abrirFicha(c.id);
      }
    }]
  });
}

/* ---------- Formulario de alta / edición ---------- */
export async function formularioCliente(ficha = null) {
  const op = await opciones();
  const c = ficha?.cliente || {};
  const r = ficha?.representante || {};
  const cuerpo = abrirModal({
    titulo: ficha ? `Editar ${c.razon_social}` : 'Nuevo cliente', ancho: 'lg',
    contenido: `
      <h4 class="sub-h">Cliente</h4>
      ${formularioHTML([
        { nombre: 'rut', etiqueta: 'RUT', valor: c.rut_fmt, requerido: true, placeholder: '76.123.456-7' },
        { nombre: 'razon_social', etiqueta: 'Razón social', valor: c.razon_social, requerido: true },
        { nombre: 'nombre_fantasia', etiqueta: 'Nombre de fantasía', valor: c.nombre_fantasia },
        { nombre: 'giro_principal', etiqueta: 'Giro principal', valor: c.giro_principal },
        { nombre: 'email', etiqueta: 'Correo', tipo: 'email', valor: c.email, ayuda: 'Si es persona natural, con este correo ingresa al portal' },
        { nombre: 'celular', etiqueta: 'Celular', valor: c.celular, placeholder: '9 1234 5678', ayuda: '9 dígitos, empieza con 9' },
        { nombre: 'fecha_escritura', etiqueta: 'Fecha de escritura', tipo: 'fecha', valor: c.fecha_escritura },
        { nombre: 'sitio_notaria', etiqueta: 'Sitio web o notaría', valor: c.sitio_notaria }
      ])}
      <h4 class="sub-h">Representante legal <span class="hint">(opcional; si el RUT ya existe, se actualizan sus datos)</span></h4>
      ${formularioHTML([
        { nombre: 'representante.rut', etiqueta: 'RUT', valor: r.rut_fmt },
        { nombre: 'representante.nombre_completo', etiqueta: 'Nombre completo', valor: r.nombre_completo },
        { nombre: 'representante.email', etiqueta: 'Correo', tipo: 'email', valor: r.email, ayuda: 'Con este correo ingresa al portal por la empresa' },
        { nombre: 'representante.nacionalidad', etiqueta: 'Nacionalidad', valor: r.nacionalidad },
        { nombre: 'representante.estado_civil', etiqueta: 'Estado civil', valor: r.estado_civil },
        { nombre: 'representante.profesion', etiqueta: 'Profesión', valor: r.profesion }
      ])}
      <div class="grid2">${direccionHTML('representante.direccion', r.direccion || {}, op, { titulo: 'Domicilio del representante' })}</div>`,
    acciones: [
      { texto: 'Cancelar' },
      {
        texto: ficha ? 'Guardar cambios' : 'Crear cliente', clase: 'btn-g',
        alHacer: async (cuerpoEl) => {
          validar(cuerpoEl);
          const datos = leerFormulario(cuerpoEl);
          if (datos.representante) datos.representante.direccion = direccionLimpia(datos.representante.direccion);
          const res = ficha ? await put('/clientes/' + c.id, datos) : await post('/clientes', datos);
          toast(ficha ? 'Cliente actualizado.' : 'Cliente creado.');
          if (contenedor) cargar();
          abrirFicha(res.id);
        }
      }
    ]
  });
  activarDirecciones(cuerpo);
}

export default {
  id: 'clientes',
  titulo: 'Clientes',
  sub: () => 'Ficha única por RUT, con su representante legal',
  cnt: 'clientes', verde: true,
  async render(el) {
    contenedor = el;
    el.innerHTML = `
      <div class="toolbar">
        <input class="search" id="qClientes" placeholder="Buscar por nombre, RUT (con o sin puntos) o folio…">
        <select class="fl" id="fEstado">
          <option value="">Todos los estados</option>
          <option>Activo</option><option>Por vencer</option><option>Vencido</option><option>Pendiente</option><option>Sin contrato</option>
          <option value="Por revisar">Con documentos por revisar</option>
        </select>
        <button class="btn btn-o" data-exportar title="Descargar este listado como CSV para Excel">Exportar a Excel</button>
        <button class="btn btn-g" id="btnNuevoCliente">Nuevo cliente</button>
      </div>
      <div class="panel tbl-panel tbl-wrap"><table>
        <thead><tr><th>Cliente</th><th>RUT</th><th>Servicios vigentes</th><th>Ejecutivo</th><th>Vigencia</th><th>Estado</th><th></th></tr></thead>
        <tbody id="tbClientes"></tbody>
      </table></div>
      <div class="note" id="ntClientes"></div>`;
    let t;
    el.querySelector('#qClientes').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 300); });
    el.querySelector('#fEstado').addEventListener('change', cargar);
    el.querySelector('#btnNuevoCliente').addEventListener('click', () => formularioCliente());
    el.querySelector('[data-exportar]').addEventListener('click', () => exportar('clientes', { q: el.querySelector('#qClientes').value, estado: el.querySelector('#fEstado').value })
      .catch((err) => { if (err.message !== 'sesion') toast(err.message, true); }));
    const fl = tomarFiltros('clientes');
    if (fl?.estado) el.querySelector('#fEstado').value = fl.estado;
    el.querySelector('#tbClientes').addEventListener('click', (e) => {
      const k = e.target.closest('[data-contrato]');
      if (k) { e.stopPropagation(); return abrirContrato(k.dataset.contrato).catch((err) => toast(err.message, true)); }
      const fila = e.target.closest('[data-cliente]');
      if (fila) abrirFicha(fila.dataset.cliente).catch((err) => toast(err.message, true));
    });
    await cargar();
  }
};
