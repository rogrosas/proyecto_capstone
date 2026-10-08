# Easy Office · Front end (WIP)

Sitio web de Easy Office hecho con **HTML, CSS y JavaScript**, servido con **Node.js (Express)**.
Se basa en los mockups de `Desarrollo/MuckUps` y en el contenido del sitio actual (easyoffice.cl).

## Cómo correrlo

```bash
npm install
npm run dev      # se reinicia solo al guardar
```

Abrir <http://localhost:3000>. Otro puerto: `PORT=8080 npm start`.

## Páginas

| URL | Archivo | Origen |
|---|---|---|
| `/` | `public/index.html` | sitio actual |
| `/domicilio-tributario` | `public/domicilio-tributario.html` | sitio actual |
| `/contabilidad` | `public/contabilidad.html` | sitio actual |
| `/firmas-electronicas` | `public/firmas-electronicas.html` | sitio actual |
| `/asesoria-empresas` | `public/asesoria-empresas.html` | sitio actual |
| `/rebaja-tributaria` | `public/rebaja-tributaria.html` | sitio actual |
| `/contratar` (`?plan=<id>` preselecciona) | `public/contratar.html` | `ecommerce_easyoffice.html` |
| `/mi-cuenta` | `public/mi-cuenta.html` | `panel_cliente_easyoffice.html` |
| `/crm` | `public/crm.html` | `crm_easyoffice.html` |
| `/api/catalogo` | `server.js` | catálogo en JSON |

Los accesos (inicio de sesión, pagos, formulario de contacto) son **de demostración**: no validan ni envían datos.

## Estructura

```
EasyOfficeWIP/
├── server.js            # Node.js: sirve /public y la API
├── package.json
├── public/              # todo lo que ve el navegador
│   ├── *.html           # una página por archivo
│   ├── css/
│   │   ├── base.css     # colores, tipografía, botones, tablas, formularios
│   │   ├── sitio.css    # cabecera, pie, hero, tarjetas de plan
│   │   ├── contratar.css
│   │   ├── cuenta.css
│   │   └── crm.css
│   ├── js/
│   │   ├── layout.js    # cabecera y pie comunes (menú, teléfono, correo, redes)
│   │   ├── catalogo.js  # ÚNICA fuente de planes y precios (navegador + servidor)
│   │   ├── planes.js    # dibuja las tarjetas de planes en las páginas de servicio
│   │   ├── contratar.js # flujo de compra en 4 pasos
│   │   ├── cuenta.js    # panel del cliente
│   │   ├── crm.js       # CRM
│   │   └── contacto.js  # formulario del inicio
│   └── img/             # imágenes con nombres descriptivos
└── referencia/          # sitio WordPress original (sólo consulta, no se publica)
    ├── site/
    └── tools/mirror.py  # script Python que descarga el sitio original
```

## Dónde cambiar cosas

- **Precios o planes** → `public/js/catalogo.js`. Cambia en las páginas de servicio, en `/contratar` y en la API.
- **Menú, teléfono, correo, horario, redes** → objeto `SITIO` al inicio de `public/js/layout.js`.
- **Colores y fuentes** → variables `:root` en `public/css/base.css`.
- **Nueva página** → copiar una página de servicio, cambiar `data-activo` en `<header id="cabecera">`
  y agregarla al menú en `layout.js`.

## Sitio anterior

```bash
python -m http.server 8080 -d referencia/site
```
