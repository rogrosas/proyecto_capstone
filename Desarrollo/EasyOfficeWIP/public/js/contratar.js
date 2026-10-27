/* =========================================================
   /contratar · flujo de 4 etapas: Servicio → Datos → Pago → Documento
   Requiere catalogo.js. Acepta ?plan=<id> para preseleccionar un plan.
   Etapa 2 pide los datos del titular (y de la empresa) más lo que piden
   los documentos del plan (GET /api/tienda/planes/<id>/preguntas).
   «Pagar» registra la compra (POST /api/tienda/compras): cliente,
   contrato, pago pendiente (el cobro es de demostración) y documentos.
   ========================================================= */
(function () {
  const CAT = window.CATALOGO;
  const STEPS = ['Servicio', 'Datos', 'Pago', 'Documento'];

  const $ = (id) => document.getElementById(id);
  const clp = (n) => '$' + n.toLocaleString('es-CL');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    fam: CAT[0].id,
    sel: null,
    payMode: 'total',
    payPM: 'tbk',
    preguntas: [],
    resultado: null
  };

  async function api(metodo, ruta, datos) {
    const r = await fetch(ruta, {
      method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: datos === undefined ? undefined : JSON.stringify(datos)
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || 'No pudimos completar la operación. Intente de nuevo.'), { status: r.status });
    return d;
  }

  function aviso(id, texto) { $(id).hidden = !texto; $(id).textContent = texto || ''; }

  /* ---------- Etapa 1: catálogo ---------- */
  function renderTabs() {
    $('famtabs').innerHTML = CAT.map((f) =>
      `<button class="fam ${f.id === state.fam ? 'on' : ''}" role="tab" data-fam="${f.id}">${f.tab}</button>`
    ).join('');
  }

  function precio(p) {
    return p.price === null ? (p.priceTxt || 'A convenir') : clp(p.price);
  }

  function renderPlans() {
    const fam = CAT.find((f) => f.id === state.fam);
    $('plans').innerHTML = fam.plans.map((p) => {
      const sel = state.sel && state.sel.id === p.id;
      const cta = sel ? 'Seleccionado' : (p.price === null ? 'Agendar asesoría' : 'Contratar aquí');
      return `
        <div class="plan ${sel ? 'sel' : ''}" data-plan="${p.id}" tabindex="0">
          <div class="plan-head">${p.name}</div>
          ${p.price === null ? '<div class="ribbon">requiere cotización</div>' : ''}
          <div class="plan-price">${precio(p)}</div>
          <div class="plan-per">${p.per}</div>
          <ul>${p.feats.map((f) => `<li>${f}</li>`).join('')}</ul>
          <div class="plan-foot"><button class="plan-cta" type="button">${cta}</button></div>
        </div>`;
    }).join('');
    $('famnote').textContent = fam.note;
  }

  function setFam(id) {
    state.fam = id;
    renderTabs();
    renderPlans();
  }

  function pick(id) {
    const fam = CAT.find((f) => f.plans.some((p) => p.id === id));
    if (!fam) return;
    state.sel = Object.assign({}, fam.plans.find((p) => p.id === id), { fam: fam.tab, famId: fam.id });
    renderPlans();
    $('b1').disabled = false;
    $('selinfo').innerHTML = `Seleccionado: <b>${state.sel.name}</b> · ${state.sel.fam}`;
    cargarPreguntas();
  }

  /* ---------- Etapa 2: datos ---------- */
  function tipoChange() {
    const t = $('tipo').value;
    $('fRut').hidden = t !== 'empresa';
    $('fGiro').hidden = t !== 'empresa';
    $('fExtra').hidden = t === 'persona';
    $('lRazon').textContent = t === 'nueva' ? 'Nombre que desea para su empresa (opcional)' : 'Razón social';
    $('lNombre').textContent = t === 'empresa' ? 'Nombre completo del representante legal' : 'Nombre completo del titular';
    $('lRut').textContent = t === 'empresa' ? 'RUT del representante legal' : 'RUT';
    $('lDom').textContent = t === 'empresa' ? 'Domicilio del representante legal' : 'Su domicilio';
  }

  async function cargarComunas() {
    try {
      const { comunas } = await api('GET', '/api/tienda/comunas');
      const porRegion = {};
      comunas.forEach((c) => (porRegion[c.region] ||= []).push(c));
      $('dComuna').innerHTML = '<option value="">Comuna…</option>' + Object.entries(porRegion).map(([r, l]) =>
        `<optgroup label="${esc(r)}">${l.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</optgroup>`).join('');
    } catch { /* la compra avisará si falta la comuna */ }
  }

  // Lo que piden los documentos del plan y no está en los datos del cliente (ej. patente de un vehículo)
  async function cargarPreguntas() {
    state.preguntas = [];
    $('preguntas').hidden = true;
    if (!state.sel || state.sel.price === null) return;
    try {
      const d = await api('GET', `/api/tienda/planes/${encodeURIComponent(state.sel.id)}/preguntas`);
      state.preguntas = d.preguntas;
      $('preguntasDoc').textContent = d.documentos.length ? `Se usan en: ${d.documentos.join(', ')}.` : '';
      $('preguntasCampos').innerHTML = d.preguntas.map((q, i) => `
        <div class="f"><label for="q${i}">${esc(q.etiqueta)}</label><input id="q${i}" data-marca="${esc(q.marca)}" required></div>`).join('');
      $('preguntas').hidden = !d.preguntas.length;
    } catch { /* sin preguntas: el plan no tiene documentos o la tienda no está conectada */ }
  }

  function leerDatos() {
    const t = $('tipo').value;
    const datos = {
      plan: state.sel && state.sel.id,
      tipo: t,
      region: $('region').value,
      titular: { nombre: $('dNombre').value.trim(), rut: $('dRut').value.trim(), email: $('dMail').value.trim(), celular: $('dCel').value.trim() },
      direccion: { calle: $('dCalle').value.trim(), numero: $('dNum').value.trim(), complemento: $('dDepto').value.trim(), comuna_id: $('dComuna').value },
      empresa: t === 'persona' ? undefined : { rut: $('eRut').value.trim(), razon_social: $('eRazon').value.trim(), giro: $('eGiro').value.trim() },
      respuestas: Object.fromEntries([...document.querySelectorAll('#preguntasCampos [data-marca]')].map((x) => [x.dataset.marca, x.value.trim()]))
    };
    return datos;
  }

  // Validación previa (el servidor vuelve a validar): evita llegar al pago con datos incompletos
  function faltante(d) {
    if (!d.titular.nombre) return 'Ingrese el nombre completo.';
    if (!d.titular.rut) return 'Ingrese el RUT.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.titular.email)) return 'Ingrese un correo válido.';
    if (d.tipo === 'empresa' && (!d.empresa.rut || !d.empresa.razon_social)) return 'Ingrese el RUT y la razón social de la empresa.';
    if (!d.direccion.calle || !d.direccion.numero || !d.direccion.comuna_id) return 'Ingrese su domicilio: calle, número y comuna.';
    const sin = state.preguntas.find((q) => !d.respuestas[q.marca]);
    if (sin) return `Complete "${sin.etiqueta}" para su documento.`;
    return null;
  }

  /* ---------- Etapa 3: pago ---------- */
  function renderModes() {
    const sel = state.sel;
    const cotiza = !sel || sel.price === null;
    const total = cotiza ? 0 : sel.price;
    const half = Math.round(total / 2);
    const splitOk = !cotiza && sel.recur !== 'mensual' && total >= 30000;
    const opts = [
      { id: 'total', t: 'Pago total ahora', s: cotiza ? 'Se define tras la asesoría.' : `Un solo cargo de ${clp(total)}. Servicio activo apenas se confirma el pago.` }
    ];
    if (splitOk) opts.push({ id: 'split', t: '50% ahora y 50% al entregar', s: `Dos abonos de ${clp(half)}. El segundo se cobra al habilitarse la firma del documento.` });
    if (sel && sel.recur === 'mensual') opts.push({ id: 'susc', t: 'Suscripción mensual automática', s: `Cargo recurrente de ${clp(total)} el día 5 de cada mes. Puede pausarla desde su panel.` });

    if (!opts.some((o) => o.id === state.payMode)) state.payMode = 'total';

    $('modes').innerHTML = opts.map((o) =>
      `<div class="mode ${o.id === state.payMode ? 'on' : ''}" data-mode="${o.id}" tabindex="0"><div class="rd"></div><div><div class="mt">${o.t}</div><div class="ms">${o.s}</div></div></div>`
    ).join('');
  }

  function renderSum() {
    const sel = state.sel;
    if (!sel) return;
    const cotiza = sel.price === null;
    const total = cotiza ? 0 : sel.price;
    const half = Math.round(total / 2);
    let rows = `
      <div class="srow"><span class="lb">Servicio</span><span>${sel.fam}</span></div>
      <div class="srow"><span class="lb">Plan</span><span><b>${sel.name}</b></span></div>
      <div class="srow"><span class="lb">Vigencia</span><span>${sel.per}</span></div>`;

    if (cotiza) {
      rows += `<div class="srow tot"><span>Valor</span><span>${sel.priceTxt || 'A convenir'}</span></div>
        <div class="sum-note">Este servicio no se paga en línea: al continuar queda agendada una reunión de 30 minutos con un ejecutivo, que emite la propuesta con el valor final.</div>`;
      $('bPay').textContent = 'Agendar asesoría';
    } else {
      rows += `<div class="srow"><span class="lb">Valor del plan</span><span>${clp(total)}</span></div>`;
      if (state.payMode === 'split') {
        rows += `<div class="srow"><span class="lb">Primer abono (50%) — hoy</span><span><b>${clp(half)}</b></span></div>
                 <div class="srow"><span class="lb">Segundo abono (50%) — al entregar</span><span>${clp(total - half)}</span></div>
                 <div class="srow tot"><span>Paga hoy</span><span>${clp(half)}</span></div>`;
      } else if (state.payMode === 'susc') {
        rows += `<div class="srow"><span class="lb">Cobro recurrente</span><span>${clp(total)} / mes</span></div>
                 <div class="srow tot"><span>Paga hoy</span><span>${clp(total)}</span></div>`;
      } else {
        rows += `<div class="srow tot"><span>Paga hoy</span><span>${clp(total)}</span></div>`;
      }
      rows += '<div class="sum-note">Valores en pesos chilenos, IVA incluido. Boleta electrónica emitida al RUT ingresado. Pago de demostración: queda pendiente hasta que un ejecutivo lo confirme.</div>';
      $('bPay').textContent = state.payMode === 'split' ? 'Pagar primer abono' : 'Pagar';
    }
    $('sum').innerHTML = rows;
  }

  function setPM(p) {
    state.payPM = p;
    document.querySelectorAll('.pm').forEach((e) => e.classList.toggle('on', e.dataset.pm === p));
  }

  async function pagar() {
    aviso('errPago');
    if (!$('legal').checked) return aviso('errPago', 'Acepte las condiciones del servicio para continuar.');
    const datos = leerDatos();
    datos.pago = { modo: state.payMode, medio: state.payPM };
    const btn = $('bPay'), texto = btn.textContent;
    btn.disabled = true; btn.textContent = 'Procesando…';
    try {
      state.resultado = await api('POST', '/api/tienda/compras', datos);
      go(4);
    } catch (err) {
      // Un dato mal escrito se corrige en la etapa 2
      if (err.status === 400) { go(2); aviso('errDatos', err.message); } else aviso('errPago', err.message);
    } finally {
      btn.disabled = false; btn.textContent = texto;
    }
  }

  /* ---------- Etapa 4: resultado ---------- */
  function renderOk() {
    const r = state.resultado;
    if (!r) return;
    const etapa = (estado, titulo, sub, txt) => `<div class="pstage ${estado}"><div class="pdot">${estado === 'done' ? '✓' : estado === 'now' ? '…' : '·'}</div>
      <div><div class="ptitle">${titulo}</div><div class="psub">${sub}</div></div><div class="pst">${txt}</div></div>`;

    if (r.cotizacion) {
      $('okTitle').textContent = 'Asesoría solicitada';
      $('okmsg').textContent = r.mensaje;
      $('pipeOk').innerHTML = etapa('now', 'Un ejecutivo lo contactará', 'Para agendar 30 minutos y entregarle la propuesta con el valor final.', 'En curso');
      $('okNota').textContent = '';
      return;
    }
    const medio = r.pasarela === 'transbank' ? 'Webpay Plus (Transbank)' : 'Mercado Pago';
    $('okTitle').textContent = 'Contratación registrada';
    $('okmsg').textContent = `Contrato ${r.orden} · ${r.plan} · ${r.familia}`;
    const docs = r.documentos.length ? r.documentos.map((d) => d.publicado
      ? etapa('now', `${esc(d.tipo)}: listo para su revisión`, 'Revise el borrador en Mi cuenta y acéptelo para recibir el documento final. Si algo no está correcto, envíenos un ticket desde ahí mismo.', 'Su turno')
      : etapa('now', `${esc(d.tipo)}: en revisión`, 'Un ejecutivo revisa el documento y se lo envía a Mi cuenta para que usted lo revise y acepte.', 'En curso')).join('')
      : etapa('now', 'Activación del servicio', 'Un ejecutivo confirma el pago y activa su servicio.', 'En curso');
    $('pipeOk').innerHTML =
      etapa('done', 'Pago registrado', `${clp(r.monto)} vía ${medio} · pago de demostración: queda pendiente hasta que un ejecutivo lo confirme`, 'Listo') +
      etapa('done', 'Contrato generado', `Folio ${esc(r.orden)} con los datos que ingresó`, 'Listo') + docs +
      etapa('', 'Firma electrónica avanzada', 'Después de que usted acepte el documento · Ley 19.799', 'Pendiente');
    $('okNota').innerHTML = r.cuenta === 'enlace_enviado'
      ? `Le enviamos a <b>${esc(r.email)}</b> un enlace para crear su contraseña de <b>Mi cuenta</b> (vence en 15 minutos; si vence, pida otro en Mi cuenta → "Crear o recuperar contraseña").`
      : `Ingrese a <b>Mi cuenta</b> con <b>${esc(r.email)}</b> y su contraseña.`;
  }

  /* ---------- Stepper y navegación ---------- */
  function renderStepper(cur) {
    $('stepper').innerHTML = STEPS.map((l, i) => {
      const n = i + 1;
      const cls = n < cur ? 'done' : (n === cur ? 'current' : '');
      const line = i < STEPS.length - 1 ? `<div class="step-line ${n < cur ? 'done' : ''}"></div>` : '';
      return `<div class="step ${cls}"><div class="step-circle">${n < cur ? '✓' : n}</div><div class="step-label">${l}</div></div>${line}`;
    }).join('');
  }

  function go(n) {
    if (n >= 2 && !state.sel) n = 1;                 // sin plan: vuelve al catálogo
    if (n === 3) {                                   // no se paga con datos incompletos
      const falta = faltante(leerDatos());
      if (falta) { n = 2; aviso('errDatos', falta); } else aviso('errDatos');
    }
    if (n === 4 && !state.resultado) n = 3;          // el resultado solo existe después de pagar
    if (n === 1) state.resultado = null;
    document.querySelectorAll('.stage').forEach((s) => s.classList.remove('active'));
    $('s' + n).classList.add('active');
    renderStepper(n);
    if (n === 3) { renderModes(); renderSum(); }
    if (n === 4) renderOk();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Si ya ingresó a Mi cuenta, se muestra y se usa su correo
  async function sesionPortal() {
    $('sess').innerHTML = '<a class="nav-btn" href="/mi-cuenta">Mi cuenta</a>';
    try {
      const { cliente } = await api('GET', '/api/cliente/yo');
      $('sesionCli').hidden = false;
      $('sesionT').textContent = `Sesión iniciada · ${cliente.razon_social}`;
      if (!$('dMail').value) $('dMail').value = cliente.email;
      $('sess').innerHTML = `<span style="color:var(--ink);font-weight:600">${esc(cliente.razon_social)}</span> · <a class="link" href="/mi-cuenta">Mi cuenta</a>`;
    } catch { /* sin sesión de cliente */ }
  }

  /* ---------- Eventos (delegación) ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-fam],[data-plan],[data-go],[data-mode],[data-pm],[data-pagar]');
    if (!t) return;
    const d = t.dataset;

    if (d.fam) setFam(d.fam);
    else if (d.plan) pick(d.plan);
    else if (d.mode) { state.payMode = d.mode; renderModes(); renderSum(); }
    else if (d.pm) setPM(d.pm);
    else if ('pagar' in d) pagar();

    if (d.go) go(Number(d.go));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest('[data-plan],[data-mode]');
    if (!t) return;
    e.preventDefault();
    t.click();
  });

  $('tipo').addEventListener('change', tipoChange);
  $('datosForm').addEventListener('submit', (e) => { e.preventDefault(); go(3); });

  /* ---------- Inicio ---------- */
  const pre = new URLSearchParams(location.search).get('plan');
  const famPre = pre && CAT.find((f) => f.plans.some((p) => p.id === pre));
  if (famPre) {
    state.fam = famPre.id;
    renderTabs();
    pick(pre);
  } else {
    renderTabs();
    renderPlans();
  }
  renderStepper(1);
  tipoChange();
  cargarComunas();
  sesionPortal();
})();
