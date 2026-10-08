/* Formulario de contacto del inicio. Por ahora sólo valida y muestra la confirmación. */
(function () {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    document.getElementById('contactOk').hidden = false;
    form.querySelector('button[type=submit]').disabled = true;
  });
})();
