# Easy Office · Front end (WIP)

Sitio web de Easy Office hecho con **HTML, CSS y JavaScript**, servido con **Node.js (Express)**.
Se basa en los mockups de `Desarrollo/MuckUps` y en el contenido del sitio actual (easyoffice.cl).

## Cómo correrlo

```bash
npm install
npm run dev      # se reinicia solo al guardar
```

Abrir <http://localhost:3000>. Otro puerto: `PORT=8080 npm start`.

## Base de datos (CRM)

El CRM (`/crm`) lee y escribe en la base **EO_ER** de PostgreSQL (la de pgAdmin 4), creada con
`Desarrollo/base de datos/easyoffice_v2.sql`. Datos de ejemplo: `easyoffice_v2_datos_muestra.sql` (clientes y contratos
reales de la muestra, más correos ficticios `.test` para probar el portal). `easyoffice_datos_muestra.sql` es solo para el
esquema anterior (`easyoffice_er.sql`).

1. Completar `PGPASSWORD` en el archivo `.env` (copia de `.env.example`; no se sube a git).
2. `npm run db:revisar` → comprueba la conexión, los roles y los usuarios del personal.
3. `npm run crear-usuario` → crea un usuario del CRM (o restablece su contraseña). La contraseña se
   guarda solo como hash bcrypt en `usuarios.password_hash`.
4. `npm run dev` y entrar a <http://localhost:3000/crm>.

Cada consulta corre con el rol del usuario (`rol_admin` o `rol_ejecutivo`) y con `app.usuario_actual`,
así PostgreSQL aplica la seguridad por fila (el ejecutivo ve solo su cartera) y registra la auditoría.
Los usuarios cuyo rol se llama `admin` o `dueno` ven todo.

Lo que el modelo aún no tiene (correspondencia, saldo de firmas) no se conectó:
la sección Correspondencia del CRM y del portal lo indica.

## Contratos Word (reemplaza Excel + combinar correspondencia)

Las plantillas y los contratos generados viven en la carpeta `Desarrollo/base de datos/Contratos`
(configurable con `CONTRATOS_DIR` en `.env`). **La base de datos solo guarda su ubicación, relativa a esa carpeta**:

| Qué | Dónde se guarda la ubicación | Ejemplo |
|---|---|---|
| Plantilla Word | `plantillas_documento.archivo_base` | `CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx` |
| Contrato generado | `documentos.url_archivo` (+ `documento_versiones` con hash si la BD es v2) | `generados/2026/LF-0152-2026 Contrato de servicios oficina_v1.docx` |

1. **Administración → Plantillas de documento**: se elige el `.docx` de la carpeta (o se sube uno nuevo, queda en `plantillas/`).
2. **Contrato → "Generar contrato Word"**: llena los campos `MERGEFIELD` del Word (los mismos del Excel:
   `FOLIO`, `RAZON_SOCIAL`, `SERVICIO_1`…) con los datos de `v_datos_contrato`, quita el enlace al Excel y guarda el
   archivo en `generados/<año>/`. El documento queda en *borrador*; si se vuelve a generar se crea la versión siguiente
   (las anteriores se conservan). No se regenera un documento en revisión, aprobado, enviado a firma o firmado.
3. El archivo se descarga desde el detalle del contrato o del documento (`GET /api/crm/documentos/:id/archivo`),
   respetando la cartera del ejecutivo.

El código está en `src/datos/archivos.js` (carpeta, sin permitir rutas fuera de ella), `src/datos/word.js`
(combinación) y `src/negocio/servicios/archivos.servicio.js` (equivalencia campo del Word → dato de la base).
`generados/` está en `.gitignore`: contiene datos personales de clientes.

## Documentos de la tienda (Word → borrador con marca de agua → aceptación)

Base de datos: `easyoffice_v2.sql` ya lo trae; una base anterior necesita
`Desarrollo/base de datos/easyoffice_v2_documentos_tienda.sql` (tablas `plantilla_planes` y `tickets`,
columnas `entrega`/`mapa_campos` en plantillas y `estado_cliente`/`aceptado_*` en documentos).

1. **CRM → Administración → Documentos de la tienda** (solo admin): se sube el `.docx` (queda en
   `base de datos/Contratos/plantillas/`), se vincula a uno o más **planes de la tienda** y se elige la **entrega**:
   - *Automática*: al comprar, el cliente recibe el borrador para revisarlo.
   - *Con revisión*: al comprar queda esperando que el personal lo revise y lo publique.
