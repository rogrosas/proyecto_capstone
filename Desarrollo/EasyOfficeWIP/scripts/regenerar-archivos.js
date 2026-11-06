/* =========================================================
   npm run regenerar-archivos
   Vuelve a crear los contratos Word que la base menciona (documentos.url_archivo)
   y que faltan en la carpeta de contratos. Pasa al cargar la base en otro equipo:
   generados/ no va en git (tiene datos de clientes) ni en easyoffice_completo.sql.

   - Usa la misma plantilla, los datos actuales del contrato y las respuestas guardadas
     en documentos.datos, y guarda el archivo en la MISMA ruta.
   - No cambia la base (transacción de solo lectura) ni reemplaza archivos que existen.
   - El resultado puede no ser idéntico al original si cambiaron los datos o la fecha:
     sirve para desarrollo, no reemplaza el archivo original de un documento firmado.
   ========================================================= */
const fs = require('fs');
const { pool } = require('../src/datos/conexion');
const archivos = require('../src/datos/archivos');
const word = require('../src/datos/word');
const campos = require('../src/negocio/camposDocumento');
const contratosRepo = require('../src/datos/repositorios/contratos.repositorio');
const plantillasRepo = require('../src/datos/repositorios/plantillas.repositorio');

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
    const faltan = docs.filter((d) => !fs.existsSync(archivos.absoluta(d.url_archivo)));
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
