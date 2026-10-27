/* =========================================================
   /mi-cuenta · portal del cliente con correo y contraseña.
   1. Sin sesión: se elige empresa o persona.
      Empresa: RUT + correo vinculado + contraseña. Persona: correo + contraseña.
      → POST /api/cliente/ingresar.
   2. Sin contraseña (o si la olvidó): POST /api/cliente/clave envía un enlace al correo.
      El enlace abre /mi-cuenta?clave=<token> → se define la contraseña con
      POST /api/cliente/clave/definir (inicia la sesión) y se quita el token de la URL.
   3. Con sesión: GET /api/cliente/panel y se dibujan las pestañas.
   4. Documentos: el cliente revisa un borrador con marca de agua (iframe de
      /api/cliente/documentos/<id>/borrador), marca "estoy de acuerdo" y lo acepta
      para descargar el Word final; si no está de acuerdo, envía un ticket.
   ========================================================= */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clp = (n) => (n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('es-CL'));
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fecha = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MESES[m - 1]} ${y}`; };
  const iniciales = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const PASARELA = { transbank: 'Webpay Plus', mercado_pago: 'Mercado Pago', transferencia: 'Transferencia' };
  const CICLO = { UNICO: 'pago único', MENSUAL: 'mensual', TRIMESTRAL: 'trimestral', SEMESTRAL: 'semestral', ANUAL: 'anual' };
  const DOC = {
    borrador: ['gry', 'En preparación'], en_revision: ['blu', 'En revisión'], aprobado: ['blu', 'Aprobado'],
    enviado_firma: ['amb', 'Esperando firma'], firmado: ['grn', 'Firmado'], rechazado: ['red', 'Rechazado'], anulado: ['gry', 'Anulado']
  };
  const PAGO = { pendiente: ['amb', 'Pendiente'], pagado: ['grn', 'Pagado'], rechazado: ['red', 'Rechazado'], reembolsado: ['gry', 'Reembolsado'] };
  const badge = (mapa, v) => { const [c, t] = mapa[v] || ['gry', v]; return `<span class="bg ${c}">${esc(t)}</span>`; };

  async function api(ruta, datos) {
    const r = await fetch('/api/cliente' + ruta, {
      method: datos === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: datos === undefined ? undefined : JSON.stringify(datos)
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || 'Error inesperado.'), { status: r.status });
    return d;
  }

  /* ---------- acceso ---------- */
  // modo: 'ingresar' (con contraseña) o 'clave' (pedir el enlace para crearla o recuperarla)
  const acceso = { tipo: null, modo: 'ingresar' };
  const TEXTOS = {
    empresa: {
      titulo: 'Ingreso empresa',
      ingresar: 'Ingrese el RUT de la empresa y el correo con que Easy Office lo tiene registrado como representante legal o persona autorizada.',
      clave: 'Le enviaremos un enlace para crear o recuperar su contraseña. Debe ser el correo del representante legal o de una persona autorizada por la empresa.',
      hint: 'Su correo personal vinculado a la empresa.'
    },
    persona: {
      titulo: 'Ingreso persona',
      ingresar: 'Ingrese el correo con que contrató sus servicios en Easy Office.',
      clave: 'Le enviaremos un enlace para crear o recuperar su contraseña al correo con que contrató.',
      hint: 'El mismo correo con el que contrató.'
    }
  };

  function aviso(id, texto) { $(id).hidden = !texto; $(id).textContent = texto || ''; }

  function verPaso(id) {
    $('gate').hidden = false;
    $('tabs').hidden = true;
    $('panelWrap').hidden = true;
    $('userbox').hidden = true;
    $('userboxOut').hidden = false;
    ['pasoTipo', 'accesoForm', 'claveForm'].forEach((p) => { $(p).hidden = p !== id; });
  }

  function mostrarAcceso({ ok, error } = {}) {
    verPaso('pasoTipo');
    aviso('tipoOk', ok); aviso('tipoError', error);
  }

  function mostrarFormulario(tipo, modo, { ok, error } = {}) {
    Object.assign(acceso, { tipo, modo });
    const t = TEXTOS[tipo], clave = modo === 'clave';
    verPaso('accesoForm');
    $('accesoTitulo').textContent = clave ? 'Crear o recuperar contraseña' : t.titulo;
    $('accesoTexto').textContent = t[modo];
    $('fRut').hidden = tipo !== 'empresa';
    $('cMailLbl').textContent = tipo === 'empresa' ? 'Su correo' : 'Correo electrónico';
    $('cMailHint').textContent = t.hint;
    $('fClave').hidden = clave;
    $('btnAcceso').textContent = clave ? 'Enviarme el enlace' : 'Ingresar';
    $('accesoPie').innerHTML = clave
      ? '¿Ya tiene contraseña? <a class="link" data-modo="ingresar">Ingresar</a>.'
      : '¿Olvidó su contraseña o aún no la tiene? <a class="link" data-modo="clave">Crear o recuperar contraseña</a>.'
        + (tipo === 'empresa' ? '<br>Si su correo no está vinculado a la empresa, pida a su ejecutivo que lo autorice.' : '')
        + '<br>Si cambió de correo, escríbanos a info@easyoffice.cl.';
    aviso('accesoOk', ok); aviso('accesoError', error);
    $('cPw').value = '';
    (tipo === 'empresa' && !$('cRut').value ? $('cRut') : $('cMail')).focus();
  }

  $('accesoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { tipo, modo } = acceso;
    const datos = { tipo, email: $('cMail').value.trim() };
    if (tipo === 'empresa') datos.rut = $('cRut').value.trim();
    if (modo === 'ingresar') datos.password = $('cPw').value;
    const falta = (tipo === 'empresa' && !datos.rut) ? 'Ingrese el RUT de la empresa.'
      : !datos.email ? 'Ingrese su correo.'
      : (modo === 'ingresar' && !datos.password) ? 'Ingrese su contraseña.' : null;
    if (falta) return aviso('accesoError', falta);

    const btn = $('btnAcceso'), texto = btn.textContent;
    btn.disabled = true; btn.textContent = modo === 'clave' ? 'Enviando…' : 'Ingresando…';
    aviso('accesoOk'); aviso('accesoError');
    try {
      if (modo === 'clave') {
        const r = await api('/clave', datos);
        mostrarFormulario(tipo, 'ingresar', { ok: r.mensaje });
      } else {
        const { cliente } = await api('/ingresar', datos);
        mostrarPanel(cliente);
      }
    } catch (err) {
      aviso('accesoError', err.message);
    } finally {
      btn.disabled = false; btn.textContent = texto;
    }
  });

  // Enlace del correo: /mi-cuenta?clave=<token>
  let tokenClave = null;
  $('claveForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('nPw').value, pw2 = $('nPw2').value;
    if (pw.length < 8) return aviso('claveError', 'La contraseña debe tener al menos 8 caracteres.');
    if (pw !== pw2) return aviso('claveError', 'Las contraseñas no coinciden.');
    const btn = $('btnClave');
    btn.disabled = true; btn.textContent = 'Guardando…';
    aviso('claveError');
    try {
      const { cliente } = await api('/clave/definir', { token: tokenClave, password: pw });
      tokenClave = null;
      mostrarPanel(cliente);
    } catch (err) {
      if (err.status === 401) mostrarAcceso({ error: err.message });
      else aviso('claveError', err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar e ingresar';
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tipo],[data-modo],[data-volver],[data-pw]');
    if (!t) return;
    if (t.dataset.pw) {
      const el = $(t.dataset.pw);
      el.type = el.type === 'password' ? 'text' : 'password';
      t.textContent = el.type === 'password' ? 'Mostrar' : 'Ocultar';
    } else if (t.dataset.tipo) mostrarFormulario(t.dataset.tipo, 'ingresar');
    else if (t.dataset.modo) mostrarFormulario(acceso.tipo, t.dataset.modo);
    else mostrarAcceso();
  });

  /* ---------- panel ---------- */
  function setTab(id) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + id));
  }

  function resumen(p) {
    // Igual que el CRM: un contrato vencido que ya tiene un contrato posterior se considera renovado
    const abiertos = p.contratos.filter((k) => ['activo', 'pendiente'].includes(k.estado));
    const renovado = (k) => k.dias < 0 && abiertos.some((k2) => k2 !== k && k2.vence > k.vence);
    const tarjetasK = abiertos.filter((k) => !renovado(k));
    const vigentes = abiertos.filter((k) => k.dias >= 0);
    const porVencer = tarjetasK.filter((k) => k.dias !== null && k.dias <= 30).sort((a, b) => a.dias - b.dias);
    const saldoTotal = p.contratos.reduce((s, k) => s + Math.max(0, k.saldo || 0), 0);
    const tramite = p.documentos.find((d) => !['firmado', 'anulado', 'rechazado'].includes(d.estado));
    const PASOS = ['borrador', 'en_revision', 'aprobado', 'enviado_firma', 'firmado'];
    const TXT = { borrador: 'Documento en preparación', en_revision: 'Revisión de un ejecutivo', aprobado: 'Aprobado para firma', enviado_firma: 'Su firma electrónica', firmado: 'Documento firmado' };

    const aviso = porVencer.length ? `
      <div class="alert ${porVencer[0].dias < 0 ? 'bad' : ''}">
        <div class="ai">!</div>
        <div>
          <div class="at">${porVencer[0].dias < 0 ? 'Su servicio venció' : 'Su servicio vence pronto'}: ${esc(porVencer[0].servicios.map((s) => s.nombre).join(', '))}</div>
          <div class="ad">Contrato ${esc(porVencer[0].folio)} · ${porVencer[0].dias < 0 ? `venció el ${fecha(porVencer[0].vence)}` : `vence el ${fecha(porVencer[0].vence)} (${porVencer[0].dias === 0 ? 'hoy' : `en ${porVencer[0].dias} día${porVencer[0].dias === 1 ? '' : 's'}`})`}.
          Para renovar, contacte a su ejecutivo${porVencer[0].ejecutivo ? ` (${esc(porVencer[0].ejecutivo)})` : ''} o escríbanos a info@easyoffice.cl.</div>
        </div>
      </div>` : '';

    const tarjetas = tarjetasK.length ? tarjetasK.map((k) => {
      const total = Math.max(1, (new Date(k.vence) - new Date(k.inicio)) / 864e5);
      const pasado = Math.min(100, Math.max(0, Math.round((total - Math.max(0, k.dias)) / total * 100)));
      const nivel = k.dias <= 7 ? 'low' : k.dias <= 30 ? 'mid' : '';
      return `
        <div class="svc">
          <div class="svc-h"><span class="t">${esc(k.servicios[0]?.nombre || 'Servicio')}${k.servicios.length > 1 ? ` +${k.servicios.length - 1}` : ''}</span>
            ${k.dias < 0 ? '<span class="bg red">Vencido</span>' : k.dias <= 30 ? '<span class="bg amb">Por vencer</span>' : k.estado === 'pendiente' ? '<span class="bg blu">Pendiente</span>' : '<span class="bg grn">Activo</span>'}</div>
          <div class="svc-b">
            <div class="kv"><span class="k">Contrato</span><span class="v mono">${esc(k.folio)}</span></div>
            <div class="kv"><span class="k">Servicios</span><span class="v">${esc(k.servicios.map((s) => s.nombre).join(' · '))}</span></div>
            <div class="kv"><span class="k">Sucursal</span><span class="v">${esc(k.sucursal)}</span></div>
            <div class="kv"><span class="k">Vigente hasta</span><span class="v" ${k.dias <= 30 ? 'style="color:var(--amber)"' : ''}>${fecha(k.vence)}</span></div>
            <div class="kv"><span class="k">Saldo por pagar</span><span class="v">${k.saldo > 0 ? `<span style="color:var(--red)">${clp(k.saldo)}</span> + IVA` : 'Al día'}</span></div>
            <div class="prog"><i class="${nivel}" style="width:${pasado}%"></i></div>
            <div class="prog-l"><span>Desde ${fecha(k.inicio)}</span><span>${k.dias < 0 ? `venció hace ${-k.dias} día${k.dias === -1 ? '' : 's'}` : `${k.dias} día${k.dias === 1 ? '' : 's'} restantes`}</span></div>
          </div>
        </div>`;
    }).join('') : '<div class="panel"><div class="empty">No tiene servicios vigentes. <a class="link" href="/contratar">Contrate en línea</a>.</div></div>';

    const pasos = tramite ? PASOS.map((s, i) => {
      const actual = PASOS.indexOf(tramite.estado);
      const cls = i < actual ? 'done' : i === actual ? 'now' : '';
      return `<div class="st ${cls}"><div class="sd">${i < actual ? '✓' : i === actual ? '…' : i + 1}</div><div><div class="t">${TXT[s]}</div></div><div class="r">${i < actual ? 'Listo' : i === actual ? 'En curso' : 'Pendiente'}</div></div>`;
    }).join('') : '';

    $('v-resumen').innerHTML = `
      ${aviso}
      <div class="sh"><h2>Mis servicios</h2><p>Lo que tiene contratado con Easy Office, con su vigencia real.</p></div>
      <div class="g3 mb20">${tarjetas}</div>
      <div class="g2">
        <div class="panel">
          <h3>Trámite en curso</h3>
          ${tramite ? `<div class="ph">${esc(tramite.tipo)}${tramite.folio ? ' · contrato ' + esc(tramite.folio) : ''}</div><div class="steps">${pasos}</div>`
            : '<div class="ph">No tiene trámites en curso.</div>'}
        </div>
        <div class="panel">
          <h3>Estado de cuenta</h3>
          <div class="ph">Valores netos de sus contratos; los montos se facturan más IVA.</div>
          <div class="kv"><span class="k">Contratos vigentes</span><span class="v">${vigentes.length}</span></div>
          <div class="kv"><span class="k">Saldo pendiente</span><span class="v" ${saldoTotal > 0 ? 'style="color:var(--red)"' : ''}>${saldoTotal > 0 ? clp(saldoTotal) : 'Al día'}</span></div>
          <div class="kv"><span class="k">Último pago</span><span class="v">${p.pagos.find((x) => x.estado === 'pagado') ? `${clp(p.pagos.find((x) => x.estado === 'pagado').monto)} · ${fecha(p.pagos.find((x) => x.estado === 'pagado').fecha)}` : '—'}</span></div>
          <button class="btn btn-o btn-w" style="margin-top:14px;" data-tab="pagos">Ver todos los pagos</button>
        </div>
      </div>`;
  }

  /* ---------- documentos: borrador con marca de agua → aceptar o enviar un ticket ---------- */
  const REVISION = {
    por_revisar: ['amb', 'Por revisar'], aceptado: ['grn', 'Aceptado'], objetado: ['red', 'Ticket enviado']
  };
  const TICKET = { abierto: ['amb', 'Recibido'], en_proceso: ['blu', 'En proceso'], resuelto: ['grn', 'Respondido'], cerrado: ['gry', 'Cerrado'] };
  let motivos = {};

  function accionDoc(d) {
    if (d.estado_cliente === 'por_revisar') return `<button class="btn btn-g btn-row" data-revisar="${d.id}">Revisar borrador</button>`;
    if (d.estado_cliente === 'aceptado') return `<a class="btn btn-o btn-row" href="/api/cliente/documentos/${d.id}/archivo" download>Descargar Word</a>`;
    if (d.estado_cliente === 'objetado') return `<button class="btn btn-o btn-row" data-revisar="${d.id}">Ver borrador</button>`;
    return '<span class="sb">En preparación</span>';
  }

  async function documentos(p) {
    const porRevisar = p.documentos.filter((d) => d.estado_cliente === 'por_revisar');
    const firma = p.documentos.filter((d) => d.estado === 'enviado_firma').length;
    const n = porRevisar.length + firma;
    $('bDocs').hidden = !n; $('bDocs').textContent = n;
    let tickets = [];
    try { ({ tickets, motivos } = await api('/tickets')); } catch { /* sin tickets */ }
    $('v-documentos').innerHTML = `
      <div class="sh"><h2>Mis documentos</h2><p>Antes de recibir cada documento, usted revisa un borrador con marca de agua y confirma que está de acuerdo. Si algo no está correcto, envíenos un ticket y lo corregimos.</p></div>
      ${porRevisar.map((d) => `<div class="alert"><div class="ai">!</div><div><div class="at">Tiene un documento para revisar: ${esc(d.tipo)}</div>
        <div class="ad">${d.folio ? `Contrato ${esc(d.folio)} · ` : ''}publicado el ${fecha(d.publicado)}. Revise el borrador y acéptelo para recibir el documento final.</div></div>
        <div class="aa"><button class="btn btn-g" data-revisar="${d.id}">Revisar ahora</button></div></div>`).join('')}
      ${firma ? `<div class="alert ok"><div class="ai">✎</div><div><div class="at">Tiene ${firma} documento${firma > 1 ? 's' : ''} esperando su firma</div><div class="ad">Le llegará el enlace de firma electrónica a su correo.</div></div></div>` : ''}
      <div class="panel tbl-wrap" style="padding:10px 22px;"><table>
        <thead><tr><th>Documento</th><th>Contrato</th><th>Emitido</th><th>Su revisión</th><th>Estado</th><th>Código</th><th></th></tr></thead>
        <tbody>${p.documentos.length ? p.documentos.map((d) => `<tr>
          <td class="nm">${esc(d.tipo)}</td><td class="mono">${esc(d.folio || '—')}</td><td>${fecha(d.generado)}</td>
          <td>${d.estado_cliente ? badge(REVISION, d.estado_cliente) + (d.aceptado ? `<div class="sb">${fecha(d.aceptado)}</div>` : '') : '<span class="sb">—</span>'}</td>
          <td>${badge(DOC, d.estado)}${d.firmado ? `<div class="sb">${fecha(d.firmado)}</div>` : ''}</td>
          <td class="mono">${esc(d.codigo || '—')}</td><td class="right">${accionDoc(d)}</td></tr>`).join('')
          : '<tr><td colspan="7" class="empty">Aún no tiene documentos.</td></tr>'}</tbody>
      </table></div>
      <div class="sh" style="margin-top:26px;display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;">
        <div><h2 style="font-size:18px;">Mis tickets</h2><p>Reclamos sobre documentos y consultas a la administración.</p></div>
        <button class="btn btn-o" data-ticket-nuevo>Enviar una consulta</button>
      </div>
      ${tickets.length ? tickets.map((t) => `
        <div class="panel tk">
          <div class="tk-h"><b>#${t.id} · ${esc(motivos[t.motivo] || t.motivo)}</b> ${badge(TICKET, t.estado)}<span class="sb">${fecha(t.creado_en)}${t.documento ? ` · ${esc(t.documento)}` : ''}</span></div>
          <div class="tk-d">${esc(t.detalle)}</div>
          ${t.respuesta ? `<div class="tk-r"><b>Respuesta de Easy Office:</b>\n${esc(t.respuesta)}</div>` : ''}
        </div>`).join('') : '<div class="panel"><div class="empty">No ha enviado tickets.</div></div>'}`;
  }

  // Formulario de ticket (sobre un documento o una consulta general)
  function formTicket(doc) {
    return `
      <div class="gf"><label for="tkMotivo">Motivo</label>
        <select id="tkMotivo">${Object.entries(motivos).filter(([k]) => doc || k === 'otro' || k === 'falta_informacion')
          .map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></div>
      <div class="gf"><label for="tkDetalle">Cuéntenos qué hay que corregir</label>
        <textarea id="tkDetalle" rows="4" maxlength="4000" placeholder="${doc ? 'Ej: el giro de la empresa es otro, falta el segundo apellido…' : 'Escriba su consulta'}"></textarea></div>
      <div class="aviso-error" id="tkError" hidden></div>`;
  }

  function cerrarRevision() { $('revision').hidden = true; $('revision').innerHTML = ''; document.body.classList.remove('con-revision'); }

  async function abrirRevision(id) {
    const doc = documentosPanel.find((d) => d.id === Number(id));
    if (!doc) return;
    const editable = doc.estado_cliente === 'por_revisar';
    const r = $('revision');
    r.hidden = false;
    document.body.classList.add('con-revision');
    r.innerHTML = `
      <div class="rv">
        <div class="rv-h">
          <div><div class="rv-t">${esc(doc.tipo)}${doc.folio ? ` · ${esc(doc.folio)}` : ''}</div>
            <div class="sb">${editable ? 'Borrador para su revisión: tiene marca de agua y no tiene validez hasta que usted lo acepte.' : 'Envió un ticket sobre este documento: le avisaremos cuando esté corregido.'}</div></div>
          <button class="rv-x" data-cerrar-rev aria-label="Cerrar">✕</button>
        </div>
        <iframe class="rv-doc" src="/api/cliente/documentos/${doc.id}/borrador" title="Borrador del documento"></iframe>
        <div class="rv-f" id="rvPie">${editable ? `
          <label class="chk rv-chk"><input type="checkbox" id="rvAcepto"> He leído el borrador completo y estoy de acuerdo con su contenido.</label>
          <div class="aviso-error" id="rvError" hidden></div>
          <div class="rv-acc">
            <button class="btn btn-o" data-objetar>No estoy de acuerdo</button>
            <button class="btn btn-g" data-aceptar disabled>Aceptar y recibir el documento</button>
          </div>` : '<div class="rv-acc"><button class="btn btn-o" data-cerrar-rev>Cerrar</button></div>'}
        </div>
      </div>`;
    if (!editable) return;
    $('rvAcepto').addEventListener('change', (e) => { r.querySelector('[data-aceptar]').disabled = !e.target.checked; });
    r.querySelector('[data-aceptar]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await api(`/documentos/${doc.id}/aceptar`, { acepto: $('rvAcepto').checked });
        $('rvPie').innerHTML = `<div class="aviso-ok">Gracias. Aceptó el documento y ya puede descargarlo. Le avisaremos cuando esté listo para la firma electrónica.</div>
          <div class="rv-acc"><a class="btn btn-g" href="/api/cliente/documentos/${doc.id}/archivo" download>Descargar documento final (Word)</a></div>`;
        recargarPanel();
      } catch (err) {
        $('rvError').hidden = false; $('rvError').textContent = err.message;
        e.target.disabled = false;
      }
    });
    r.querySelector('[data-objetar]').addEventListener('click', () => {
      $('rvPie').innerHTML = `${formTicket(doc)}
        <div class="rv-acc"><button class="btn btn-o" data-volver-rev>Volver</button><button class="btn btn-g" data-enviar-ticket>Enviar ticket</button></div>`;
      $('rvPie').querySelector('[data-volver-rev]').addEventListener('click', () => abrirRevision(doc.id));
      $('rvPie').querySelector('[data-enviar-ticket]').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          const t = await api(`/documentos/${doc.id}/ticket`, { motivo: $('tkMotivo').value, detalle: $('tkDetalle').value.trim() });
          $('rvPie').innerHTML = `<div class="aviso-ok">${esc(t.mensaje)}</div><div class="rv-acc"><button class="btn btn-o" data-cerrar-rev>Cerrar</button></div>`;
          recargarPanel();
        } catch (err) {
          $('tkError').hidden = false; $('tkError').textContent = err.message;
          e.target.disabled = false;
        }
      });
    });
  }

  function consultaGeneral() {
    const r = $('revision');
    r.hidden = false;
    document.body.classList.add('con-revision');
    r.innerHTML = `<div class="rv rv-chica"><div class="rv-h"><div class="rv-t">Enviar una consulta</div><button class="rv-x" data-cerrar-rev aria-label="Cerrar">✕</button></div>
      <div class="rv-f" id="rvPie">${formTicket(null)}<div class="rv-acc"><button class="btn btn-g" data-enviar-consulta>Enviar</button></div></div></div>`;
    r.querySelector('[data-enviar-consulta]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const t = await api('/tickets', { motivo: $('tkMotivo').value, detalle: $('tkDetalle').value.trim() });
        $('rvPie').innerHTML = `<div class="aviso-ok">${esc(t.mensaje)}</div><div class="rv-acc"><button class="btn btn-o" data-cerrar-rev>Cerrar</button></div>`;
        recargarPanel();
      } catch (err) {
        $('tkError').hidden = false; $('tkError').textContent = err.message;
        e.target.disabled = false;
      }
    });
  }

  function pagos(p) {
    $('v-pagos').innerHTML = `
      <div class="sh"><h2>Pagos</h2><p>Historial de pagos registrados en su cuenta.</p></div>
      <div class="panel tbl-wrap" style="padding:10px 22px;"><table>
        <thead><tr><th>Fecha</th><th>Contrato</th><th>Monto</th><th>Medio</th><th>Cuota</th><th>Estado</th></tr></thead>
        <tbody>${p.pagos.length ? p.pagos.map((x) => `<tr>
          <td>${fecha(x.fecha)}</td><td class="mono">${esc(x.referencia)}</td><td class="money">${clp(x.monto)}</td>
          <td>${esc(PASARELA[x.pasarela] || x.pasarela || '—')}</td><td>${x.cuota} de ${x.total_cuotas}</td><td>${badge(PAGO, x.estado)}</td></tr>`).join('')
          : '<tr><td colspan="6" class="empty">Aún no hay pagos registrados.</td></tr>'}</tbody>
      </table></div>
      <h3 class="sub-t">Detalle por contrato</h3>
      <div class="g2e">${p.contratos.map((k) => `
        <div class="panel">
          <h3>Contrato ${esc(k.folio)}</h3>
          <div class="ph">${fecha(k.inicio)} → ${fecha(k.vence)} · ${esc(k.emisora)}</div>
          ${k.servicios.map((s) => `<div class="kv"><span class="k">${esc(s.nombre)} <span class="sb">(${esc(CICLO[s.ciclo] || s.ciclo)})</span></span><span class="v">${clp(s.precio)}</span></div>`).join('')}
          <div class="kv"><span class="k"><b>Total neto</b></span><span class="v">${clp(k.total)}</span></div>
          <div class="kv"><span class="k">Pagado</span><span class="v">${clp(k.pagado)}</span></div>
          <div class="kv"><span class="k">Saldo</span><span class="v" ${k.saldo > 0 ? 'style="color:var(--red)"' : ''}>${clp(k.saldo)}</span></div>
        </div>`).join('')}</div>`;
  }

  function datos(p) {
    const c = p.cliente, r = p.representante;
    $('v-datos').innerHTML = `
      <div class="sh"><h2>Mis datos</h2><p>Para corregir algún dato, escríbanos a info@easyoffice.cl o contacte a su ejecutivo.</p></div>
      <div class="g2e">
        <div class="panel"><h3>${esc(c.razon_social)}</h3>
          <div class="kv"><span class="k">RUT</span><span class="v mono">${esc(c.rut)}</span></div>
          <div class="kv"><span class="k">Nombre de fantasía</span><span class="v">${esc(c.nombre_fantasia || '—')}</span></div>
          <div class="kv"><span class="k">Giro</span><span class="v">${esc(c.giro || '—')}</span></div>
          <div class="kv"><span class="k">Correo</span><span class="v">${esc(c.email || '—')}</span></div>
          <div class="kv"><span class="k">Celular</span><span class="v">${c.celular ? '+56 ' + esc(c.celular) : '—'}</span></div>
          <div class="kv"><span class="k">Cliente desde</span><span class="v">${fecha(c.desde)}</span></div>
        </div>
        <div class="panel"><h3>Representante legal</h3>
          ${r ? `<div class="kv"><span class="k">Nombre</span><span class="v">${esc(r.nombre)}</span></div>
            <div class="kv"><span class="k">RUT</span><span class="v mono">${esc(r.rut)}</span></div>
            <div class="kv"><span class="k">Domicilio</span><span class="v">${esc(r.domicilio || '—')}</span></div>` : '<div class="empty">Sin representante registrado.</div>'}
        </div>
      </div>`;
  }

  let documentosPanel = [];
  async function recargarPanel() {
    const p = await api('/panel');
    documentosPanel = p.documentos;
    resumen(p); await documentos(p); pagos(p); datos(p);
  }

  async function mostrarPanel(cliente) {
    $('gate').hidden = true;
    $('tabs').hidden = false;
    $('panelWrap').hidden = false;
    $('userbox').hidden = false;
    $('userboxOut').hidden = true;
    $('cuAvatar').textContent = iniciales(cliente.razon_social);
    $('cuNombre').textContent = cliente.razon_social;
    $('cuDetalle').textContent = `RUT ${cliente.rut} · ${cliente.email}`;
    $('v-resumen').innerHTML = '<div class="panel"><div class="empty">Cargando su cuenta…</div></div>';
    setTab('resumen');
    try {
      await recargarPanel();
    } catch (err) {
      if (err.status === 401) return mostrarAcceso({ error: 'Su sesión expiró. Ingrese nuevamente.' });
      $('v-resumen').innerHTML = `<div class="panel"><div class="empty" style="color:var(--red)">${esc(err.message)}</div></div>`;
    }
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab],[data-action="logout"],[data-revisar],[data-cerrar-rev],[data-ticket-nuevo]');
    if (!t) return;
    if (t.dataset.revisar) return abrirRevision(t.dataset.revisar);
    if ('cerrarRev' in t.dataset) return cerrarRevision();
    if ('ticketNuevo' in t.dataset) return consultaGeneral();
    if (t.dataset.tab) return setTab(t.dataset.tab);
    await api('/salir', {}).catch(() => {});
    mostrarAcceso({ ok: 'Cerró su sesión.' });
  });

  /* ---------- inicio ---------- */
  (async () => {
    const token = new URLSearchParams(location.search).get('clave');
    if (token) {
      history.replaceState(null, '', '/mi-cuenta'); // el token no queda en el historial
      tokenClave = token;
      verPaso('claveForm');
      return $('nPw').focus();
    }
    try {
      const { cliente } = await api('/yo');
      mostrarPanel(cliente);
    } catch {
      mostrarAcceso();
    }
  })();
})();
