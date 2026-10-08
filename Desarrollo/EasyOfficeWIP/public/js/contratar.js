/* =========================================================
   /contratar · flujo de 4 etapas: Servicio → Datos → Pago → Documento
   Requiere catalogo.js. Acepta ?plan=<id> para preseleccionar un plan.
   ========================================================= */
(function () {
  const CAT = window.CATALOGO;
  const STEPS = ['Servicio', 'Datos', 'Pago', 'Documento'];
  const ORDEN = 'EO-2026-04417'; // número de orden de ejemplo

  const $ = (id) => document.getElementById(id);
  const clp = (n) => '$' + n.toLocaleString('es-CL');

  const state = {
    fam: CAT[0].id,
    sel: null,
    logged: false,
    guest: false,
    payMode: 'total',
    payPM: 'tbk'
  };

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
  }

  /* ---------- Etapa 2: cuenta y datos ---------- */
  function setAuth(which) {
    $('atLogin').classList.toggle('on', which === 'login');
    $('atReg').classList.toggle('on', which === 'reg');
    $('paneLogin').hidden = which !== 'login';
    $('paneReg').hidden = which !== 'reg';
    $('s2title').textContent = which === 'reg' ? 'Cree su cuenta' : 'Ingrese a su cuenta';
  }

  function login(asGuest) {
    state.logged = true;
    state.guest = !!asGuest;
    $('auth').hidden = true;
    $('logged').hidden = false;
    $('logged').classList.toggle('guest', state.guest);
    $('datosForm').hidden = false;
    $('b2').disabled = false;
    $('s2title').textContent = 'Confirme sus datos';
    $('s2sub').textContent = state.guest
      ? 'Está comprando como invitado. Revise sus datos; al finalizar podrá crear su cuenta con un clic para conservar el historial.'
      : 'Estos datos vienen de su cuenta. Puede corregirlos antes de pagar; los cambios quedan guardados en su perfil.';
    $('loggedT').textContent = state.guest ? 'Compra como invitado' : 'Sesión iniciada · Camila Andrea Torres Reyes';
    $('loggedS').textContent = state.guest
      ? 'Sin cuenta. Podrá crearla al terminar para ver sus documentos después.'
      : 'camila.torres@correo.cl · correo confirmado · último acceso hoy 10:24';
    if (state.guest) {
      $('dNombre').value = '';
      $('dRut').value = '';
      $('dMail').value = '';
    }
    updateNav();
  }

  function logout() {
    state.logged = false;
    state.guest = false;
    $('auth').hidden = false;
    $('logged').hidden = true;
    $('datosForm').hidden = true;
    $('b2').disabled = true;
    setAuth('login');
    updateNav();
    go(2);
  }

  function updateNav() {
    const sess = $('sess');
    if (state.logged && !state.guest) {
      sess.innerHTML = '<span class="avatar">CT</span> <span style="color:var(--ink);font-weight:600">Camila Torres</span> · <span class="link" data-logout>Salir</span>';
    } else if (state.logged && state.guest) {
      sess.innerHTML = '<span>Compra como invitado</span> · <span class="link" data-logout>Iniciar sesión</span>';
    } else {
      sess.innerHTML = '<button class="nav-btn" data-go="2">Iniciar sesión</button><button class="nav-btn solid" data-go="2" data-auth="reg">Crear cuenta</button>';
    }
  }

  function tipoChange() {
    const t = $('tipo').value;
    $('fRut').hidden = t !== 'empresa';
    $('fExtra').querySelector('label').textContent =
      t === 'nueva' ? 'Nombre que desea para su empresa' : 'Nombre o razón social';
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
      rows += '<div class="sum-note">Valores en pesos chilenos, IVA incluido. Boleta electrónica emitida al RUT registrado en su cuenta.</div>';
      $('bPay').textContent = state.payMode === 'split' ? 'Pagar primer abono' : 'Pagar';
    }
    $('sum').innerHTML = rows;
  }

  function setPM(p) {
    state.payPM = p;
    document.querySelectorAll('.pm').forEach((e) => e.classList.toggle('on', e.dataset.pm === p));
  }

  /* ---------- Etapa 4: confirmación ---------- */
  function renderOk() {
    const sel = state.sel;
    if (!sel) return;
    const cotiza = sel.price === null;
    const total = cotiza ? 0 : sel.price;
    const half = Math.round(total / 2);
    const medio = state.payPM === 'tbk' ? 'Webpay Plus (Transbank)' : 'Mercado Pago';
    $('okTitle').textContent = cotiza ? 'Asesoría agendada' : 'Pago recibido';
    $('okmsg').textContent = `Orden ${ORDEN} · ${sel.name} · comprobante enviado a su correo.`;
    $('pay1').textContent = cotiza
      ? 'Asesoría agendada — sin cargo'
      : (state.payMode === 'split' ? `Primer abono de ${clp(half)} recibido vía ${medio}` : `${clp(total)} recibidos vía ${medio}`);
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
    if (n >= 3 && !state.sel) n = 1;     // no se paga sin plan: vuelve al catálogo
    if (n >= 3 && !state.logged) n = 2;  // ni sin cuenta o compra como invitado
    document.querySelectorAll('.stage').forEach((s) => s.classList.remove('active'));
    $('s' + n).classList.add('active');
    renderStepper(n);
    if (n === 3) { renderModes(); renderSum(); }
    if (n === 4) renderOk();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- Eventos (delegación) ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-fam],[data-plan],[data-auth],[data-login],[data-logout],[data-go],[data-mode],[data-pm],[data-pw]');
    if (!t) return;
    const d = t.dataset;

    if (d.fam) setFam(d.fam);
    else if (d.plan) pick(d.plan);
    else if (d.mode) { state.payMode = d.mode; renderModes(); renderSum(); }
    else if (d.pm) setPM(d.pm);
    else if (d.pw) {
      const el = $(d.pw);
      const show = el.type === 'password';
      el.type = show ? 'text' : 'password';
      t.textContent = show ? 'Ocultar' : 'Mostrar';
    }
    else if ('login' in d) login(d.login === 'guest');
    else if ('logout' in d) logout();

    // data-go y data-auth pueden venir juntos (botón «Crear cuenta» de la cabecera)
    if (d.go) go(Number(d.go));
    if (d.auth) setAuth(d.auth);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest('[data-plan],[data-mode]');
    if (!t) return;
    e.preventDefault();
    t.click();
  });

  $('tipo').addEventListener('change', tipoChange);

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
  updateNav();
})();
