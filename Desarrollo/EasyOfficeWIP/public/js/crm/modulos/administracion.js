/* CRM · Administración (usuarios, roles, permisos, roles_permisos y catálogos) — solo administradores */
import { get, post, put, patch, del } from '../api.js';
import { esc, clp, fecha, filaVacia, toast } from '../util.js';
import { estado, opciones } from '../estado.js';
import { abrirModal, formularioHTML, leerFormulario, validar, confirmar } from '../modal.js';
import { direccionHTML, activarDirecciones, direccionLimpia } from '../direccion.js';

let contenedor = null;
let defs = null;
let seccion = 'usuarios';
const cacheRefs = {};

/* ---------- Usuarios ---------- */
async function verUsuarios(panel) {
  const { usuarios, roles } = await get('/admin/usuarios');
  panel.innerHTML = `
    <div class="toolbar"><h3 class="tt-sec">Usuarios del personal</h3><button class="btn btn-g" data-nuevo>Nuevo usuario</button></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Último ingreso</th><th>Estado</th><th></th></tr></thead>
      <tbody>${usuarios.map((u) => `<tr>
        <td class="nm">${esc(u.nombre)}${u.id === estado.usuario.id ? ' <span class="bg blu">usted</span>' : ''}</td>
        <td>${esc(u.email)}</td><td><span class="bg ${['admin', 'dueno'].includes(u.rol) ? 'grn' : 'gry'}">${esc(u.rol)}</span></td>
        <td>${fecha(u.ultimo_acceso)}</td><td>${u.activo ? '<span class="bg grn">Activo</span>' : '<span class="bg gry">Inactivo</span>'}</td>
        <td class="right"><button class="btn btn-o btn-row" data-editar="${u.id}">Editar</button></td></tr>`).join('')}</tbody>
    </table></div>
    <div class="note">Los roles "admin" y "dueno" trabajan como rol_admin en la base de datos (ven todo); los demás, como rol_ejecutivo (solo su cartera, sin eliminar).</div>`;
  const opRoles = roles.map((r) => ({ valor: r.id, texto: r.rol }));
  const form = (u) => abrirModal({
    titulo: u ? `Editar ${u.nombre}` : 'Nuevo usuario',
    contenido: formularioHTML([
      { nombre: 'nombre', etiqueta: 'Nombre', requerido: true, valor: u?.nombre },
      { nombre: 'email', etiqueta: 'Correo corporativo', tipo: 'email', requerido: true, valor: u?.email },
      { nombre: 'rol_id', etiqueta: 'Rol', tipo: 'select', requerido: true, valor: u?.rol_id, opciones: opRoles },
      { nombre: 'password', etiqueta: u ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña', requerido: !u, ayuda: 'Mínimo 10 caracteres. Se guarda solo como hash bcrypt.' },
      ...(u ? [{ nombre: 'activo', etiqueta: 'Usuario activo (puede ingresar)', tipo: 'bool', valor: u.activo }] : [])
    ]),
    acciones: [{ texto: 'Cancelar' }, {
      texto: 'Guardar', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        const d = leerFormulario(c);
        if (!d.password) delete d.password;
        if (u && u.id === estado.usuario.id) { delete d.activo; if (Number(d.rol_id) === u.rol_id) delete d.rol_id; }
        if (u) await patch('/admin/usuarios/' + u.id, d); else await post('/admin/usuarios', d);
        toast('Usuario guardado.');
        mostrar('usuarios');
      }
    }]
  });
  panel.querySelector('[data-nuevo]').addEventListener('click', () => form(null));
  panel.addEventListener('click', (e) => { const t = e.target.closest('[data-editar]'); if (t) form(usuarios.find((x) => x.id === Number(t.dataset.editar))); });
}