2. **Dónde van los datos**: se detectan los campos de combinación de Word y los textos entre corchetes
   (`[RAZÓN SOCIAL DE LA EMPRESA]`, `[RUT EMPRESA]`, `[FECHA]`…) y se sugiere el dato del cliente que corresponde
   (diccionario y sinónimos en `src/negocio/camposDocumento.js`). Lo que no es dato del cliente se marca como
   *lo responde el cliente en la tienda*, *lo completa el personal al generar* o *dejar tal cual*.
3. **Tienda** (`/contratar`): la compra se guarda de verdad (cliente `origen = 'web'` con su domicilio, contrato
   `pendiente`, pago `pendiente` —el cobro sigue siendo de demostración— y los documentos del plan). Si el plan aún no
   tiene servicio en la base (`servicios.codigo` = id del plan en `catalogo.js`), se crea. Si el comprador no tiene
   contraseña de Mi cuenta, recibe el enlace para crearla. Un RUT que ya es cliente solo compra con un correo vinculado.
4. **Mi cuenta → Mis documentos**: el cliente siempre ve primero un **borrador con marca de agua** (HTML generado desde
   el Word con `mammoth`; el `.docx` no se entrega aún), marca *"he leído el borrador y estoy de acuerdo"* y lo acepta
   → descarga el Word final. Si no está de acuerdo envía un **ticket** (el documento queda "objetado").
5. **CRM → Tickets de clientes** y el detalle del documento: el personal responde (le llega por correo), corrige,
   genera una nueva versión desde el contrato y vuelve a publicar. No se regenera un documento ya aceptado.

Una persona natural comparece por sí: en las plantillas pensadas para empresas, los datos del "representante" son
los suyos.

API: `GET /api/tienda/planes/:codigo/preguntas`, `GET /api/tienda/comunas`, `POST /api/tienda/compras` ·
portal: `GET /api/cliente/documentos/:id/borrador`, `POST …/aceptar`, `POST …/ticket`, `GET …/archivo`,
`GET|POST /api/cliente/tickets` · CRM: `GET /documentos/:id/borrador`, `POST /documentos/:id/publicar`,
`GET /tickets`, `PATCH /tickets/:id`, `GET /plantillas/:id/preguntas`, `GET /admin/documentos-tienda`,
`GET /admin/plantillas/:id/campos`, `PUT /admin/plantillas/:id/tienda`.

## Portal de clientes (`/mi-cuenta`)

Al entrar se elige **Empresa** o **Persona**:

| Tipo | Ingresa con | Quién puede |
|---|---|---|
| Empresa (`clientes.tipo_persona = 'juridica'`) | RUT de la empresa + su correo + contraseña | El representante legal (`representantes_legales.email`) y las personas que el ejecutivo autorice en la ficha del cliente |
| Persona (`'natural'`) | Correo + contraseña | El propio cliente (`clientes.email`) |

Las contraseñas están en la tabla **`cuentas_portal`** (bcrypt, una por persona y por cliente: quien representa a
varias empresas tiene una contraseña en cada una). Una base creada con una versión anterior de `easyoffice_v2.sql`
necesita el script `Desarrollo/base de datos/easyoffice_v2_cuentas_portal.sql` (en pgAdmin: Query Tool sobre EO_ER → F5).

1. **Crear o recuperar contraseña**: la persona indica tipo, (RUT) y correo. Si está vinculada, recibe un enlace
   por cada cliente. La respuesta es siempre la misma, exista o no la cuenta.
2. El enlace lleva un token firmado (HMAC con `CLIENTE_SECRETO`), vence en 15 minutos, sirve una vez y deja de
   servir si la persona ya no está vinculada. Al abrirlo define su contraseña y queda con la sesión iniciada.
3. **Ingresar**: tipo, (RUT), correo y contraseña. El mensaje de error no dice qué dato falló. Máximo 10 intentos
   cada 15 minutos por IP y por correo.
4. La sesión de cliente usa la cookie `eo_cli`, separada de la del personal. El panel muestra servicios vigentes,
   documentos, pagos y datos con consultas de **solo lectura** filtradas por el `cliente_id` de la sesión.
   Los ingresos y salidas quedan en `registros_actividad`.

