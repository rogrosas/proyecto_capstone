/* =========================================================
   CRM · Contrato imprimible desde v_datos_contrato y
   v_datos_contrato_servicios (reemplazan la combinación Excel → Word).
   ========================================================= */
import { esc, clp, CICLO } from './util.js';

const id = new URLSearchParams(location.search).get('id');
const raiz = document.getElementById('contrato');
const v = (x) => esc(x ?? '—');
const persona = (nombre, rut, nac, ec, prof) =>
  `<b>${v(nombre)}</b>${nac ? `, ${esc(nac)}` : ''}${ec ? `, ${esc(ec)}` : ''}${prof ? `, ${esc(prof)}` : ''}, cédula de identidad N° ${v(rut)}`;
const domicilio = (calle, comuna, region) => (calle ? `${esc(calle)}, comuna de ${v(comuna)}, ${v(region)}` : 'domicilio no registrado');

try {
  const res = await fetch(`/api/crm/contratos/${encodeURIComponent(id)}/impresion`, { credentials: 'same-origin' });
  const data = await res.json();
  if (!res.ok) throw new Error(res.status === 401 ? 'Su sesión expiró: ingrese al CRM y vuelva a abrir el contrato.' : data.error);
  const d = data.datos;
  document.title = `Contrato ${d.folio} · Easy Office`;
  document.getElementById('titulo').textContent = `Contrato ${d.folio} · ${d.cliente_razon_social}`;

  raiz.innerHTML = `
  <div class="hoja">
    <h1>CONTRATO DE PRESTACIÓN DE SERVICIOS</h1>
    <div class="folio">Folio ${v(d.folio)}</div>

    <p>En ${v(d.lugar_celebracion)}, a ${v(d.fecha_celebracion)}, comparecen: <b>${v(d.emisora_razon_social)}</b>, R.U.T. ${v(d.emisora_rut)},
    representada por ${persona(d.emisora_rep_nombre, d.emisora_rep_rut, d.emisora_rep_nacionalidad, d.emisora_rep_estado_civil, d.emisora_rep_profesion)},
    ambos domiciliados en ${domicilio(d.emisora_domicilio, d.emisora_comuna, d.emisora_region)}, teléfono ${v(d.emisora_telefono)}, correo ${v(d.emisora_email)},
    según personería de fecha ${v(d.emisora_personeria_fecha)}${d.emisora_personeria_fuente ? `, ${esc(d.emisora_personeria_fuente)}` : ''}, en adelante "EL PRESTADOR";
    y <b>${v(d.cliente_razon_social)}</b>, R.U.T. ${v(d.cliente_rut)}${d.cliente_giro ? `, giro ${esc(d.cliente_giro)}` : ''},
    ${d.cliente_rep_nombre ? `representada por <b>${esc(d.cliente_rep_nombre)}</b>, cédula de identidad N° ${v(d.cliente_rep_rut)}, domiciliado en ${domicilio(d.cliente_rep_domicilio, d.cliente_rep_comuna, d.cliente_rep_region)},` : ''}
    correo ${v(d.cliente_email)}, celular ${d.cliente_celular ? '+56 ' + esc(d.cliente_celular) : '—'}${d.cliente_fecha_escritura ? `, según escritura de fecha ${esc(d.cliente_fecha_escritura)}${d.cliente_sitio_notaria ? ` (${esc(d.cliente_sitio_notaria)})` : ''}` : ''},
    en adelante "EL CLIENTE"; quienes acuerdan lo siguiente:</p>

    <h2>PRIMERO: Objeto</h2>
    <p>EL PRESTADOR prestará a EL CLIENTE los servicios de: <b>${v(d.servicios)}</b>, en el inmueble ubicado en ${domicilio(d.sucursal_direccion, d.sucursal_comuna, d.sucursal_region)},
    rol de avalúo ${v(d.rol_propiedad)}, según el detalle del Anexo 1.</p>

    <h2>SEGUNDO: Vigencia</h2>
    <p>El presente contrato rige desde el ${v(d.fecha_inicio)} hasta el ${v(d.fecha_vencimiento)} ${v(d.duracion)}.</p>

    <h2>TERCERO: Precio</h2>
    <p>Los valores de los servicios son los indicados en la tabla siguiente. TODOS LOS VALORES MÁS I.V.A.</p>
    <table><thead><tr><th>Servicio</th><th>Ciclo</th><th class="r">Valor neto</th></tr></thead>
      <tbody>${data.servicios.map((s) => `<tr><td>${esc(s.servicio)}</td><td>${esc(CICLO[s.ciclo] || s.ciclo)}</td><td class="r">${clp(s.precio)}</td></tr>`).join('')}</tbody>
    </table>

    <h2>CUARTO: Forma de pago</h2>
    <p>EL CLIENTE pagará mediante ${v(d.medio_pago)}.</p>

    <h2>QUINTO: Renovación</h2>
    <p>Al término de su vigencia, el contrato podrá renovarse por un período igual, en las condiciones de precio vigentes a esa fecha.</p>

    <div class="firmas"><div>${v(d.emisora_rep_nombre)}<br>p.p. ${v(d.emisora_razon_social)}</div><div>${v(d.cliente_rep_nombre || d.cliente_razon_social)}<br>p.p. ${v(d.cliente_razon_social)}</div></div>

    <div class="salto"></div>
    <h1>ANEXO 1: DETALLE DE SERVICIOS</h1>
    <div class="folio">Folio ${v(d.folio)}</div>
    <table><thead><tr><th>#</th><th>Servicio</th><th>Contenido</th><th>Ciclo</th><th class="r">Valor neto</th></tr></thead>
      <tbody>${data.servicios.map((s) => `<tr><td>${s.orden}</td><td>${esc(s.servicio)}</td><td>${esc(s.contenido || '')}</td><td>${esc(CICLO[s.ciclo] || s.ciclo)}</td><td class="r">${clp(s.precio)}</td></tr>`).join('')}</tbody>
    </table>

    ${d.propietario_razon_social ? `
    <div class="salto"></div>
    <h1>AUTORIZACIÓN DE USO DE DOMICILIO</h1>
    <div class="folio">Folio ${v(d.folio)}</div>
    <p><b>${v(d.propietario_razon_social)}</b>, R.U.T. ${v(d.propietario_rut)}, representada por
    ${persona(d.propietario_rep_nombre, d.propietario_rep_rut, d.propietario_rep_nacionalidad, d.propietario_rep_estado_civil, d.propietario_rep_profesion)},
    domiciliada en ${domicilio(d.propietario_domicilio, d.propietario_comuna, d.propietario_region)}, propietaria del inmueble ubicado en
    ${domicilio(d.sucursal_direccion, d.sucursal_comuna, d.sucursal_region)}, rol ${v(d.rol_propiedad)}, autoriza a <b>${v(d.cliente_razon_social)}</b>,
    R.U.T. ${v(d.cliente_rut)}, a utilizarlo como domicilio tributario ante el Servicio de Impuestos Internos${d.unidad_sii ? `, unidad ${esc(d.unidad_sii)}` : ''},
    desde el ${v(d.fecha_inicio)} hasta el ${v(d.fecha_vencimiento)}.</p>
    <div class="firmas"><div>${v(d.propietario_rep_nombre)}<br>p.p. ${v(d.propietario_razon_social)}</div><div></div></div>` : ''}
  </div>`;
} catch (err) {
  document.getElementById('titulo').textContent = 'No se pudo cargar el contrato';
  raiz.innerHTML = `<div class="error">${esc(err.message)}</div>`;
}
