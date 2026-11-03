/* =========================================================
   CAPA DE DATOS · Simulador de la plataforma de firma electrónica (TT-05).

   Para validar el flujo completo en laboratorio (ADR-011) sin la API real:
   - "envía" el documento: cada firmante recibe un correo con su enlace a
     /firma-simulada, donde confirma su RUT y firma o rechaza;
   - devuelve el documento "firmado": el mismo Word con una hoja final que
     deja constancia de quién firmó, cuándo, desde qué IP y el código de
     verificación. NO es una firma electrónica avanzada: lo dice la hoja.
   Respeta las mismas operaciones que tendrá la plataforma real (index.js).
   ========================================================= */
const crypto = require('crypto');
const config = require('../../config');
const correo = require('../correo');
const word = require('../word');
const { errores } = require('../../comun/errores');
const { esc, boton, cuerpo, titulo, pie } = require('../../comun/correos');

const SECRETO = config.firma.secreto || crypto.randomBytes(32).toString('hex');
if (!config.firma.secreto) console.warn('Aviso: falta FIRMA_SECRETO en .env; los enlaces de firma dejan de servir al reiniciar el servidor.');

const firmar = (texto) => crypto.createHmac('sha256', SECRETO).update(texto).digest('base64url');

// Enlace firmado y con vencimiento para un firmante
function enlace(idExternoFirmante) {
  const datos = Buffer.from(JSON.stringify({ f: idExternoFirmante, e: Date.now() + config.firma.enlaceMs })).toString('base64url');
  return `${config.appUrl}/firma-simulada?t=${datos}.${firmar(datos)}`;
}

// Token del enlace → id externo del firmante (o error)
function leerToken(token) {
  const [datos, sello] = String(token || '').split('.');
  const esperado = datos ? firmar(datos) : '';
  if (!datos || !sello || sello.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sello), Buffer.from(esperado))) {
    throw errores.noAutenticado('El enlace de firma no es válido.');
  }
  const { f, e } = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8'));
  if (e < Date.now()) throw errores.noAutenticado('El enlace de firma venció. Pida uno nuevo a Easy Office.');
  return f;
}

async function crearSolicitud({ documentoId, titulo: tituloDoc, firmantes }) {
  const idExterno = `SIM-${documentoId}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const salida = firmantes.map((f) => ({ orden: f.orden, idExterno: `${idExterno}-F${f.orden}`, enlace: enlace(`${idExterno}-F${f.orden}`) }));
  // La plataforma notifica a cada firmante
  for (const f of firmantes) {
    const url = salida.find((x) => x.orden === f.orden).enlace;
    await correo.enviar({
      para: f.email,
      asunto: `Tiene un documento para firmar: ${tituloDoc}`,
      texto: `Easy Office le envió "${tituloDoc}" para su firma electrónica. Firme aquí: ${url}`,
      html: cuerpo(`${titulo('Documento para firmar')}
        <p>Hola <b>${esc(f.nombre)}</b>: Easy Office le envió <b>${esc(tituloDoc)}</b> para su firma electrónica.</p>
        <p>El enlace es personal y vence en 7 días.</p>
        ${boton(url, 'Revisar y firmar')}
        <p style="color:#B26A00;font-size:12px;">Ambiente de laboratorio: plataforma de firma simulada.</p>${pie}`)
    });
  }
  return { idExterno, firmantes: salida };
}

const fechaHora = (d) => new Intl.DateTimeFormat('es-CL', { timeZone: config.bd.zonaHoraria, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(d));

function documentoFirmado({ idExterno, original, firmantes, codigo, urlVerificacion }) {
  return word.anexar(original, [
    { texto: 'CONSTANCIA DE FIRMA ELECTRÓNICA', negrita: true, centrado: true, tamano: 13 },
    { texto: 'Plataforma: SIMULADOR DE LABORATORIO (no constituye firma electrónica avanzada)', centrado: true, tamano: 9 },
    { texto: `Solicitud: ${idExterno}` },
    ...firmantes.map((f, i) => ({ texto: `Firmante ${i + 1}: ${f.nombre}${f.rut ? ` · RUT ${f.rut}` : ''} · ${f.email} · firmado el ${fechaHora(f.firmado_en)}${f.ip ? ` · IP ${f.ip}` : ''}` })),
    { texto: `Código de verificación: ${codigo}`, negrita: true },
    { texto: `Verifique la autenticidad de este documento en ${urlVerificacion}` }
  ]);
}

module.exports = { crearSolicitud, enlace, leerToken, documentoFirmado };