En el CRM, la ficha del cliente tiene la sección **Acceso al portal**: muestra quién puede ingresar, si ya creó su
contraseña y su último ingreso; permite **autorizar personas** (solo empresas), quitarlas y **bloquear** un acceso.

Configuración en `.env`: `APP_URL` (para armar el enlace), `CLIENTE_SECRETO` y `SMTP_*`.
**Sin SMTP** (desarrollo) los correos se guardan en `correos-dev/` y el enlace aparece en la consola
del servidor; con un servidor SMTP (Gmail/Workspace, Brevo, etc.) se envían de verdad.

API: `POST /api/cliente/ingresar`, `POST /api/cliente/clave` (pide el enlace), `POST /api/cliente/clave/definir`,
`POST /api/cliente/salir`, `GET /api/cliente/yo`, `GET /api/cliente/panel`.

### Módulos del CRM y tablas que usan

| Módulo | Qué permite | Tablas / vistas |
|---|---|---|
| Dashboard | Indicadores, vencimientos, pendientes del día, carga por ejecutivo | contratos, contrato_servicios, alertas, documentos, pagos, usuarios |
| Clientes | Listado, ficha, alta y edición con representante y domicilio; acceso al portal (personas autorizadas, bloqueo) | clientes, representantes_legales, direcciones, comunas, regiones, cuentas_portal |
| Contratos | Alta (folio, vencimiento y alertas los pone la BD), servicios, edición, renovación, alertas, pagos, impresión | contratos, contrato_servicios, alertas, pagos, v_saldo_contrato, v_datos_contrato, v_datos_contrato_servicios |
| Renovaciones | Etapas D-60 a D+30, avisos, saldo, renovar | contratos, alertas, v_saldo_contrato |
| Documentos | Alta desde plantilla con partes y cláusulas; revisión, aprobación, firma con código de verificación | documentos, documento_partes, documento_clausulas, plantillas_documento, clausulas_documento |
| Ventas y pagos | Pagos y cuotas por pasarela; cambio de estado | pagos |
| Auditoría (admin) | Bitácora de cambios, ingresos y salidas | registros_actividad |
| Administración (admin) | Usuarios, roles y permisos, y 13 catálogos (servicios, plantillas, cláusulas, emisoras, sucursales, cuentas, propietarios, representantes, regiones, comunas, permisos, plazos de alertas, correlativos de folio) | usuarios, roles, permisos, roles_permisos y las tablas de cada catálogo |

El detalle por tabla y columna está en `Desarrollo/base de datos/diccionario_datos_easyoffice.html`
(se regenera con `npm run db:diccionario`; el uso en la app se describe en `scripts/diccionario/uso-app.js`).

### API del CRM (`/api/crm`, requiere sesión)

| Recurso | Rutas |
|---|---|
| Sesión | `POST /login`, `POST /logout`, `GET /yo` |
| Listas para formularios | `GET /opciones` |
| Clientes | `GET/POST /clientes`, `GET/PUT/DELETE /clientes/:id`, `PUT /clientes/:id/accesos` |
| Contratos | `GET/POST /contratos`, `GET/PATCH /contratos/:id`, `POST /contratos/:id/servicios`, `DELETE /contratos/:id/servicios/:csId`, `POST /contratos/:id/renovar`, `GET /contratos/:id/impresion`, `POST /contratos/:id/notificar-alertas`, `POST /alertas/:id/notificar`, `GET /renovaciones` |
| Documentos | `GET/POST /documentos`, `GET /documentos/:id`, `POST /documentos/:id/aprobar`, `POST /documentos/:id/estado` |
| Pagos | `GET /ventas`, `POST /pagos`, `PATCH /pagos/:id` |
| Auditoría | `GET /auditoria` |
| Administración | `GET/POST /admin/usuarios`, `PATCH /admin/usuarios/:id`, `GET/POST /admin/roles`, `PUT/DELETE /admin/roles/:id`, `GET /admin/catalogos`, `GET/POST /admin/catalogos/:nombre`, `PUT/DELETE /admin/catalogos/:nombre/:clave` |

El front end del CRM está en `public/js/crm/` (ES modules): `main.js` arma el menú y carga un módulo
por sección desde `modulos/`; `modal.js` genera los formularios; `api.js` llama a la API.

## Páginas

