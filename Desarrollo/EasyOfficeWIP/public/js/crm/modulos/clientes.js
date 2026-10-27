/* CRM · Clientes (clientes, representantes_legales, direcciones) */
import { get, post, put, del } from '../api.js';
import { esc, clp, fecha, fechaHora, filaVacia, badge, toast } from '../util.js';
import { estado, opciones } from '../estado.js';
import { abrirModal, cerrarModal, formularioHTML, leerFormulario, validar, confirmar } from '../modal.js';
import { direccionHTML, activarDirecciones, direccionLimpia } from '../direccion.js';
import { abrirContrato, nuevoContrato } from './contratos.js';
import { abrirDocumento, nuevoDocumento } from './documentos.js';

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
        <td>${c.vence ? fecha(c.vence) : '—'}${c.folio ? `<div class="sb mono">${esc(c.folio)}</div>` : ''}</td>
        <td>${badge('cliente', c.estado)}</td>
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
    <h4 class="sub-h">Acceso al portal de clientes
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
  const cuerpo = abrirModal({
    titulo: c.razon_social, ancho: 'lg',
    contenido: `
      <div class="ficha-acciones">
        <button class="btn btn-o btn-s" data-acc="editar">Editar datos</button>
        <button class="btn btn-g btn-s" data-acc="contrato">Nuevo contrato</button>
        <button class="btn btn-o btn-s" data-acc="documento">Nuevo documento</button>
        ${estado.usuario.admin ? '<button class="btn btn-peligro btn-s" data-acc="eliminar">Eliminar</button>' : ''}
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
          <div class="kv"><span class="k">Registrado por</span><span class="v">${esc(c.registrado_por)} · ${fecha(c.creado_en)}</span></div>
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
      <h4 class="sub-h">Contratos</h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Folio</th><th>Servicios</th><th>Vigencia</th><th>Total neto</th><th>Saldo</th><th>Estado</th></tr></thead>
        <tbody>${f.contratos.length ? f.contratos.map((k) => `
          <tr class="clic" data-contrato="${k.id}"><td class="mono">${esc(k.folio)}</td><td>${esc(k.servicios || '—')}</td>
            <td>${fecha(k.inicio)} → ${fecha(k.vence)}</td><td class="money">${clp(k.total_servicios)}</td>
            <td class="money">${k.saldo > 0 ? `<span class="rojo">${clp(k.saldo)}</span>` : clp(k.saldo)}</td><td>${badge('contrato', k.estado)}</td></tr>`).join('')
          : filaVacia(6, 'Sin contratos.')}</tbody>
      </table></div>
      <h4 class="sub-h">Documentos</h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Documento</th><th>Folio</th><th>Generado</th><th>Estado</th><th>Código</th></tr></thead>
        <tbody>${f.documentos.length ? f.documentos.map((d) => `
          <tr class="clic" data-documento="${d.id}"><td class="nm">${esc(d.tipo)}</td><td class="mono">${esc(d.folio || '—')}</td>
            <td>${fecha(d.generado)}</td><td>${badge('documento', d.estado)}</td><td class="mono">${esc(d.codigo_verificacion || '—')}</td></tr>`).join('')
          : filaVacia(5, 'Sin documentos.')}</tbody>
      </table></div>
      <h4 class="sub-h">Pagos</h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Fecha</th><th>Referencia</th><th>Monto</th><th>Cuota</th><th>Estado</th></tr></thead>
        <tbody>${f.pagos.length ? f.pagos.map((p) => `
          <tr><td>${fechaHora(p.fecha)}</td><td class="mono">${esc(p.referencia)}</td><td class="money">${clp(p.monto)}</td>
            <td>${p.cuota} de ${p.total_cuotas}</td><td>${badge('pago', p.estado)}</td></tr>`).join('')
          : filaVacia(5, 'Sin pagos.')}</tbody>
      </table></div>`
  });

  cuerpo.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-acc],[data-contrato],[data-documento],[data-acceso]');
    if (!t) return;
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
        </select>
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
    el.querySelector('#tbClientes').addEventListener('click', (e) => {
      const fila = e.target.closest('[data-cliente]');
      if (fila) abrirFicha(fila.dataset.cliente).catch((err) => toast(err.message, true));
    });
    await cargar();
  }
};
