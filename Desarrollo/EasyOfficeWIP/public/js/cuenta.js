/* =========================================================
   /mi-cuenta · acceso de demostración y pestañas del panel
   ========================================================= */
(function () {
  const $ = (id) => document.getElementById(id);

  function setTab(id) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + id));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setLogged(on) {
    $('gate').hidden = on;
    $('tabs').hidden = !on;
    $('panelWrap').hidden = !on;
    $('userbox').hidden = !on;
    $('userboxOut').hidden = on;
    if (on) setTab('resumen');
    window.scrollTo({ top: 0 });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-action],[data-pw]');
    if (!t) return;
    if (t.dataset.tab) setTab(t.dataset.tab);
    else if (t.dataset.action === 'login') setLogged(true);
    else if (t.dataset.action === 'logout') setLogged(false);
    else if (t.dataset.pw) {
      const el = $(t.dataset.pw);
      const show = el.type === 'password';
      el.type = show ? 'text' : 'password';
      t.textContent = show ? 'Ocultar' : 'Mostrar';
    }
  });
})();
