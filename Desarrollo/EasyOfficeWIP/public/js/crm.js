/* =========================================================
   /crm · acceso de demostración, módulos y cambio de rol.
   Los datos de ejemplo de este archivo se reemplazarán por la API.
   ========================================================= */
(function () {
  const $ = (id) => document.getElementById(id);

  const NAV = [
    { id: 'dashboard', t: 'Dashboard', h: ['Dashboard', 'Resumen operativo · 5 de septiembre de 2026'] },
    { id: 'clientes', t: 'Clientes', h: ['Clientes', 'Ficha única por RUT declarado y correo verificado'], cnt: '1.284', g: true },
    { id: 'renovaciones', t: 'Renovaciones y cobranza', h: ['Renovaciones y cobranza', 'Vencimientos, avisos anticipados y estado de pago'], cnt: '17' },
    { id: 'documentos', t: 'Documentos y firmas', h: ['Documentos y firmas', 'Generación automática, verificación humana y firma avanzada'], cnt: '6' },
    { id: 'correspondencia', t: 'Correspondencia', h: ['Correspondencia y oficina de partes', 'Recepción, digitalización y despacho con plazos'], cnt: '11' },
    { id: 'ventas', t: 'Ventas en línea', h: ['Ventas en línea', 'Órdenes, pasarelas y embudo de conversión'] },
    { id: 'auditoria', t: 'Auditoría', h: ['Auditoría y trazabilidad', 'Registro completo de acciones por usuario y rol'] }
  ];

  const USUARIOS = {
    admin: { iniciales: 'DM', nombre: 'Diego Muñoz', corto: 'Diego M.', email: 'diego.munoz@easyoffice.cl', rol: 'Administrador' },
    oper: { iniciales: 'CR', nombre: 'Camila Rojas', corto: 'Camila R.', email: 'camila.rojas@easyoffice.cl', rol: 'Operativo' }
  };

  const CLIENTES = [
    { n: 'Constructora Rilán SpA', rut: '76.450.221-3', srv: 'Domicilio anual · 25 firmas', ej: 'Diego M.', vig: 'Venció 1 sep 2026', est: 'Vencido', bg: 'red' },
    { n: 'María Fernanda Ossa', rut: '18.204.331-5', srv: 'Domicilio semestral', ej: 'Camila R.', vig: '8 sep 2026', est: 'Por vencer', bg: 'amb' },
    { n: 'Distribuidora Andes Ltda.', rut: '77.910.442-1', srv: 'Contabilidad Plan Pyme', ej: 'Diego M.', vig: 'Suscripción mensual', est: 'Al día', bg: 'grn' },
    { n: 'Juan Carlos Peña', rut: '14.552.098-2', srv: 'Plan 25 firmas avanzadas', ej: 'Camila R.', vig: '2 sep 2027', est: 'Activo', bg: 'grn' },
    { n: 'Roberto Silva E.I.R.L.', rut: '76.221.678-9', srv: 'Bolsa 10 firmas · queda 1', ej: 'Camila R.', vig: '22 sep 2026', est: 'Por vencer', bg: 'amb' },
    { n: 'Ana Lagos Peralta', rut: '15.887.410-2', srv: 'Domicilio bodega virtual', ej: 'Paula V.', vig: '29 sep 2026', est: 'Activo', bg: 'grn' },
    { n: 'Inversiones Cerro SpA', rut: '76.998.120-4', srv: 'Contabilidad Plan Estándar', ej: 'Paula V.', vig: 'Suscripción mensual', est: 'Al día', bg: 'grn' }
  ];

  const BARRAS = [
    { m: 'Sep', v: 63, lvl: 'hi' }, { m: 'Oct', v: 41, lvl: 'md' }, { m: 'Nov', v: 28, lvl: '' },
    { m: 'Dic', v: 52, lvl: 'md' }, { m: 'Ene', v: 74, lvl: 'hi' }, { m: 'Feb', v: 19, lvl: '' }
  ];

  let role = 'admin';
  let view = 'dashboard';

  function renderNav() {
    $('nav').innerHTML = NAV.map((n) => `
      <button class="nv ${n.id === view ? 'on' : ''}" data-view="${n.id}">
        <svg class="ic" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M4.6 8.2l2.1 2.1 4.4-4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        ${n.t}${n.cnt ? `<span class="cnt ${n.g ? 'g' : ''}">${n.cnt}</span>` : ''}
      </button>`).join('');
  }

  function setView(id) {
    view = id;
    renderNav();
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + id));
    const n = NAV.find((x) => x.id === id);
    $('tt').textContent = n.h[0];
    $('ts').textContent = n.h[1];
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setRole(r) {
    role = r;
    const u = USUARIOS[r];
    document.querySelectorAll('.rb').forEach((b) => b.classList.toggle('on', b.dataset.role === r));
    $('sessName').textContent = `${u.corto} · ${u.rol}`;
    $('whoAv').textContent = u.iniciales;
    $('whoName').textContent = u.nombre;
    $('whoMail').textContent = u.email;
    renderClientes();
  }

  // El rol operativo ve sólo sus casos y no puede eliminar.
  function renderClientes() {
    const q = $('qClientes').value.trim().toLowerCase();
    const est = $('fEstado').value;
    const yo = USUARIOS.oper.corto;
    const vis = CLIENTES.filter((c) =>
      (role === 'admin' || c.ej === yo) &&
      (!q || (c.n + ' ' + c.rut).toLowerCase().includes(q)) &&
      (!est || c.est === est));

    $('tbClientes').innerHTML = vis.map((c) => `
      <tr>
        <td><div class="nm">${c.n}</div><div class="sb">Cliente desde 2024</div></td>
        <td class="mono">${c.rut}</td>
        <td>${c.srv}</td>
        <td>${c.ej}</td>
        <td>${c.vig}</td>
        <td><span class="bg ${c.bg}">${c.est}</span></td>
        <td style="white-space:nowrap">
          <button class="ib" title="Ver ficha">◱</button>
          <button class="ib" title="Editar">✎</button>
          ${role === 'admin'
            ? '<button class="ib dg" title="Eliminar">✕</button>'
            : '<button class="ib" title="Eliminar deshabilitado" disabled>✕</button>'}
        </td>
      </tr>`).join('');

    $('ntClientes').textContent = role === 'oper'
      ? `Vista operativa: solo aparecen los casos asignados a ${yo} (${vis.length}). El botón de eliminar está deshabilitado; cualquier intento queda registrado en Auditoría.`
      : `Vista administrador: acceso a los clientes de todos los ejecutivos (${vis.length}), con permiso de eliminación. Cada eliminación queda registrada con usuario, hora y registro afectado.`;
  }

  function renderBars() {
    const max = Math.max(...BARRAS.map((d) => d.v));
    $('bars').innerHTML = BARRAS.map((d) => `
      <div class="bcol">
        <div class="bval">${d.v}</div>
        <div class="btrack"><div class="bfill ${d.lvl}" style="height:${Math.round(d.v / max * 100)}%"></div></div>
        <div class="blab">${d.m}</div>
      </div>`).join('');
  }

  function setApp(on) {
    $('gate').hidden = on;
    $('app').hidden = !on;
    window.scrollTo({ top: 0 });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-view],[data-role],[data-action],[data-pw]');
    if (!t) return;
    if (t.dataset.view) setView(t.dataset.view);
    else if (t.dataset.role) setRole(t.dataset.role);
    else if (t.dataset.action === 'enter') setApp(true);
    else if (t.dataset.action === 'exit') setApp(false);
    else if (t.dataset.pw) {
      const el = $(t.dataset.pw);
      const show = el.type === 'password';
      el.type = show ? 'text' : 'password';
      t.textContent = show ? 'Ocultar' : 'Mostrar';
    }
  });

  $('qClientes').addEventListener('input', renderClientes);
  $('fEstado').addEventListener('change', renderClientes);

  renderNav();
  renderClientes();
  renderBars();
})();
