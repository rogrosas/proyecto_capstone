/* CRM · Auditoría (registros_actividad) — solo administradores */
import { get } from '../api.js';
import { esc, fechaHora, filaVacia } from '../util.js';

const ACC = { INSERT: ['grn', 'Creó'], UPDATE: ['amb', 'Modificó'], DELETE: ['red', 'Eliminó'], LOGIN: ['blu', 'Ingresó'], LOGOUT: ['gry', 'Salió'] };
let contenedor = null;

async function cargar() {
  const tb = contenedor.querySelector('#tbAud');
  tb.innerHTML = filaVacia(6, 'Cargando…');
  const v = (id) => contenedor.querySelector(id).value;
  try {
    const { registros } = await get('/auditoria?' + new URLSearchParams({ q: v('#qAud'), accion: v('#fAudAccion'), dias: v('#fAudDias') }));
    tb.innerHTML = registros.length ? registros.map((r) => {
      const [bg, txt] = ACC[r.accion] || ['gry', r.accion];
      return `<tr><td class="mono">${fechaHora(r.fecha)}</td><td class="nm">${esc(r.usuario)}</td><td><span class="bg gry">${esc(r.rol)}</span></td>
        <td><span class="bg ${bg}">${txt}</span></td><td class="mono">${esc(r.tabla_afectada)}</td><td class="mono">${esc(r.registro_id || '—')}</td></tr>`;
    }).join('') : filaVacia(6, 'Sin registros en este período.');
  } catch (err) {
    if (err.message !== 'sesion') tb.innerHTML = filaVacia(6, err.message, true);
  }
}

export default {
  id: 'auditoria',
  titulo: 'Auditoría',
  sub: () => 'Registro de acciones por usuario',
  soloAdmin: true,
  async render(el) {
    contenedor = el;
    el.innerHTML = `
      <div class="sh"><p>Cada inserción, modificación y eliminación la registra la base de datos con su autor; la app agrega los ingresos y salidas. El registro no se puede modificar ni borrar.</p></div>
      <div class="toolbar">
        <input class="search" id="qAud" placeholder="Buscar por usuario, tabla o id de registro…">
        <select class="fl" id="fAudAccion"><option value="">Todas las acciones</option><option>INSERT</option><option>UPDATE</option><option>DELETE</option><option>LOGIN</option><option>LOGOUT</option></select>
        <select class="fl" id="fAudDias"><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option></select>
      </div>
      <div class="panel tbl-panel tbl-wrap"><table>
        <thead><tr><th>Fecha / hora</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Tabla</th><th>Registro</th></tr></thead>
        <tbody id="tbAud"></tbody>
      </table></div>`;
    let t;
    el.querySelector('#qAud').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 300); });
    el.querySelector('#fAudAccion').addEventListener('change', cargar);
    el.querySelector('#fAudDias').addEventListener('change', cargar);
    await cargar();
  }
};
