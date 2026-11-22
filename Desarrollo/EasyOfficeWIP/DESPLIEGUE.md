# Publicar Easy Office en internet (Render + Neon)

El hosting cPanel de f5soluciones.cl **no sirve para esta aplicación**: no tiene Node.js (solo PHP y Python),
no tiene PostgreSQL y bloquea las conexiones de salida al puerto 5432 (revisado el 09-11-2026 desde su Terminal).
Por eso:

| Pieza | Dónde | Costo |
|---|---|---|
| Base de datos PostgreSQL | **Neon** (neon.tech) | Gratis (0,5 GB) |
| Aplicación Node.js | **Render** (render.com) | Gratis (se duerme tras 15 min sin visitas; despierta en ~30 s) |
| Dominio y correo | El cPanel de siempre | Lo que ya se paga |

---

## 1. Base de datos en Neon

1. Crear una cuenta en <https://neon.tech> (se puede entrar con GitHub).
2. **New project** → nombre `easyoffice`, PostgreSQL 17, región **AWS US East 1 (N. Virginia)**
   (la misma de Render: así cada consulta tarda milisegundos y no décimas de segundo).
3. En **Connect**, desactivar *Connection pooling* y copiar la cadena de conexión. Se ve así:
   `postgresql://neondb_owner:XXXX@ep-algo-123456.us-east-1.aws.neon.tech/neondb?sslmode=require`
4. En el equipo, en `Desarrollo/EasyOfficeWIP/.env`, pegarla como `DATABASE_URL=...` **solo mientras se carga la base**
   (después se puede comentar para volver a trabajar con la base local).
5. Cargar el esquema y los datos de muestra:

   ```bash
   npm run db:cargar
   ```

   (`npm run db:cargar -- --vacia` carga solo el esquema, sin clientes de muestra.)
   El script se niega a seguir si la base ya tiene tablas, y al final le da al usuario de Neon los roles
   `rol_admin`, `rol_ejecutivo` y `rol_portal` que la aplicación usa para la seguridad por fila.
6. Crear el usuario del CRM y comprobar todo:

   ```bash
   npm run crear-usuario
   npm run db:revisar
   ```

7. **Si la base de Neon se cargó antes** (ya tiene tablas), no se vuelve a cargar: se le aplican las migraciones
   que le falten. Con el `DATABASE_URL` de esa base en `.env`:

   ```bash
   npm run db:revisar                                     # al final dice qué migraciones faltan y en qué orden
   npm run db:migrar -- easyoffice_v2_comunas_permisos.sql   # una por una, en ese orden
   ```

   También se pueden pegar en el **SQL Editor** de Neon (contenido del archivo → **Run**), desde
   `Desarrollo/base de datos/scripts/`. La lista completa y qué agrega cada una está en el README ("Migraciones").
   Las últimas son `easyoffice_v2_cartera.sql` (ejecutivo a cargo), `easyoffice_v2_tienda.sql` (CRM → Tienda) y
   `easyoffice_v2_archivos.sql` (Word y PDF guardados en la base, ver "Contratos Word").

   **Ojo:** confirme que es la misma base que usa Render (Render → servicio → **Environment** → `DATABASE_URL`).
   El `.env` y Render pueden apuntar a bases o ramas distintas de Neon.

## 2. Aplicación en Render

1. Subir los cambios a GitHub (`render.yaml` está en la raíz del repositorio).
2. Crear una cuenta en <https://render.com> con GitHub y darle acceso al repositorio `proyecto_capstone`.
3. **New → Blueprint** → elegir el repositorio. Render lee `render.yaml` y pide los valores que faltan:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | La cadena de Neon del paso 1.3 |
   | `APP_URL` | `https://easyoffice-rou6.onrender.com` (o el dominio propio del paso 3) |
   | `TOTP_CLAVE` | Opcional (segundo factor del CRM). `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `SMTP_*`, `CORREO_REMITENTE` | Opcional, ver "Correos" |

   `CLIENTE_SECRETO`, `FIRMA_SECRETO` y `PAGO_SECRETO` los genera Render solo.
4. **Apply**. El primer despliegue tarda unos minutos; queda en `https://easyoffice-rou6.onrender.com`
   (el nombre exacto aparece en el panel).

Cada `git push` a `main` vuelve a desplegar solo.

**PDF de Mi cuenta.** El cliente descarga sus documentos en PDF, armados con JavaScript (`src/datos/wordPdf.js`,
pdfmake), sin LibreOffice ni Docker: el servicio sigue con `runtime: node`. No hay que configurar nada
(`PDF_PROVEEDOR=javascript` es el valor por defecto). Los PDF quedan guardados en la tabla `archivos` de Neon
(unos 10–250 KB cada uno) y el mismo Word da siempre el mismo PDF.

## 3. Usar el dominio propio (opcional)

1. En Render: servicio → **Settings → Custom Domains → Add** → `app.f5soluciones.cl`.
2. En cPanel: **Dominios → Zone Editor** → `f5soluciones.cl` → **+ CNAME Record**:
   nombre `app`, registro `easyoffice-rou6.onrender.com` (lo que indique Render).
3. Esperar unos minutos: Render verifica el dominio y emite el certificado HTTPS.
4. Cambiar `APP_URL` en Render a `https://app.f5soluciones.cl`.

El sitio actual de f5soluciones.cl y el correo de cPanel no se tocan.

## Cosas a saber

- **Contratos Word.** El disco del plan gratis de Render se borra en cada reinicio o despliegue, así que los
  archivos se guardan en la base (tabla `archivos`, script `easyoffice_v2_archivos.sql`): las plantillas subidas
  desde el CRM, los contratos generados, los firmados y los escaneos de correspondencia quedan en Neon y no se
  pierden. Las plantillas de git (`base de datos/Contratos/*.docx`) se copian a la tabla la primera vez que se
  abren. Los PDF que descarga el cliente también quedan en la tabla. `npm run regenerar-archivos` sigue en el
  comando de inicio, pero solo recrea los contratos que no estén guardados (los anteriores a la tabla); con todo
  guardado, no hace nada.
  Sin la tabla, la aplicación usa solo la carpeta como antes y lo subido desde el CRM se pierde al reiniciar.
  Cada Word pesa unos 30–100 KB: los 0,5 GB de Neon alcanzan para miles.
- **Correos.** Sin `SMTP_HOST`, los correos no salen: el enlace de acceso de cada correo aparece en **Logs** de
  Render (sirve para la demo). Para enviarlos de verdad se puede usar una cuenta de correo del cPanel
  (servidor `mail.f5soluciones.cl`, puerto 465), pero el plan gratis de Render bloquea los puertos SMTP:
  hace falta el plan *Starter* o un servicio de correo por API.
- **Primera visita lenta.** Tras 15 minutos sin visitas el servidor se duerme; la siguiente visita tarda ~30 s.
  Antes de una presentación, abrir el sitio un par de minutos antes.
- **Pruebas automáticas.** `npm test` nunca usa `DATABASE_URL`: sigue creando bases temporales en el
  PostgreSQL local.
