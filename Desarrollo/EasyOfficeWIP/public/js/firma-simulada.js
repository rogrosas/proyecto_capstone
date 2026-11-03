/* /firma-simulada · Simulador de la plataforma de firma electrónica (laboratorio).
   El enlace del correo trae ?t=<token>: se muestra el documento, el firmante confirma su RUT y firma o rechaza. */
(function () {
  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(location.search).get('t') || '';
  const api = (ruta, opciones) => fetch(`/api/firma/simulador/${encodeURIComponent(token)}${ruta}`, {
    credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opciones
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo completar la solicitud.');
    return d;
  });

  function error(msg) {
    $('error').textContent = msg;
    $('error').hidden = false;
  }

  function resultado(ok, tituloTxt, texto) {
    $('panel').innerHTML = `<div class="resultado ${ok ? 'ok' : 'mal'}"><div class="ic">${ok ? '✓' : '✕'}</div>
      <h2></h2><p></p></div>`;
    $('panel').querySelector('h2').textContent = tituloTxt;
    $('panel').querySelector('p').textContent = texto;
  }

  async function iniciar() {
    if (!token) return error('Falta el enlace de firma. Ábralo desde el correo que recibió.');
    let d;
    try { d = await api(''); } catch (e) { return error(e.message); }
    $('contenido').hidden = false;
    $('titulo').textContent = `${d.documento.tipo}${d.documento.folio ? ' · ' + d.documento.folio : ''}`;
    $('firmante').textContent = d.firmante.nombre;
    if (d.firmante.con_rut) $('rutReg').textContent = d.firmante.rut;
    else { $('filaRut').hidden = true; $('fRut').hidden = true; }
    $('doc').src = `/api/firma/simulador/${encodeURIComponent(token)}/documento`;
    if (d.estado === 'firmado') return resultado(true, 'Usted ya firmó este documento', 'Cuando todos los firmantes terminen, el documento firmado quedará disponible en Mi cuenta.');
    if (d.estado === 'rechazado') return resultado(false, 'Usted rechazó la firma', 'Easy Office revisará su motivo y le responderá por correo.');
    if (d.estado_documento !== 'enviado_firma') return resultado(false, 'Este documento ya no espera firmas', 'Si cree que es un error, contacte a su ejecutivo.');
  }

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('error').hidden = true;
    if (!$('acepto').checked) return error('Marque la casilla para confirmar que leyó el documento.');
    $('btnFirmar').disabled = true;
    try {
      const r = await api('', { method: 'POST', body: JSON.stringify({ accion: 'firmar', acepto: true, rut: $('rut').value }) });
      resultado(true, 'Documento firmado', r.completo
        ? `Quedó firmado con el código de verificación ${r.codigo}. Lo puede descargar en Mi cuenta.`
        : 'Su firma quedó registrada. Falta la firma de otra persona.');
    } catch (err) {
      error(err.message);
      $('btnFirmar').disabled = false;
    }
  });

  $('btnRechazar').addEventListener('click', () => { $('rechazo').hidden = false; $('motivo').focus(); });
  $('btnConfirmarRechazo').addEventListener('click', async () => {
    $('error').hidden = true;
    if (!$('motivo').value.trim()) return error('Escriba el motivo del rechazo.');
    $('btnConfirmarRechazo').disabled = true;
    try {
      await api('', { method: 'POST', body: JSON.stringify({ accion: 'rechazar', motivo: $('motivo').value }) });
      resultado(false, 'Firma rechazada', 'Le avisamos a Easy Office: revisarán su motivo y le responderán por correo.');
    } catch (err) {
      error(err.message);
      $('btnConfirmarRechazo').disabled = false;
    }
  });

  iniciar();
})();
