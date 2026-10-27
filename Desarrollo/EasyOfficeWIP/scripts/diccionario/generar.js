// Genera el diccionario de datos en HTML a partir de easyoffice_er.sql + descripciones.js
const fs = require('fs');
const path = require('path');
const D = require('./uso-app')(require('./descripciones'));

const SQL_PATH = process.argv[2];
const OUT = process.argv[3];
const sql = fs.readFileSync(SQL_PATH, 'utf8');

/* ---------- parser de CREATE TABLE ---------- */
function splitTop(body) {
  const parts = []; let depth = 0, cur = '', q = false;
  for (const ch of body) {
    if (ch === "'") q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && depth === 0 && ch === ',') { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const tablas = {};
const reTable = /CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g;
let m;
while ((m = reTable.exec(sql))) {
  const nombre = m[1];
  // quitar comentarios pero guardarlos por línea
  const lineas = m[2].split('\n');
  let limpio = '';
  const notas = [];
  for (const l of lineas) {
    const i = l.indexOf('--');
    if (i >= 0) { notas.push({ texto: l.slice(0, i), nota: l.slice(i + 2).trim() }); limpio += l.slice(0, i) + '\n'; }
    else limpio += l + '\n';
  }
  const cols = [], restricciones = [];
  for (let seg of splitTop(limpio)) {
    seg = seg.replace(/\s+/g, ' ').trim();
    if (!seg) continue;
    if (/^(UNIQUE|CHECK|FOREIGN KEY|PRIMARY KEY)/i.test(seg)) { restricciones.push(seg); continue; }
    const [, col, resto] = seg.match(/^(\w+) (.*)$/);
    const tipoM = resto.match(/^(numeric\(\d+, ?\d+\)|[a-z]+)/i);
    const tipo = tipoM[1];
    const r = resto.slice(tipo.length);
    const c = {
      nombre: col, tipo,
      pk: /PRIMARY KEY/i.test(r),
      identidad: /GENERATED ALWAYS AS IDENTITY/i.test(r),
      notNull: /NOT NULL|PRIMARY KEY/i.test(r),
      unico: /\bUNIQUE\b/i.test(r),
      def: (r.match(/DEFAULT ((?:'[^']*'|[\w.()]+(?:\(\))?))/i) || [])[1] || null,
      fk: (r.match(/REFERENCES (\w+) \((\w+)\)( ON DELETE CASCADE)?/i) || null),
      check: (r.match(/CHECK \((.*)\)\s*$/i) || r.match(/CHECK \((.*)\)/i) || [])[1] || null
    };
    if (c.fk) c.fk = { tabla: c.fk[1], col: c.fk[2], cascade: !!c.fk[3] };
    cols.push(c);
  }
  tablas[nombre] = { nombre, cols, restricciones };
}

// ALTER TABLE ... ADD COLUMN
const reAlter = /ALTER TABLE (\w+)\s+ADD COLUMN (\w+) (\w+) ([^;]*);/g;
while ((m = reAlter.exec(sql))) {
  const r = m[4];
  tablas[m[1]].cols.push({
    nombre: m[2], tipo: m[3], pk: false, identidad: false, notNull: /NOT NULL/i.test(r), unico: false,
    def: (r.match(/DEFAULT ([\w()]+)/i) || [])[1] || null,
    fk: (() => { const f = r.match(/REFERENCES (\w+) \((\w+)\)/i); return f ? { tabla: f[1], col: f[2], cascade: false } : null; })(),
    check: null, agregada: true
  });
}

// FOREIGN KEY compuestas a nivel de tabla
for (const t of Object.values(tablas)) {
  for (const r of t.restricciones) {
    const f = r.match(/FOREIGN KEY \(([\w, ]+)\) REFERENCES (\w+) \(([\w, ]+)\)( ON DELETE CASCADE)?/i);
    if (!f) continue;
    const locales = f[1].split(',').map((s) => s.trim());
    const remotas = f[3].split(',').map((s) => s.trim());
    locales.forEach((lc, i) => {
      const c = t.cols.find((x) => x.nombre === lc);
      if (c && !c.fk) c.fk = { tabla: f[2], col: remotas[i], cascade: !!f[4], compuesta: true };
    });
  }
  const pk = t.restricciones.find((r) => /^PRIMARY KEY/i.test(r));
  if (pk) pk.match(/\(([\w, ]+)\)/)[1].split(',').map((s) => s.trim()).forEach((n) => { const c = t.cols.find((x) => x.nombre === n); c.pk = true; c.notNull = true; });
}

/* ---------- índices, RLS ---------- */
const indices = {};
const reIdx = /CREATE (UNIQUE )?INDEX (\w+)\s+ON (\w+) \(([^;]*?)\)( WHERE [^;]*)?;/g;
while ((m = reIdx.exec(sql))) (indices[m[3]] ||= []).push({ nombre: m[2], unico: !!m[1], cols: m[4].replace(/\s+/g, ' '), donde: (m[5] || '').replace(/\s+/g, ' ').trim() });
const rls = new Set([...sql.matchAll(/ALTER TABLE (\w+)\s+ENABLE ROW LEVEL SECURITY/g)].map((x) => x[1]));
const auditadas = new Set(sql.match(/FOREACH t IN ARRAY ARRAY\[([\s\S]*?)\]/)[1].match(/'(\w+)'/g).map((s) => s.replace(/'/g, '')));

/* ---------- validación contra descripciones ---------- */
const errores = [];
const todasEnGrupos = D.grupos.flatMap((g) => g.tablas);
for (const n of Object.keys(tablas)) {
  if (!todasEnGrupos.includes(n)) errores.push(`Tabla sin grupo: ${n}`);
  const d = D.tablas[n];
  if (!d) { errores.push(`Tabla sin descripción: ${n}`); continue; }
  for (const c of tablas[n].cols) if (!d.cols[c.nombre]) errores.push(`Columna sin descripción: ${n}.${c.nombre}`);
  for (const c of Object.keys(d.cols)) if (!tablas[n].cols.some((x) => x.nombre === c)) errores.push(`Descripción de columna inexistente: ${n}.${c}`);
  for (const c of d.usa) if (!tablas[n].cols.some((x) => x.nombre === c)) errores.push(`"usa" con columna inexistente: ${n}.${c}`);
}
for (const n of todasEnGrupos) if (!tablas[n]) errores.push(`Tabla en grupo que no existe en el SQL: ${n}`);
if (errores.length) { console.error(errores.join('\n')); process.exit(1); }

/* ---------- relaciones inversas ---------- */
const referidaPor = {};
for (const t of Object.values(tablas)) for (const c of t.cols) if (c.fk) (referidaPor[c.fk.tabla] ||= []).push(`${t.nombre}.${c.nombre}`);

/* ---------- HTML ---------- */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ESTADO = {
  conectado: ['ok', 'Conectada'], parcial: ['par', 'Parcial'], pendiente: ['pend', 'Pendiente'], interno: ['int', 'Uso interno de la BD']
};
const badge = (e) => `<span class="st ${ESTADO[e][0]}">${ESTADO[e][1]}</span>`;
const total = Object.keys(tablas).length;
const nCols = Object.values(tablas).reduce((a, t) => a + t.cols.length, 0);
const cuenta = (e) => Object.values(D.tablas).filter((t) => t.estado === e).length;
const colsUsadas = Object.values(D.tablas).reduce((a, t) => a + t.usa.length, 0);

function tablaHTML(n) {
  const t = tablas[n], d = D.tablas[n];
  const flags = [
    rls.has(n) ? '<span class="tag">Seguridad por fila (RLS)</span>' : '',
    auditadas.has(n) ? '<span class="tag">Auditada por trigger</span>' : '',
    n === 'registros_actividad' ? '<span class="tag">Inmutable</span>' : ''
  ].join('');
  const filas = t.cols.map((c) => {
    const llaves = [c.pk ? '<span class="k pk">PK</span>' : '', c.fk ? `<span class="k fk">FK</span>` : '', c.unico ? '<span class="k uq">UQ</span>' : ''].join('');
    const reglas = [
      c.identidad ? 'Autonumérico' : '',
      c.def ? `Por defecto <code>${esc(c.def)}</code>` : '',
      c.fk ? `→ <a href="#t-${c.fk.tabla}"><code>${c.fk.tabla}.${c.fk.col}</code></a>${c.fk.cascade ? ' (borrado en cascada)' : ''}` : '',
      c.check ? `Regla: <code>${esc(c.check)}</code>` : '',
      c.agregada ? 'Agregada con ALTER TABLE' : ''
    ].filter(Boolean).join('<br>');
    const usada = d.usa.includes(c.nombre);
    return `<tr class="${usada ? 'usada' : ''}">
      <td><code class="col">${c.nombre}</code>${llaves}</td>
      <td><code>${esc(c.tipo)}</code></td>
      <td class="c">${c.notNull ? 'No' : 'Sí'}</td>
      <td>${esc(d.cols[c.nombre])}${reglas ? `<div class="rg">${reglas}</div>` : ''}</td>
      <td class="c">${usada ? '<span class="dot ok" title="La app la usa hoy">●</span>' : '<span class="dot no" title="Aún no se usa">○</span>'}</td>
    </tr>`;
  }).join('');
  const restr = t.restricciones.filter((r) => !/^PRIMARY KEY/i.test(r));
  const idx = indices[n] || [];
  const ref = referidaPor[n] || [];
  return `
  <article class="tabla" id="t-${n}">
    <header class="th">
      <div><h3><code>${n}</code></h3><p>${esc(d.desc)}</p><div class="tags">${flags}</div></div>
      ${badge(d.estado)}
    </header>
    <div class="uso"><b>Uso en la app:</b> ${esc(d.app)}</div>
    <div class="tw"><table class="cols">
      <thead><tr><th>Columna</th><th>Tipo</th><th class="c">Nulo</th><th>Descripción y reglas</th><th class="c" title="Usada por la app hoy">App</th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>
    ${restr.length || idx.length || ref.length ? `<div class="extra">
      ${restr.length ? `<div><h4>Restricciones de tabla</h4><ul>${restr.map((r) => `<li><code>${esc(r)}</code></li>`).join('')}</ul></div>` : ''}
      ${idx.length ? `<div><h4>Índices</h4><ul>${idx.map((i) => `<li><code>${i.nombre}</code>${i.unico ? ' (único)' : ''}: <code>${esc(i.cols)}</code>${i.donde ? ` <span class="muted">${esc(i.donde)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
      ${ref.length ? `<div><h4>Referenciada por</h4><ul>${ref.map((r) => `<li><a href="#t-${r.split('.')[0]}"><code>${r}</code></a></li>`).join('')}</ul></div>` : ''}
    </div>` : ''}
  </article>`;
}

const toc = D.grupos.map((g) => `<li><a href="#g-${g.id}">${esc(g.t)}</a><ul>${g.tablas.map((n) => `<li><a href="#t-${n}"><code>${n}</code></a> <i class="mini ${ESTADO[D.tablas[n].estado][0]}"></i></li>`).join('')}</ul></li>`).join('');

const resumenFilas = D.grupos.flatMap((g) => g.tablas).map((n) => {
  const d = D.tablas[n];
  return `<tr><td><a href="#t-${n}"><code>${n}</code></a></td><td>${tablas[n].cols.length}</td><td>${d.usa.length}</td><td>${badge(d.estado)}</td><td>${rls.has(n) ? 'Sí' : '—'}</td><td>${auditadas.has(n) ? 'Sí' : '—'}</td></tr>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diccionario de datos · Easy Office</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@600;700&family=Albert+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{--green:#24D356;--green-dark:#18B644;--green-tint:#EAF9F0;--ink:#282828;--text:#333;--muted:#69727D;--line:#E4E7E9;--bg:#F5F7F7;
        --red:#D8402F;--red-tint:#FCEBE8;--amber:#B8790F;--amber-tint:#FBF0DC;--blue:#2E6FCE;--blue-tint:#E7EFFB;--shadow:0 5px 15px rgba(0,0,0,.07);}
  *{box-sizing:border-box;}
  html{scroll-behavior:smooth;}
  body{margin:0;background:var(--bg);color:var(--text);font-family:'Albert Sans',sans-serif;font-size:14.5px;line-height:1.55;}
  h1,h2,h3,h4{font-family:'Lora',serif;color:var(--ink);margin:0;}
  a{color:var(--green-dark);text-decoration:none;} a:hover{text-decoration:underline;}
  code{font-family:'IBM Plex Mono',monospace;font-size:12.5px;}
  .top{background:var(--ink);color:#fff;padding:40px 0 34px;}
  .wrap{max-width:1180px;margin:0 auto;padding:0 24px;}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:22px;font-size:13px;font-weight:700;letter-spacing:.6px;}
  .brand small{display:block;font-size:9.5px;letter-spacing:2.2px;color:#8E969D;font-weight:500;margin-top:3px;}
  .top h1{color:#fff;font-size:34px;}
  .top p{color:#C2C9CF;max-width:760px;margin:12px 0 0;}
  .top code{background:rgba(255,255,255,.12);color:#fff;padding:1px 5px;border-radius:3px;}
  .layout{display:grid;grid-template-columns:250px 1fr;gap:28px;align-items:start;padding-top:26px;padding-bottom:60px;}
  nav.toc{position:sticky;top:16px;background:#fff;box-shadow:var(--shadow);padding:16px 14px;font-size:13px;max-height:calc(100vh - 32px);overflow:auto;}
  nav.toc h4{font-family:'Albert Sans',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 8px;}
  nav.toc ul{list-style:none;margin:0;padding:0;}
  nav.toc > ul > li{margin-bottom:8px;}
  nav.toc > ul > li > a{font-weight:600;color:var(--ink);}
  nav.toc ul ul{padding-left:10px;margin-top:3px;}
  nav.toc ul ul li{padding:1px 0;}
  nav.toc ul ul a{color:var(--muted);}
  .mini{display:inline-block;width:7px;height:7px;border-radius:50%;vertical-align:1px;margin-left:4px;}
  .mini.ok{background:var(--green);} .mini.par{background:var(--amber);} .mini.pend{background:#C3C9CE;} .mini.int{background:var(--blue);}
  section{margin-bottom:34px;}
  .sec-h{margin-bottom:14px;} .sec-h h2{font-size:23px;} .sec-h p{color:var(--muted);margin:6px 0 0;max-width:820px;}
  .panel{background:#fff;box-shadow:var(--shadow);padding:20px;}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px;}
  .kpi{background:#fff;box-shadow:var(--shadow);padding:14px 16px;border-top:3px solid var(--green);}
  .kpi .v{font-family:'Lora',serif;font-size:28px;font-weight:700;color:var(--ink);line-height:1.1;}
  .kpi .l{font-size:12px;color:var(--muted);}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th{text-align:left;font-size:10.5px;color:var(--muted);font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:8px 9px;border-bottom:2px solid var(--line);}
  td{padding:9px;border-bottom:1px solid var(--line);vertical-align:top;}
  tr:last-child td{border-bottom:none;}
  .c{text-align:center;}
  .tw{overflow-x:auto;}
  .st{font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;}
  .st.ok{background:var(--green-tint);color:var(--green-dark);} .st.par{background:var(--amber-tint);color:var(--amber);}
  .st.pend{background:#EDEFF0;color:#5B646C;} .st.int{background:var(--blue-tint);color:var(--blue);}
  .flow{display:grid;grid-template-columns:repeat(5,1fr);gap:0;margin:6px 0 4px;}
  .fs{background:#fff;box-shadow:var(--shadow);padding:14px;border-right:1px solid var(--line);}
  .fs:last-child{border-right:none;}
  .fs .n{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--green-dark);}
  .fs .t{font-weight:700;color:var(--ink);margin:3px 0;}
  .fs .d{font-size:12.5px;color:var(--muted);}
  pre{background:#1F2326;color:#E6E9EB;padding:14px 16px;font-size:12.5px;overflow-x:auto;margin:12px 0 0;border-radius:3px;}
  pre code{font-size:12.5px;}
  .tabla{background:#fff;box-shadow:var(--shadow);margin-bottom:18px;}
  .th{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:16px 18px 10px;}
  .th h3{font-size:17px;} .th h3 code{font-size:16px;font-family:'IBM Plex Mono',monospace;}
  .th p{margin:4px 0 0;color:var(--muted);font-size:13.5px;max-width:820px;}
  .tags{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;}
  .tag{font-size:10.5px;font-weight:600;border:1px solid var(--line);border-radius:3px;padding:1px 7px;color:var(--muted);}
  .uso{margin:0 18px 10px;padding:10px 12px;background:var(--green-tint);border-left:3px solid var(--green);font-size:13px;}
  .cols td:first-child{white-space:nowrap;}
  .cols code.col{font-weight:500;color:var(--ink);}
  .cols tr.usada td:first-child{box-shadow:inset 3px 0 0 var(--green);}
  .k{font-size:9.5px;font-weight:700;border-radius:3px;padding:1px 4px;margin-left:5px;vertical-align:1px;}
  .k.pk{background:var(--ink);color:#fff;} .k.fk{background:var(--blue-tint);color:var(--blue);} .k.uq{background:var(--amber-tint);color:var(--amber);}
  .rg{font-size:12px;color:var(--muted);margin-top:4px;}
  .rg code{font-size:11.5px;word-break:break-word;}
  .dot.ok{color:var(--green);} .dot.no{color:#C3C9CE;}
  .extra{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:12px 18px 16px;border-top:1px solid var(--line);font-size:12.5px;}
  .extra h4{font-family:'Albert Sans',sans-serif;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:4px;}
  .extra ul{margin:0;padding-left:16px;} .extra code{font-size:11.5px;word-break:break-word;}
  .muted{color:var(--muted);}
  .grupo-h{font-size:19px;margin:26px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--green);}
  .leyenda{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin-top:12px;}
  footer{color:var(--muted);font-size:12px;padding:20px 0 40px;}
  @media(max-width:960px){.layout{grid-template-columns:1fr;} nav.toc{position:static;max-height:none;} .kpis{grid-template-columns:1fr 1fr;} .flow{grid-template-columns:1fr;} .fs{border-right:none;border-bottom:1px solid var(--line);} .extra{grid-template-columns:1fr;}}
  @media print{body{background:#fff;font-size:11.5px;} nav.toc{display:none;} .layout{grid-template-columns:1fr;} .tabla,.panel,.kpi,.fs{box-shadow:none;border:1px solid var(--line);} .tabla{break-inside:avoid-page;} .top{padding:16px 0;}}
</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <div class="brand"><svg width="34" height="20" viewBox="0 0 34 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="#24D356" stroke-width="3"/><circle cx="23" cy="10" r="7.5" stroke="#24D356" stroke-width="3"/></svg><div>EASY OFFICE<small>BASE DE DATOS EO_ER</small></div></div>
    <h1>Diccionario de datos y uso en la aplicación</h1>
    <p>Generado desde <code>easyoffice_er.sql</code> (PostgreSQL 18): tablas, columnas, tipos, reglas, relaciones, seguridad y automatizaciones, con la explicación de cómo los usa la aplicación web de <code>EasyOfficeWIP</code> (arquitectura por capas, Node.js).</p>
  </div>
</header>

<div class="wrap layout">
  <nav class="toc" aria-label="Índice">
    <h4>Contenido</h4>
    <ul>
      <li><a href="#resumen">Resumen</a></li>
      <li><a href="#como">Cómo se conecta la app</a></li>
      <li><a href="#seguridad">Seguridad y roles</a></li>
      ${toc}
      <li><a href="#vistas">Vistas</a></li>
      <li><a href="#funciones">Funciones</a></li>
      <li><a href="#triggers">Automatizaciones (triggers)</a></li>
    </ul>
  </nav>

  <main>
    <section id="resumen">
      <div class="sec-h"><h2>Resumen</h2><p>Estado de integración de cada tabla con la aplicación al ${new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}. "Conectada" = la app la lee o escribe; "Parcial" = solo algunas columnas; "Pendiente" = prevista para los próximos módulos del CRM; "Uso interno" = solo la usan los triggers.</p></div>
      <div class="kpis">
        <div class="kpi"><div class="v">${total}</div><div class="l">tablas · ${nCols} columnas</div></div>
        <div class="kpi"><div class="v">${cuenta('conectado') + cuenta('parcial')}</div><div class="l">tablas usadas por la app (${cuenta('parcial')} parcialmente)</div></div>
        <div class="kpi"><div class="v">${colsUsadas}</div><div class="l">columnas leídas o escritas hoy</div></div>
        <div class="kpi"><div class="v">${rls.size}</div><div class="l">tablas con seguridad por fila</div></div>
      </div>
      <div class="panel tw"><table>
        <thead><tr><th>Tabla</th><th>Columnas</th><th>Usadas</th><th>Estado en la app</th><th>RLS</th><th>Auditada</th></tr></thead>
        <tbody>${resumenFilas}</tbody>
      </table></div>
    </section>

    <section id="como">
      <div class="sec-h"><h2>Cómo se conecta la aplicación</h2><p>El backend está organizado por capas y solo la capa de datos habla con PostgreSQL. Cada petición del CRM recorre este camino:</p></div>
      <div class="flow">
        <div class="fs"><div class="n">01 · public/</div><div class="t">Navegador</div><div class="d">crm.js llama a <code>/api/crm/...</code> con la cookie de sesión.</div></div>
        <div class="fs"><div class="n">02 · presentacion/</div><div class="t">Ruta y controlador</div><div class="d">Valida la sesión y pasa los datos al servicio. No escribe SQL.</div></div>
        <div class="fs"><div class="n">03 · negocio/</div><div class="t">Servicio</div><div class="d">Aplica reglas (quién puede qué, filtros válidos) y abre la transacción con <code>conUsuario()</code>.</div></div>
        <div class="fs"><div class="n">04 · datos/</div><div class="t">Repositorio</div><div class="d">Ejecuta el SQL con parámetros y convierte los tipos.</div></div>
        <div class="fs"><div class="n">05 · EO_ER</div><div class="t">PostgreSQL</div><div class="d">Aplica RLS, CHECK, triggers y auditoría con la identidad del usuario.</div></div>
      </div>
      <div class="panel" style="margin-top:14px;">
        <b>Qué hace <code>conUsuario()</code> en cada transacción</b> (<code>src/datos/conexion.js</code>):
<pre><code>BEGIN;
SELECT set_config('app.usuario_actual', '&lt;id del usuario&gt;', true),
       set_config('app.rol_actual',     '&lt;rol de la tabla roles&gt;', true);
SET LOCAL ROLE rol_admin;        -- o rol_ejecutivo, según el rol
-- ... consultas del repositorio ...
COMMIT;                          -- ROLLBACK si algo falla</code></pre>
        <p style="margin:12px 0 0;font-size:13px;">Así <code>app_usuario()</code> y <code>app_es_admin()</code> devuelven al usuario real: las políticas RLS filtran las filas, los GRANT limitan lo que puede hacer el rol, y los triggers de auditoría registran el autor de cada cambio. El inicio de sesión y el registro de LOGIN/LOGOUT usan la conexión directa (antes de conocer al usuario). Los errores de PostgreSQL se traducen a mensajes claros: <code>42501</code> sin permiso, <code>23503</code> registro con dependencias, <code>23505</code> duplicado, <code>23514</code> dato que no cumple una regla (p. ej. RUT inválido).</p>
      </div>
    </section>

    <section id="seguridad">
      <div class="sec-h"><h2>Seguridad y roles</h2><p>La base de datos define dos roles de PostgreSQL. La app elige uno según el rol del usuario en la tabla <a href="#t-roles"><code>roles</code></a>: "admin" y "dueno" trabajan como <code>rol_admin</code>; cualquier otro, como <code>rol_ejecutivo</code>.</p></div>
      <div class="panel tw"><table>
        <thead><tr><th>Rol de BD</th><th>Puede</th><th>No puede</th><th>Qué ve</th></tr></thead>
        <tbody>
          <tr><td><code>rol_admin</code></td><td>Todo sobre todas las tablas, incluida la lectura de auditoría.</td><td>Modificar o borrar <code>registros_actividad</code>.</td><td>Todas las filas (<code>app_es_admin()</code> es verdadero).</td></tr>
          <tr><td><code>rol_ejecutivo</code></td><td>Leer, crear y modificar clientes, representantes, direcciones, contratos, servicios del contrato, documentos, partes, cláusulas y pagos; leer y actualizar alertas; leer catálogos y vistas.</td><td>Eliminar nada; leer <code>password_hash</code>, auditoría o <code>folios_correlativos</code>.</td><td>Solo su cartera: contratos donde es ejecutivo, sus documentos y los clientes, pagos, alertas y partes ligados a ellos.</td></tr>
        </tbody>
      </table></div>
      <div class="panel tw" style="margin-top:14px;"><table>
        <thead><tr><th>Política RLS</th><th>Tabla</th><th>Una fila es visible si…</th></tr></thead>
        <tbody>
          <tr><td><code>p_contratos</code></td><td><a href="#t-contratos">contratos</a></td><td>el usuario es su <code>ejecutivo_id</code>, o es administrador.</td></tr>
          <tr><td><code>p_documentos</code></td><td><a href="#t-documentos">documentos</a></td><td>el usuario es su ejecutivo, es administrador, o el documento pertenece a un contrato visible.</td></tr>
          <tr><td><code>p_clientes</code></td><td><a href="#t-clientes">clientes</a></td><td>el usuario lo registró, es administrador, o el cliente tiene un contrato o documento visible.</td></tr>
          <tr><td><code>p_representantes</code></td><td><a href="#t-representantes_legales">representantes_legales</a></td><td>lo registró, es administrador, o representa a un cliente, a una emisora o a un propietario.</td></tr>
          <tr><td><code>p_contrato_servicios</code>, <code>p_alertas</code></td><td>contrato_servicios, alertas</td><td>su contrato es visible.</td></tr>
          <tr><td><code>p_documento_partes</code>, <code>p_documento_clausulas</code></td><td>documento_partes, documento_clausulas</td><td>su documento es visible.</td></tr>
          <tr><td><code>p_pagos</code></td><td><a href="#t-pagos">pagos</a></td><td>su contrato o su documento es visible.</td></tr>
        </tbody>
      </table></div>
      <p class="muted" style="font-size:13px;">Además de la base de datos, la capa de negocio repite las reglas importantes para dar mensajes claros: solo administradores eliminan clientes y ven auditoría (<code>src/negocio/servicios/clientes.servicio.js</code>, <code>auditoria.servicio.js</code>).</p>
    </section>

    <section id="tablas">
      <div class="sec-h"><h2>Tablas</h2><p>En cada tabla, las columnas marcadas con <span class="dot ok">●</span> y borde verde son las que la app usa hoy. <span class="k pk">PK</span> clave primaria · <span class="k fk">FK</span> clave foránea · <span class="k uq">UQ</span> valor único.</p>
        <div class="leyenda">${Object.values(ESTADO).map(([c, t]) => `<span><span class="st ${c}">${t}</span></span>`).join('')}</div>
      </div>
      ${D.grupos.map((g) => `<h2 class="grupo-h" id="g-${g.id}">${esc(g.t)}</h2>${g.tablas.map(tablaHTML).join('')}`).join('')}
    </section>

    <section id="vistas">
      <div class="sec-h"><h2>Vistas</h2><p>Todas usan <code>security_invoker</code>: respetan los permisos y la seguridad por fila de quien consulta.</p></div>
      <div class="panel tw"><table>
        <thead><tr><th>Vista</th><th>Qué entrega</th><th>Uso en la app</th><th>Estado</th></tr></thead>
        <tbody>${Object.entries(D.vistas).map(([n, v]) => `<tr><td><code>${n}</code></td><td>${esc(v.desc)}</td><td>${esc(v.app)}</td><td>${badge(v.estado)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    <section id="funciones">
      <div class="sec-h"><h2>Funciones</h2></div>
      <div class="panel tw"><table>
        <thead><tr><th>Función</th><th>Devuelve</th><th>Qué hace</th><th>Uso en la app</th><th>Estado</th></tr></thead>
        <tbody>${D.funciones.map(([n, r, d, a, e]) => `<tr><td><code>${esc(n)}</code></td><td><code>${r}</code></td><td>${esc(d)}</td><td>${esc(a)}</td><td>${badge(e)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    <section id="triggers">
      <div class="sec-h"><h2>Automatizaciones (triggers)</h2><p>Reglas que la base de datos ejecuta sola. La app no las reprograma: solo inserta o actualiza y deja que PostgreSQL complete folio, vencimiento, precios, alertas y auditoría.</p></div>
      <div class="panel tw"><table>
        <thead><tr><th>Trigger</th><th>Tabla</th><th>Cuándo</th><th>Qué hace</th></tr></thead>
        <tbody>${D.triggers.map(([n, t, c, d]) => `<tr><td><code>${esc(n)}</code></td><td>${esc(t)}</td><td>${esc(c)}</td><td>${esc(d)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    <footer>Easy Office · Proyecto Capstone · Diccionario generado automáticamente desde <code>easyoffice_er.sql</code>; las descripciones de uso reflejan el código de <code>EasyOfficeWIP/src</code>.</footer>
  </main>
</div>
</body>
</html>`;

fs.writeFileSync(OUT, html);
console.log(`OK: ${total} tablas, ${nCols} columnas, ${colsUsadas} usadas, ${Object.values(indices).flat().length} índices, RLS en ${rls.size}, auditadas ${auditadas.size}`);
