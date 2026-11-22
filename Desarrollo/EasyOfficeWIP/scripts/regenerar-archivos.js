/* =========================================================
   npm run regenerar-archivos
   Vuelve a crear los contratos Word que la base menciona (documentos.url_archivo)
   y que no están guardados (ni en la tabla archivos ni en la carpeta de contratos).
   Con la tabla archivos (easyoffice_v2_archivos.sql) los contratos ya no se pierden
   al reiniciar el servidor; esto queda para los que se crearon antes de ella y para
   una base cargada en otro equipo sin sus archivos.

   - Usa la misma plantilla, los datos actuales del contrato y las respuestas guardadas
     en documentos.datos, y guarda el archivo en la MISMA ruta.
   - Solo escribe los archivos que faltan (en la tabla archivos o, sin ella, en la carpeta);
     no cambia los datos (transacción de solo lectura) ni reemplaza archivos que existen.
   - También vuelve a crear el documento firmado (documentos.archivo_firmado) que entregan
     Mi cuenta y el CRM: el contrato más la hoja de constancia de la plataforma de firma,
     con los firmantes, fechas, IP y código de verificación guardados en la base.
   - El resultado puede no ser idéntico al original si cambiaron los datos o la fecha
     (su huella SHA-256 no coincidirá con hash_firmado): sirve para desarrollo y la demo,
     no reemplaza el archivo original de un documento firmado.
   - No puede recrear los escaneos de correspondencia (son archivos subidos).
   ========================================================= */
const config = require('../src/config');
const { pool } = require('../src/datos/conexion');
const archivos = require('../src/datos/archivos');
const word = require('../src/datos/word');
const plataforma = require('../src/datos/firma');
const campos = require('../src/negocio/camposDocumento');
const contratosRepo = require('../src/datos/repositorios/contratos.repositorio');
const plantillasRepo = require('../src/datos/repositorios/plantillas.repositorio');
const firmaRepo = require('../src/datos/repositorios/firma.repositorio');

const urlVerificacion = (codigo) => `${config.appUrl}/verificar?codigo=${encodeURIComponent(codigo)}`;

(async () => {
  const db = await pool.connect();
  let creados = 0, fallidos = 0;
  try {
    await db.query('BEGIN READ ONLY');
    const docs = (await db.query(`
      SELECT d.id, d.contrato_id, d.plantilla_id, d.estado, d.url_archivo, d.datos, k.folio
        FROM documentos d LEFT JOIN contratos k ON k.id = d.contrato_id
       WHERE d.url_archivo IS NOT NULL AND d.url_archivo !~* '^https?://'
       ORDER BY d.id`)).rows;
    const faltan = [];
    for (const d of docs) if (!await archivos.existe(d.url_archivo)) faltan.push(d);
    console.log(`\nCarpeta de contratos: ${archivos.carpeta()}`);
    console.log(`${docs.length} documento(s) con archivo Word; faltan ${faltan.length}.\n`);

    for (const d of faltan) {
      const etiqueta = `#${d.id} ${d.folio || ''} (${d.estado})`;
      try {
        const plantilla = d.plantilla_id && await plantillasRepo.obtener(db, d.plantilla_id);
        if (!plantilla?.archivo_base) throw new Error('el documento no tiene plantilla Word asociada');
        if (!d.contrato_id) throw new Error('el documento no está asociado a un contrato');
        const fuente = await contratosRepo.impresion(db, d.contrato_id);
        if (!fuente) throw new Error('no se encontró el contrato');

        // Igual que archivos.servicio.generarEnTransaccion, sin tocar la base
        const base = await archivos.leer(plantilla.archivo_base);
        const { valor, pendientes } = campos.resolver(word.marcas(base), plantilla.mapa_campos, campos.valores(fuente), d.datos?.respuestas || {});
        const { buffer } = word.combinar(base, valor);
        await archivos.guardar(d.url_archivo, buffer, { reemplazar: false });
        creados++;
        console.log(`  ✔ ${etiqueta} → ${d.url_archivo}${pendientes.length ? `  (sin dato: ${pendientes.join(', ')})` : ''}`);
      } catch (err) {
        fallidos++;
        console.log(`  ✘ ${etiqueta}: ${err.message}`);
      }
    }

    // Documentos firmados: el contrato (ya recreado arriba si faltaba) + la constancia de firma
    const firmados = (await db.query(`
      SELECT d.id, d.url_archivo, d.archivo_firmado, d.firma_id_externo, d.codigo_verificacion, k.folio
        FROM documentos d LEFT JOIN contratos k ON k.id = d.contrato_id
       WHERE d.archivo_firmado IS NOT NULL AND d.archivo_firmado !~* '^https?://'
       ORDER BY d.id`)).rows;
    const faltanFirmados = [];
    for (const d of firmados) if (!await archivos.existe(d.archivo_firmado)) faltanFirmados.push(d);
    console.log(`\n${firmados.length} documento(s) firmado(s); faltan ${faltanFirmados.length}.\n`);

    for (const d of faltanFirmados) {
      const etiqueta = `#${d.id} ${d.folio || ''} (firmado)`;
      try {
        if (!d.url_archivo) throw new Error('el documento no tiene el contrato original');
        const firmantes = (await firmaRepo.firmantes(db, d.id)).filter((f) => f.estado === 'firmado');
        if (!firmantes.length) throw new Error('no hay firmantes registrados');
        const firmado = await plataforma.proveedor().documentoFirmado({
          idExterno: d.firma_id_externo, original: await archivos.leer(d.url_archivo), firmantes,
          codigo: d.codigo_verificacion, urlVerificacion: urlVerificacion(d.codigo_verificacion)
        });
        await archivos.guardar(d.archivo_firmado, firmado, { reemplazar: false });
        creados++;
        console.log(`  ✔ ${etiqueta} → ${d.archivo_firmado}`);
      } catch (err) {
        fallidos++;
        console.log(`  ✘ ${etiqueta}: ${err.message}`);
      }
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('\n✘', err.message);
    process.exitCode = 1;
  } finally {
    db.release();
    await pool.end();
  }
  console.log(`\nCreados: ${creados} · con error: ${fallidos}`);
  if (fallidos) process.exitCode = 1;
})();
