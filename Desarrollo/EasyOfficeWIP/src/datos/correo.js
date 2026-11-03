/* =========================================================
   CAPA DE DATOS (infraestructura) · Envío de correos.
   - Con SMTP_HOST configurado: envía por SMTP (nodemailer).
   - Sin SMTP (desarrollo): guarda cada correo como .html en correos-dev/
     y escribe el aviso en la consola del servidor.
   ========================================================= */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const CARPETA_DEV = config.correo.carpetaDev;
let transporte = null;

function smtp() {
  if (!transporte) {
    const nodemailer = require('nodemailer');
    transporte = nodemailer.createTransport({
      host: config.correo.host,
      port: config.correo.puerto,
      secure: config.correo.puerto === 465,
      auth: config.correo.usuario ? { user: config.correo.usuario, pass: config.correo.clave } : undefined
    });
  }
  return transporte;
}

const modoDesarrollo = () => !config.correo.host;

/** m = { para, asunto, html, texto, adjuntos?: [{ nombre, contenido (Buffer), tipo }] } */
async function enviar(m) {
  const adjuntos = m.adjuntos || [];
  if (!modoDesarrollo()) {
    await smtp().sendMail({
      from: config.correo.remitente, to: m.para, subject: m.asunto, html: m.html, text: m.texto,
      attachments: adjuntos.map((a) => ({ filename: a.nombre, content: a.contenido, contentType: a.tipo }))
    });
    return;
  }
  fs.mkdirSync(CARPETA_DEV, { recursive: true });
  const base = `${new Date().toISOString().replace(/[:.]/g, '-')}_${m.para.replace(/[^a-z0-9@._-]/gi, '_')}`;
  // Los adjuntos quedan junto al correo, con el mismo prefijo
  const guardados = adjuntos.map((a) => {
    const n = `${base}_${a.nombre.replace(/[\\/:*?"<>|]+/g, '-')}`;
    fs.writeFileSync(path.join(CARPETA_DEV, n), a.contenido);
    return n;
  });
  fs.writeFileSync(path.join(CARPETA_DEV, `${base}.html`),
    `<!-- Para: ${m.para} | Asunto: ${m.asunto}${guardados.length ? ` | Adjuntos: ${guardados.join(', ')}` : ''} -->\n${m.html}`);
  console.log(`[correo · desarrollo] Para ${m.para}: "${m.asunto}" → correos-dev/${base}.html${guardados.length ? ` + ${guardados.length} adjunto(s)` : ''}`);
}

module.exports = { enviar, modoDesarrollo };
