/* =========================================================
   Tarjetas de planes en las páginas de servicio, generadas
   desde catalogo.js (requiere cargarlo antes). Marcadores:

   <div class="plans" data-planes="dom-anual,dom-sem"></div>   tarjetas de plan
   <div class="plans" data-grupos="bolsas,planes,digitales"></div>  listas de precios (firmas)
   <div data-nota="domicilio"></div>                           nota de la familia
   ========================================================= */
(function () {
  const clp = (n) => '$' + n.toLocaleString('es-CL');

  const TODOS = {};
  CATALOGO.forEach((f) => f.plans.forEach((p) => { TODOS[p.id] = p; }));

  const GRUPOS = {
    bolsas: { t: 'Bolsas de firmas', sub: 'Vigencia de 3 meses' },
    planes: { t: 'Planes de firmas', sub: 'Vigencia de 1 año' },
    digitales: { t: 'Servicios digitales', sub: 'Gestión documental' }
  };

  function tarjeta(p) {
    const precio = p.price === null ? (p.priceTxt || 'A convenir') : clp(p.price);
    return `
      <a class="plan" href="/contratar?plan=${p.id}">
        <div class="plan-head">${p.name}</div>
        ${p.price === null ? '<div class="ribbon">requiere cotización</div>' : ''}
        <div class="plan-price">${precio}</div>
        <div class="plan-per">${p.per}</div>
        <ul>${(p.detalle || p.feats).map((f) => `<li>${f}</li>`).join('')}</ul>
        <div class="plan-foot"><span class="plan-cta">${p.price === null ? 'Agendar asesoría' : 'Contratar aquí'}</span></div>
      </a>`;
  }

  function listaPrecios(grupo) {
    const items = Object.values(TODOS).filter((p) => p.grupo === grupo);
    const g = GRUPOS[grupo];
    return `
      <div class="plan static">
        <div class="plan-head">${g.t}</div>
        <div class="plan-per" style="padding:12px 0 0 0;">${g.sub}</div>
        <div class="prices">
          ${items.map((p) => `<a href="/contratar?plan=${p.id}"><span>${p.corto}</span><b>${clp(p.price)}</b></a>`).join('')}
        </div>
        <div class="plan-foot"><a class="plan-cta" href="/contratar?plan=${items[0].id}">Comprar aquí</a></div>
      </div>`;
  }

  document.querySelectorAll('[data-planes]').forEach((el) => {
    el.innerHTML = el.dataset.planes.split(',').map((id) => tarjeta(TODOS[id.trim()])).join('');
  });
  document.querySelectorAll('[data-grupos]').forEach((el) => {
    el.innerHTML = el.dataset.grupos.split(',').map((g) => listaPrecios(g.trim())).join('');
  });
  document.querySelectorAll('[data-nota]').forEach((el) => {
    el.textContent = CATALOGO.find((f) => f.id === el.dataset.nota).note;
  });
})();
