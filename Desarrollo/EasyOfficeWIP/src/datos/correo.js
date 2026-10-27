/* =========================================================
   CAPA DE DATOS (infraestructura) · Envío de correos.
   - Con SMTP_HOST configurado: envía por SMTP (nodemailer).
   - Sin SMTP (desarrollo): guarda cada correo como .html en correos-dev/
     y escribe el aviso en la consola del servidor.
   ========================================================= */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const CARPETA_DEV = path.join(__dirname, '..', '..', 'correos-dev');
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

/** m = { para, asunto, html, texto } */
async function enviar(m) {
  if (!modoDesarrollo()) {
    await smtp().sendMail({ from: config.correo.remitente, to: m.para, subject: m.asunto, html: m.html, text: m.texto });
    return;
  }
  fs.mkdirSync(CARPETA_DEV, { recursive: true });
  const nombre = `${new Date().toISOString().replace(/[:.]/g, '-')}_${m.para.replace(/[^a-z0-9@._-]/gi, '_')}.html`;
  fs.writeFileSync(path.join(CARPETA_DEV, nombre),
    `<!-- Para: ${m.para} | Asunto: ${m.asunto} -->\n${m.html}`);
  console.log(`[correo · desarrollo] Para ${m.para}: "${m.asunto}" → correos-dev/${nombre}`);
}

module.exports = { enviar, modoDesarrollo };
