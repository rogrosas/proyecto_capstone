/* =========================================================
   CRM · bloque de formulario para una dirección
   (direcciones: calle, número, complemento, comuna; la región
   solo filtra las comunas y no se envía).
   ========================================================= */
import { esc } from './util.js';

export function direccionHTML(prefijo, valor = {}, { regiones = [], comunas = [] }, { requerido = false, titulo = 'Dirección' } = {}) {
  const comunaSel = comunas.find((c) => c.id === Number(valor.comuna_id));
  const regionSel = comunaSel ? comunaSel.region_id : '';
  const req = requerido ? 'required' : '';
  return `
    <fieldset class="dir full" data-dir>
      <legend>${esc(titulo)}${requerido ? ' *' : ''}</legend>
      <div class="grid2">
        <div class="f"><label>Calle</label><input name="${prefijo}.calle" value="${esc(valor.calle || '')}" ${req}></div>
        <div class="f"><label>Número</label><input name="${prefijo}.numero" value="${esc(valor.numero || '')}" ${req} placeholder="1234 o S/N"></div>
        <div class="f"><label>Complemento</label><input name="${prefijo}.complemento" value="${esc(valor.complemento || '')}" placeholder="Oficina, depto."></div>
        <div class="f" data-ignorar><label>Región</label>
          <select data-region><option value="">Todas</option>${regiones.map((r) => `<option value="${r.id}" ${r.id === regionSel ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select></div>
        <div class="f"><label>Comuna</label>
          <select name="${prefijo}.comuna_id" data-comuna ${req}><option value="">Seleccione…</option>
            ${comunas.map((c) => `<option value="${c.id}" data-region="${c.region_id}" ${c.id === Number(valor.comuna_id) ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
          </select></div>
      </div>
    </fieldset>`;
}

// Filtra las comunas al elegir región (llamar después de insertar el HTML)
export function activarDirecciones(contenedor) {
  contenedor.querySelectorAll('[data-dir]').forEach((fs) => {
    const reg = fs.querySelector('[data-region]');
    const com = fs.querySelector('[data-comuna]');
    const filtrar = () => {
      [...com.options].forEach((o) => { if (o.value) o.hidden = !!reg.value && o.dataset.region !== reg.value; });
      if (com.selectedOptions[0]?.hidden) com.value = '';
    };
    reg.addEventListener('change', filtrar);
    filtrar();
  });
}

// Una dirección sin calle se envía como null
export const direccionLimpia = (d) => (d && d.calle ? d : null);
