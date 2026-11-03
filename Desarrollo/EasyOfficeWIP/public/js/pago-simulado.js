/* /pago-simulado · Simulador de la pasarela de pago (laboratorio).
   Llega con ?t=<token> desde /contratar; al aprobar vuelve a /contratar?pago=<token> con el resultado. */
(function () {
  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(location.search).get('t') || '';
  const MEDIO = { transbank: 'Webpay Plus (Transbank) · simulado', mercado_pago: 'Mercado Pago · simulado', transferencia: 'Transferencia' };
  const clp = (n) => '$' + Math.round(Number(n)).toLocaleString('es-CL');
  const api = (ruta, metodo = 'GET', datos) => fetch(`/api/tienda/pago/${encodeURIComponent(token)}${ruta}`, {
    method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: datos ? JSON.stringify(datos) : undefined
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo completar la solicitud.');
    return d;
  });

  function error(msg) { $('error').textContent = msg; $('error').hidden = false; }
  const volver = () => location.assign(`/contratar?pago=${encodeURIComponent(token)}`);

  function rechazado() {
    $('panel').querySelector('.gate-body').innerHTML = `<div class="resultado mal"><div class="ic">✕</div><h2>Pago rechazado</h2>
      <p>La pasarela no aprobó el pago. Su contratación quedó guardada: puede intentarlo de nuevo.</p></div>
      <div class="acc"><button class="btn btn-g btn-w" type="button" id="btnReintentar">Intentar de nuevo</button>
      <a class="btn btn-o btn-w" href="/contratar">Volver a la tienda</a></div>`;
    $('btnReintentar').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { location.assign((await api('/reintentar', 'POST')).pago.url); } catch (err) { error(err.message); e.target.disabled = false; }
    });
  }

  async function iniciar() {
    if (!token) return error('Falta el enlace de pago. Vuelva a la tienda.');
    let d;
    try { d = await api(''); } catch (e) { return error(e.message); }
    if (d.estado === 'pagado') return volver();
    $('panel').hidden = false;
    $('titulo').textContent = `Pagar ${clp(d.monto)}`;
    $('orden').textContent = d.orden;
    $('plan').textContent = `${d.familia ? d.familia + ' · ' : ''}${d.plan}`;
    $('medio').textContent = MEDIO[d.pasarela] || d.pasarela;
    $('monto').textContent = clp(d.monto);
    if (d.estado === 'rechazado') rechazado();
  }

  async function resultado(accion, boton) {
    $('error').hidden = true;
    document.querySelectorAll('#panel button').forEach((b) => { b.disabled = true; });
    boton.textContent = 'Procesando…';
    try {
      const r = await api('', 'POST', { accion });
      if (r.estado === 'pagado') volver(); else rechazado();
    } catch (err) {
      error(err.message);
      document.querySelectorAll('#panel button').forEach((b) => { b.disabled = false; });
      boton.textContent = accion === 'aprobar' ? 'Aprobar pago' : 'Rechazar pago';
    }
  }

  $('btnAprobar').addEventListener('click', (e) => resultado('aprobar', e.target));
  $('btnRechazar').addEventListener('click', (e) => resultado('rechazar', e.target));
  iniciar();
})();