/* ---------- Roles y permisos ---------- */
async function verRoles(panel) {
  const { roles, permisos } = await get('/admin/roles');
  const nombrePermiso = Object.fromEntries(permisos.map((p) => [p.id, p.permiso]));
  panel.innerHTML = `
    <div class="toolbar"><h3 class="tt-sec">Roles y sus permisos</h3><button class="btn btn-g" data-nuevo>Nuevo rol</button></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Rol</th><th>Permisos asignados</th><th>Usuarios</th><th></th></tr></thead>
      <tbody>${roles.map((r) => `<tr>
        <td class="nm">${esc(r.rol)}</td>
        <td>${r.permisos.length ? r.permisos.map((p) => `<span class="bg gry">${esc(nombrePermiso[p])}</span>`).join(' ') : '<span class="sb">Sin permisos</span>'}</td>
        <td>${r.usuarios}</td>
        <td class="right acciones"><button class="btn btn-o btn-row" data-editar="${r.id}">Editar</button>
          <button class="btn btn-o btn-row" data-eliminar="${r.id}" ${r.usuarios ? 'disabled title="Tiene usuarios asignados"' : ''}>Eliminar</button></td></tr>`).join('')}</tbody>
    </table></div>
    <div class="note">Los permisos se administran en el catálogo "Permisos". La sesión de cada usuario carga los permisos de su rol.</div>`;
  const form = (r) => abrirModal({
    titulo: r ? `Rol ${r.rol}` : 'Nuevo rol',
    contenido: `${formularioHTML([{ nombre: 'rol', etiqueta: 'Nombre del rol', requerido: true, valor: r?.rol, ancho: 'full', ayuda: '"admin" y "dueno" son administradores para la base de datos.' }])}
      <h4 class="sub-h">Permisos</h4>
      <div class="checks">${permisos.map((p) => `<label class="chk"><input type="checkbox" data-permiso value="${p.id}" ${r?.permisos.includes(p.id) ? 'checked' : ''}> ${esc(p.permiso)}</label>`).join('') || '<div class="empty">No hay permisos definidos.</div>'}</div>`,
    acciones: [{ texto: 'Cancelar' }, {
      texto: 'Guardar', clase: 'btn-g', alHacer: async (c) => {
        validar(c);
        const d = { rol: leerFormulario(c).rol, permisos: [...c.querySelectorAll('[data-permiso]:checked')].map((x) => Number(x.value)) };
        if (r) await put('/admin/roles/' + r.id, d); else await post('/admin/roles', d);
        toast('Rol guardado.');
        mostrar('roles');
      }
    }]
  });
  panel.querySelector('[data-nuevo]').addEventListener('click', () => form(null));
  panel.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-editar]');
    if (ed) return form(roles.find((x) => x.id === Number(ed.dataset.editar)));
    const el = e.target.closest('[data-eliminar]');
    if (el && await confirmar('¿Eliminar este rol?', { textoSi: 'Eliminar', peligro: true })) {
      try { await del('/admin/roles/' + el.dataset.eliminar); toast('Rol eliminado.'); mostrar('roles'); } catch (err) { toast(err.message, true); }
    }
  });
}

/* ---------- Catálogos genéricos (definidos por la capa de negocio) ---------- */
async function referencias(nombre) {
  if (!cacheRefs[nombre]) cacheRefs[nombre] = (await get('/admin/catalogos/' + nombre)).registros;
  return cacheRefs[nombre];
}
const ETIQUETA = { servicios: 'nombre', empresas_emisoras: 'nombre_comercial', propietarios_inmueble: 'razon_social', representantes_legales: 'nombre_completo', regiones: 'nombre_region', comunas: 'nombre_comuna' };

function mostrarValor(campo, fila, refs) {
  const v = fila[campo.columna];
  if (campo.tipo === 'direccion') return esc(fila[campo.columna + '__dir']?.texto || '—');
  if (campo.tipo === 'bool') return v ? '<span class="bg grn">Sí</span>' : '<span class="bg gry">No</span>';
  if (campo.tipo === 'ref') { const r = (refs[campo.ref] || []).find((x) => x.id === v); return esc(r ? r[ETIQUETA[campo.ref]] : v ?? '—'); }
  if (campo.columna === 'precio_lista') return v === null ? 'Por cotizar' : clp(v);
  if (campo.tipo === 'fecha') return fecha(v);
  if (campo.tipo === 'archivo') return v ? `<a href="/api/crm/plantillas/${encodeURIComponent(fila.id)}/archivo" title="Descargar">${esc(v.split('/').pop())}</a>` : '<span class="sb">Sin archivo</span>';
  return esc(v ?? '—');
}

/* ---------- Archivos Word de la carpeta de contratos ---------- */
const tam = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
async function opcionesArchivo(actual) {
  const { archivos } = await get('/admin/archivos');
  const ops = archivos.map((a) => ({ valor: a.archivo, texto: `${a.archivo} · ${a.campos ? `${a.campos} campos` : 'sin campos de combinación'} · ${tam(a.bytes)}` }));
  if (actual && !archivos.some((a) => a.archivo === actual)) ops.unshift({ valor: actual, texto: `${actual} (no está en la carpeta)` });
  return ops;
}

