/* =========================================================
   Cabecera y pie de página comunes.
   Cada página HTML deja un marcador y este script lo rellena,
   así el menú y los datos de contacto se editan en un solo lugar:

   <header id="cabecera" data-sub="contabilidad" data-activo="contabilidad"
           data-derecha="publico|contratar|cuenta" data-menu="no"></header>
   <footer id="pie" data-tipo="completo|simple"></footer>
   ========================================================= */
const SITIO = {
  telefono: '+56222777781',
  telefonoVisible: '+56 22 277 7781',
  email: 'info@easyoffice.cl',
  emprendimientos: '5.000',
  horario: 'Lun a jue 08:30–17:30 · vie 08:30–14:30',
  sucursales: [
    'Casa Matriz: ZIP 2362633 — Región de Valparaíso',
    'Sucursal: ZIP 8260183 — Región Metropolitana'
  ],
  agenda: 'https://calendly.com/easy-office/reunion-informativa-de-servicios',
  redes: [
    { nombre: 'LinkedIn', url: 'https://www.linkedin.com/company/easyoffice-cl/' },
    { nombre: 'Facebook', url: 'https://www.facebook.com/easyoffice.cl' },
    { nombre: 'Instagram', url: 'https://www.instagram.com/easyoffice.cl/' },
    { nombre: 'X', url: 'https://x.com/easyoffice_cl' }
  ],
  menu: [
    { id: 'inicio', texto: 'Inicio', url: '/' },
    { id: 'domicilio', texto: 'Domicilio tributario', url: '/domicilio-tributario' },
    { id: 'contabilidad', texto: 'Contabilidad', url: '/contabilidad' },
    { id: 'firmas', texto: 'Firmas Electrónicas', url: '/firmas-electronicas' },
    { id: 'asesoria', texto: 'Asesoría Empresas', url: '/asesoria-empresas' },
    { id: 'rebaja', texto: 'Rebaja Tributaria', url: '/rebaja-tributaria' },
    { id: 'contratar', texto: 'Contratar', url: '/contratar' }
  ]
};

// Cliente de demostración que se muestra en /mi-cuenta
const CLIENTE_DEMO = { nombre: 'Camila Andrea Torres Reyes', iniciales: 'CT', rut: '18.204.331-5' };

function logoHTML(sub) {
  return `
    <a class="logo" href="/" aria-label="Easy Office, ir al inicio">
      <svg width="34" height="20" viewBox="0 0 34 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" stroke="#24D356" stroke-width="3"/>
        <circle cx="23" cy="10" r="7.5" stroke="#24D356" stroke-width="3"/>
      </svg>
      <div><div class="lw">EASY OFFICE</div><div class="ls">${sub}</div></div>
    </a>`;
}

function derechaHTML(tipo) {
  if (tipo === 'contratar') return '<div class="session" id="sess"></div>'; // lo rellena contratar.js
  if (tipo === 'cuenta') {
    return `
      <div class="userbox" id="userbox" hidden>
        <div class="avatar">${CLIENTE_DEMO.iniciales}</div>
        <div><div class="un">${CLIENTE_DEMO.nombre}</div><div class="ur">RUT ${CLIENTE_DEMO.rut} · correo verificado</div></div>
        <button class="logout" data-action="logout">Salir</button>
      </div>
      <div class="userbox" id="userboxOut"><span style="color:var(--muted);font-size:12.5px;">Zona privada de clientes</span></div>`;
  }
  return '<div class="session"><a class="nav-btn" href="/mi-cuenta">Mi cuenta</a></div>';
}

function renderCabecera(el) {
  const d = el.dataset;
  const conMenu = d.menu !== 'no';
  const menu = SITIO.menu.map((m) =>
    `<a href="${m.url}" class="${m.id === d.activo ? 'on' : ''}">${m.texto}</a>`).join('');

  el.outerHTML = `
    <div class="strip">
      <div>Más de <b>${SITIO.emprendimientos}</b> emprendimientos exitosos</div>
      <a class="phone" href="tel:${SITIO.telefono}">✆ ${SITIO.telefono}</a>
    </div>
    <header class="nav">
      ${logoHTML(d.sub || 'centro de emprendimiento')}
      ${conMenu ? `<nav class="menu" id="menu" aria-label="Menú principal">${menu}</nav>` : ''}
      <div class="nav-right">
        ${derechaHTML(d.derecha)}
        ${conMenu ? '<button class="burger" id="burger" aria-label="Abrir menú" aria-controls="menu" aria-expanded="false"><span></span></button>' : ''}
      </div>
    </header>`;
}

function renderPie(el) {
  if (el.dataset.tipo === 'simple') {
    el.outerHTML = `
      <footer class="simple">
        <span>Easy Office · panel del cliente (versión de desarrollo)</span>
        <span>${SITIO.email} · ${SITIO.telefonoVisible} · ${SITIO.horario}</span>
      </footer>`;
    return;
  }
  const li = (arr) => arr.map((x) => `<li>${x}</li>`).join('');
  el.outerHTML = `
    <footer class="site">
      <div class="fgrid">
        <div>
          <img class="flogo" src="/img/logo-blanco.png" alt="Easy Office">
          <p style="line-height:1.7;margin:0;">Centro de emprendimiento, red de oficinas equipadas y servicios digitales para la creación, activación y operación de emprendimientos 100% digitales.</p>
        </div>
        <div>
          <h4>Enlaces útiles</h4>
          <ul>${li(SITIO.menu.map((m) => `<a href="${m.url}">${m.texto}</a>`))}</ul>
        </div>
        <div>
          <h4>Contáctanos</h4>
          <ul>
            ${li(SITIO.sucursales)}
            <li><a href="mailto:${SITIO.email}">${SITIO.email}</a></li>
            <li><a href="tel:${SITIO.telefono}">${SITIO.telefonoVisible}</a></li>
            <li>${SITIO.horario}</li>
          </ul>
        </div>
        <div>
          <h4>Síguenos</h4>
          <ul>
            ${li(SITIO.redes.map((r) => `<a href="${r.url}" target="_blank" rel="noopener">${r.nombre}</a>`))}
            <li><a href="/mi-cuenta">Mi cuenta</a></li>
          </ul>
        </div>
      </div>
      <div class="fine">
        <span>© ${new Date().getFullYear()} Easy Office · Versión en desarrollo del sitio.</span>
        <span>Firma electrónica avanzada conforme a Ley 19.799</span>
      </div>
    </footer>`;
}

(function () {
  const cab = document.getElementById('cabecera');
  const pie = document.getElementById('pie');
  if (cab) renderCabecera(cab);
  if (pie) renderPie(pie);

  // Enlaces de agenda: <a data-agenda>
  document.querySelectorAll('[data-agenda]').forEach((a) => {
    a.href = SITIO.agenda;
    a.target = '_blank';
    a.rel = 'noopener';
  });

  // Menú en pantallas pequeñas
  const burger = document.getElementById('burger');
  const menu = document.getElementById('menu');
  if (burger && menu) {
    burger.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
    });
  }
})();
