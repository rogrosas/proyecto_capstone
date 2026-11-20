/* =========================================================
   RUT con puntos y guion mientras se escribe: "123456785" → "12.345.678-5".
   Se aplica solo a cualquier campo de RUT de la página, también a los que se
   crean después (formularios del CRM): los marcados con data-rut y los que se
   llaman "rut", "…​.rut", "…_rut" o "rut_…". Acepta pegar el RUT con o sin
   formato y la K mayúscula o minúscula. El servidor lo vuelve a validar.
   ========================================================= */
(function () {
  const SELECTOR = 'input[data-rut], input[name="rut"], input[name$=".rut"], input[name$="_rut"], input[name^="rut_"]';

  // Solo números y K (la K únicamente como dígito verificador); máximo 8 + 1
  const limpiar = (v) => String(v || '').toUpperCase().replace(/[^0-9K]/g, '').replace(/K(?=.)/g, '').slice(0, 9);

  function formatear(valor) {
    const v = limpiar(valor);
    if (v.length < 2) return v;
    return v.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + v.slice(-1);
  }

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.matches(SELECTOR)) return;
    // Cuántos caracteres útiles (números o K) hay antes del cursor, para dejarlo en el mismo lugar
    const antes = limpiar(el.value.slice(0, el.selectionStart ?? el.value.length)).length;
    const nuevo = formatear(el.value);
    if (nuevo === el.value) return;
    el.value = nuevo;
    let pos = 0, utiles = 0;
    while (pos < nuevo.length && utiles < antes) { if (/[0-9K]/.test(nuevo[pos])) utiles++; pos++; }
    if (document.activeElement === el) el.setSelectionRange(pos, pos);
  });

  // Campos que ya traen un valor (por ejemplo, rellenados desde Mi cuenta o al editar en el CRM)
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.matches(SELECTOR) && el.value) el.value = formatear(el.value);
  });

  window.RUT = { formatear, limpiar };
})();