// Bloque para subir un .docx a la carpeta (queda en plantillas/) y elegirlo en el selector
const subidaHTML = (columna) => `
  <div class="f full subida-word" data-subida="${esc(columna)}">
    <label>O subir un Word nuevo a la carpeta</label>
    <div class="fila-subida"><input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
      <label class="chk-f"><input type="checkbox" data-reemplazar> Reemplazar si ya existe</label>
      <button type="button" class="btn btn-o btn-row" data-subir>Subir</button></div>
    <span class="hint">Los campos de combinación (MERGEFIELD) del Word se llenan con los datos del contrato.</span>
  </div>`;

function activarSubidas(cuerpo) {
  cuerpo.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-subir]');
    if (!b) return;
    const caja = b.closest('[data-subida]');
    const archivo = caja.querySelector('input[type=file]').files[0];
    if (!archivo) return toast('Elija un archivo .docx.', true);
    b.disabled = true;
    try {
      const q = new URLSearchParams({ nombre: archivo.name, reemplazar: caja.querySelector('[data-reemplazar]').checked ? '1' : '0' });
      const res = await fetch('/api/crm/admin/archivos?' + q, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'No se pudo subir el archivo.');
      const sel = cuerpo.querySelector(`[name="${caja.dataset.subida}"]`);
      if (![...sel.options].some((o) => o.value === r.archivo)) sel.add(new Option(`${r.archivo} · ${r.campos} campos`, r.archivo));
      sel.value = r.archivo;
      toast(`Archivo subido: ${r.archivo} (${r.campos} campos de combinación).`);
    } catch (err) { toast(err.message, true); }
    finally { b.disabled = false; }
  });
}

async function verCatalogo(panel, nombre) {
  const def = defs[nombre];
  const { registros } = await get('/admin/catalogos/' + nombre);
  const refs = {};
  for (const c of def.campos.filter((x) => x.tipo === 'ref')) refs[c.ref] = await referencias(c.ref);
  const colsLista = def.lista.map((col) => def.campos.find((c) => c.columna === col));
  panel.innerHTML = `
    <div class="toolbar"><h3 class="tt-sec">${esc(def.titulo)}</h3><button class="btn btn-g" data-nuevo>Agregar</button></div>
    ${def.nota ? `<div class="note warn" style="margin:0 0 12px;">${esc(def.nota)}</div>` : ''}
    <div class="tbl-wrap"><table>
      <thead><tr>${colsLista.map((c) => `<th>${esc(c.etiqueta.split(' (')[0])}</th>`).join('')}<th></th></tr></thead>
      <tbody>${registros.length ? registros.map((f) => `<tr>${colsLista.map((c) => `<td>${mostrarValor(c, f, refs)}</td>`).join('')}
        <td class="right acciones"><button class="btn btn-o btn-row" data-editar="${esc(f[def.clave])}">Editar</button>
          <button class="ib dg" title="Eliminar" data-eliminar="${esc(f[def.clave])}">✕</button></td></tr>`).join('')
        : filaVacia(colsLista.length + 1, 'Sin registros.')}</tbody>
    </table></div>`;

  const op = await opciones();
  const form = async (fila) => {
    const campos = [];
    const bloquesDir = [];
    for (const c of def.campos) {
      const valor = fila ? fila[c.columna] : c.porDefecto;
      const base = { nombre: c.columna, etiqueta: c.etiqueta, requerido: c.requerido, valor };
      if (fila && c.columna === def.clave && !def.claveEditable) continue;
      if (c.tipo === 'direccion') { bloquesDir.push(direccionHTML(c.columna, fila?.[c.columna + '__dir'] || {}, op, { requerido: c.requerido, titulo: c.etiqueta })); continue; }
      if (c.tipo === 'opcion') campos.push({ ...base, tipo: 'select', opciones: c.opciones.map((o) => ({ valor: o, texto: o })) });
      else if (c.tipo === 'ref') campos.push({ ...base, tipo: 'select', opciones: (await referencias(c.ref)).map((r) => ({ valor: r.id, texto: r[ETIQUETA[c.ref]] })) });
      else if (c.tipo === 'rut') campos.push({ ...base, tipo: 'texto' });
      else if (c.tipo === 'archivo') {
        campos.push({ ...base, tipo: 'select', ancho: 'full', opciones: await opcionesArchivo(valor) });
        campos.push({ nombre: '_subida', tipo: 'html', ancho: 'full', html: subidaHTML(c.columna) });
      }
      else campos.push({ ...base, tipo: { numero: 'numero', fecha: 'fecha', bool: 'bool', textarea: 'textarea', json: 'json', email: 'email' }[c.tipo] || 'texto', min: c.min, ancho: ['textarea', 'json'].includes(c.tipo) ? 'full' : undefined });
    }
    const cuerpo = abrirModal({
      titulo: `${fila ? 'Editar' : 'Agregar'} · ${def.titulo}`, ancho: bloquesDir.length ? 'lg' : 'md',
      contenido: formularioHTML(campos) + (bloquesDir.length ? `<div class="grid2">${bloquesDir.join('')}</div>` : ''),
      acciones: [{ texto: 'Cancelar' }, {
        texto: 'Guardar', clase: 'btn-g', alHacer: async (c) => {
          validar(c);
          const d = leerFormulario(c);
          def.campos.filter((x) => x.tipo === 'direccion').forEach((x) => { d[x.columna] = direccionLimpia(d[x.columna]); });
          if (fila) await put(`/admin/catalogos/${nombre}/${encodeURIComponent(fila[def.clave])}`, d);
          else await post('/admin/catalogos/' + nombre, d);
          delete cacheRefs[nombre];
          await opciones(true);
          toast(`${def.titulo}: guardado.`);
          mostrar(nombre);
        }
      }]
    });
    activarDirecciones(cuerpo);
    activarSubidas(cuerpo);
  };
  panel.querySelector('[data-nuevo]').addEventListener('click', () => form(null));
  panel.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-editar]');
    if (ed) return form(registros.find((x) => String(x[def.clave]) === ed.dataset.editar));
    const el = e.target.closest('[data-eliminar]');
    if (el && await confirmar('¿Eliminar este registro? Solo es posible si nada lo usa.', { textoSi: 'Eliminar', peligro: true })) {
      try {
        await del(`/admin/catalogos/${nombre}/${encodeURIComponent(el.dataset.eliminar)}`);
        delete cacheRefs[nombre];
        await opciones(true);
        toast('Registro eliminado.');
        mostrar(nombre);
      } catch (err) { toast(err.message, true); }
    }
  });
}

