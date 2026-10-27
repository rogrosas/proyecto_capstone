/* =========================================================
   /mi-cuenta · portal del cliente con acceso por enlace al correo.
   1. Sin sesión: formulario de correo → POST /api/cliente/acceso.
   2. El enlace del correo abre /mi-cuenta?acceso=<token> →
      POST /api/cliente/verificar (crea la sesión) y se quita el token de la URL.
   3. Con sesión: GET /api/cliente/panel y se dibujan las pestañas.
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
  function mostrarAcceso({ ok, error } = {}) {
    $('gate').hidden = false;
    $('tabs').hidden = true;
    $('panelWrap').hidden = true;
    $('userbox').hidden = true;
    $('userboxOut').hidden = false;
    $('accesoOk').hidden = !ok; $('accesoOk').textContent = ok || '';
    $('accesoError').hidden = !error; $('accesoError').textContent = error || '';
  }

  $('accesoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!$('accesoForm').reportValidity()) return;
    const btn = $('btnAcceso');
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const r = await api('/acceso', { email: $('cMail').value.trim() });
      mostrarAcceso({ ok: r.mensaje });
    } catch (err) {
      mostrarAcceso({ error: err.message });
    } finally {
      btn.disabled = false; btn.textContent = 'Enviarme el enlace de acceso';
    }
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

  function documentos(p) {
    const pendientes = p.documentos.filter((d) => d.estado === 'enviado_firma').length;
    $('bDocs').hidden = !pendientes; $('bDocs').textContent = pendientes;
    $('v-documentos').innerHTML = `
      <div class="sh"><h2>Mis documentos</h2><p>Sus contratos y documentos con Easy Office. Los firmados tienen un código de verificación con el que un tercero puede comprobar su validez.</p></div>
      ${pendientes ? `<div class="alert ok"><div class="ai">✎</div><div><div class="at">Tiene ${pendientes} documento${pendientes > 1 ? 's' : ''} esperando su firma</div><div class="ad">Le llegará el enlace de firma electrónica a su correo.</div></div></div>` : ''}
      <div class="panel tbl-wrap" style="padding:10px 22px;"><table>
        <thead><tr><th>Documento</th><th>Contrato</th><th>Emitido</th><th>Estado</th><th>Código de verificación</th></tr></thead>
        <tbody>${p.documentos.length ? p.documentos.map((d) => `<tr>
          <td class="nm">${esc(d.tipo)}</td><td class="mono">${esc(d.folio || '—')}</td><td>${fecha(d.generado)}</td>
          <td>${badge(DOC, d.estado)}${d.firmado ? `<div class="sb">${fecha(d.firmado)}</div>` : ''}</td><td class="mono">${esc(d.codigo || '—')}</td></tr>`).join('')
          : '<tr><td colspan="5" class="empty">Aún no tiene documentos.</td></tr>'}</tbody>
      </table></div>`;
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
          <div class="kv"><span class="k">Correo de acceso</span><span class="v">${esc(c.email)}</span></div>
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
      const p = await api('/panel');
      resumen(p); documentos(p); pagos(p); datos(p);
    } catch (err) {
      if (err.status === 401) return mostrarAcceso({ error: 'Su sesión expiró. Pida un nuevo enlace de acceso.' });
      $('v-resumen').innerHTML = `<div class="panel"><div class="empty" style="color:var(--red)">${esc(err.message)}</div></div>`;
    }
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab],[data-action="logout"]');
    if (!t) return;
    if (t.dataset.tab) return setTab(t.dataset.tab);
    await api('/salir', {}).catch(() => {});
    mostrarAcceso({ ok: 'Cerró su sesión.' });
  });

  /* ---------- inicio ---------- */
  (async () => {
    const token = new URLSearchParams(location.search).get('acceso');
    if (token) {
      history.replaceState(null, '', '/mi-cuenta'); // el token no queda en el historial
      try {
        const { cliente } = await api('/verificar', { token });
        return mostrarPanel(cliente);
      } catch (err) {
        return mostrarAcceso({ error: err.message });
      }
    }
    try {
      const { cliente } = await api('/yo');
      mostrarPanel(cliente);
    } catch {
      mostrarAcceso();
    }
  })();
})();