| URL | Archivo | Origen |
|---|---|---|
| `/` | `public/index.html` | sitio actual |
| `/domicilio-tributario` | `public/domicilio-tributario.html` | sitio actual |
| `/contabilidad` | `public/contabilidad.html` | sitio actual |
| `/firmas-electronicas` | `public/firmas-electronicas.html` | sitio actual |
| `/asesoria-empresas` | `public/asesoria-empresas.html` | sitio actual |
| `/rebaja-tributaria` | `public/rebaja-tributaria.html` | sitio actual |
| `/contratar` (`?plan=<id>` preselecciona) — guarda la compra | `public/contratar.html` | `ecommerce_easyoffice.html` |
| `/mi-cuenta` | `public/mi-cuenta.html` | `panel_cliente_easyoffice.html` |
| `/crm` | `public/crm.html` | `crm_easyoffice.html` |
| `/api/catalogo` | `server.js` | catálogo en JSON |

El **cobro** de la tienda y el formulario de contacto del inicio son **de demostración**: la compra se guarda, pero el pago queda pendiente hasta que el personal lo confirme.

## Arquitectura por capas

```
 Navegador ──HTTP──▶ PRESENTACIÓN ──▶ NEGOCIO ──▶ DATOS ──SQL──▶ PostgreSQL (EO_ER)
 (public/)           rutas            servicios   repositorios
                     controladores    reglas      conexión
                     middleware       roles       (rol + app.usuario_actual)
```

Cada capa solo llama a la de abajo: un controlador nunca escribe SQL y un repositorio nunca
conoce Express ni las reglas de negocio.

| Capa | Carpeta | Qué hace | Qué NO hace |
|---|---|---|---|
| Presentación (cliente) | `public/` | HTML, CSS y JS del navegador; llama a `/api` | Acceder a la BD |
| Presentación (servidor) | `src/presentacion/` | Rutas, controladores (petición → servicio → JSON), sesión por cookie, errores HTTP | Reglas ni SQL |
| Negocio | `src/negocio/` | Casos de uso y reglas: quién puede qué, validaciones, límites, sesiones; abre la transacción con la identidad del usuario | HTTP ni SQL |
| Datos | `src/datos/` | Conexión, repositorios con el SQL, conversión de tipos, traducción de errores de PostgreSQL | Reglas de negocio |
| Transversal | `src/config/`, `src/comun/` | Configuración y `AppError` | — |

```
src/
├── app.js                          # ensambla Express con las capas
├── config/index.js                 # puerto, sesión, límites, roles admin
├── comun/errores.js                # AppError compartido
├── presentacion/
│   ├── rutas/        crm.rutas.js, catalogo.rutas.js
│   ├── controladores/ auth, crm, administracion, catalogo
│   └── middleware/   sesion.js, cookies.js, errores.js
├── negocio/
│   ├── roles.js                    # esAdmin (igual que app_es_admin() de la BD)
│   ├── validacion.js               # RUT, celular, fechas, montos (igual que los CHECK de la BD)
│   ├── catalogos.definiciones.js   # lista blanca de catálogos editables en Administración
│   └── servicios/    auth, dashboard, opciones, clientes, contratos, renovaciones, documentos, pagos, auditoria, administracion, catalogos, catalogo
└── datos/
    ├── conexion.js                 # pool, conUsuario(), traducción de errores
    ├── conversion.js               # numeric/count de pg -> Number
    ├── sql/fragmentos.js           # SQL reutilizado
    └── repositorios/ usuarios, sesiones, roles, dashboard, opciones, clientes, representantes, direcciones, contratos, alertas, documentos, pagos, auditoria, catalogos, catalogo
```

**Agregar un módulo nuevo** (por ejemplo, registrar pagos): repositorio en `datos/repositorios/` con el
SQL → servicio en `negocio/servicios/` con las validaciones y `conUsuario()` → función en el controlador →
ruta en `crm.rutas.js` → pantalla en `public/`.

## Estructura de archivos

```
EasyOfficeWIP/
├── server.js            # punto de entrada (levanta src/app.js)
├── package.json
├── .env.example         # plantilla de conexión a PostgreSQL (.env no se sube)
├── scripts/             # herramientas: db:revisar, crear-usuario
├── src/                 # backend por capas (ver arriba)
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
│   │   ├── crm/         # CRM: main.js, api.js, modal.js, util.js, direccion.js, impresion.js y modulos/
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