/* ---------- Navegación interna ---------- */
async function mostrar(nombre) {
  seccion = nombre;
  contenedor.querySelectorAll('[data-sec]').forEach((b) => b.classList.toggle('on', b.dataset.sec === nombre));
  const panel = contenedor.querySelector('#admPanel');
  const nuevo = panel.cloneNode(false); // descarta listeners anteriores
  panel.replaceWith(nuevo);
  nuevo.innerHTML = '<div class="empty">Cargando…</div>';
  try {
    if (nombre === 'usuarios') await verUsuarios(nuevo);
    else if (nombre === 'roles') await verRoles(nuevo);
    else await verCatalogo(nuevo, nombre);
  } catch (err) {
    if (err.message !== 'sesion') nuevo.innerHTML = `<div class="empty err">${esc(err.message)}</div>`;
  }
}

export default {
  id: 'administracion',
  titulo: 'Administración',
  sub: () => 'Usuarios, roles, permisos y catálogos',
  soloAdmin: true,
  async render(el) {
    contenedor = el;
    defs = await get('/admin/catalogos');
    const grupos = {};
    Object.entries(defs).forEach(([k, d]) => { (grupos[d.grupo] ||= []).push([k, d.titulo]); });
    el.innerHTML = `
      <div class="adm">
        <aside class="adm-menu">
          <div class="adm-g">Acceso</div>
          <button data-sec="usuarios">Usuarios</button>
          <button data-sec="roles">Roles y permisos</button>
          ${Object.entries(grupos).map(([g, items]) => `<div class="adm-g">${esc(g)}</div>${items.map(([k, t]) => `<button data-sec="${k}">${esc(t)}</button>`).join('')}`).join('')}
        </aside>
        <div class="panel" id="admPanel"></div>
      </div>`;
    el.querySelector('.adm-menu').addEventListener('click', (e) => { const b = e.target.closest('[data-sec]'); if (b) mostrar(b.dataset.sec); });
    await mostrar(seccion);
  }
};
