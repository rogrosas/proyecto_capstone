/* /verificar · Autenticidad de un documento firmado por su código EO-XXXX-XXXX.
   Opcional: comparar un archivo con la huella SHA-256 registrada (se calcula en el navegador, el archivo no se sube). */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fecha = (s) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}${s.length > 10 ? ' ' + s.slice(11, 16) : ''}` : '—');
  let hash = null;

  async function verificar(codigo) {
    $('error').hidden = true;
    $('res').innerHTML = '';
    const c = codigo.trim().toUpperCase();
    if (!/^EO-[0-9A-F]{4}-[0-9A-F]{4}$/.test(c)) {
      $('error').textContent = 'El código tiene el formato EO-XXXX-XXXX (letras A-F y números).';
      $('error').hidden = false;
      return;
    }
    $('btn').disabled = true;
    try {
      const r = await fetch('/api/verificar/' + encodeURIComponent(c));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo verificar.');
      history.replaceState(null, '', '/verificar?codigo=' + encodeURIComponent(c));
      if (!d.valido) {
        $('res').innerHTML = `<div class="resultado mal"><div class="ic">✕</div><h2>Código no encontrado</h2>
          <p>No hay un documento firmado con el código <b class="mono">${esc(c)}</b>. Revise que esté bien escrito.</p></div>`;
        return;
      }
      hash = d.hash;
      $('res').innerHTML = `<div class="resultado ok"><div class="ic">✓</div><h2>Documento auténtico</h2>
          <p>Fue firmado electrónicamente y está registrado en Easy Office.</p></div>
        <div class="dato"><span class="k">Documento</span><span class="v">${esc(d.documento)}</span></div>
        ${d.folio ? `<div class="dato"><span class="k">Contrato</span><span class="v mono">${esc(d.folio)}</span></div>` : ''}
        <div class="dato"><span class="k">Cliente</span><span class="v">${esc(d.cliente)}</span></div>
        <div class="dato"><span class="k">Firmado</span><span class="v">${fecha(d.firmado)}</span></div>
        ${d.firmantes.map((f) => `<div class="dato"><span class="k">Firmó</span><span class="v">${esc(f.nombre)}</span></div>`).join('')}
        <div class="dato"><span class="k">Plataforma</span><span class="v">${esc(d.plataforma)}</span></div>
        <div class="dato"><span class="k">Huella SHA-256</span><span class="v mono" style="font-size:11px;">${esc(d.hash || '—')}</span></div>
        ${d.hash ? `<div class="archivo"><label for="archivo">¿Tiene el archivo? Compruebe que no fue modificado (no se sube a ninguna parte):</label><br>
          <input type="file" id="archivo" accept=".docx,.pdf"><div class="coincide" id="coincide" hidden></div></div>` : ''}`;
      $('archivo')?.addEventListener('change', comparar);
    } catch (e) {
      $('error').textContent = e.message;
      $('error').hidden = false;
    } finally {
      $('btn').disabled = false;
    }
  }

  async function comparar(e) {
    const f = e.target.files[0];
    const out = $('coincide');
    if (!f || !hash) return;
    const buf = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
    const h = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    out.hidden = false;
    out.className = 'coincide ' + (h === hash ? 'si' : 'no');
    out.textContent = h === hash ? '✓ El archivo es idéntico al documento firmado.' : '✕ El archivo NO coincide: fue modificado o es otro documento.';
  }

  $('form').addEventListener('submit', (e) => { e.preventDefault(); verificar($('codigo').value); });
  const inicial = new URLSearchParams(location.search).get('codigo');
  if (inicial) { $('codigo').value = inicial; verificar(inicial); }
})();
