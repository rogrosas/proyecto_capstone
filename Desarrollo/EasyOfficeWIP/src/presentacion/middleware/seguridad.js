/* =========================================================
   CAPA DE PRESENTACIÓN · Cabeceras de seguridad para todo el sitio (HU-05).

   - CSP: solo scripts propios (el sitio no usa scripts en línea), estilos
     propios y de Google Fonts, sin objetos ni marcos de otros sitios.
   - Sin rastreo de referencias a otros sitios, sin cámara/micrófono/ubicación.
   - En producción (detrás de HTTPS), HSTS obliga al navegador a usar HTTPS.
   Las rutas que ya fijan una CSP más estricta (borradores Word) la reemplazan.
   ========================================================= */
const config = require('../../config');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'"
].join('; ');

function cabecerasSeguras(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin'
  });
  if (config.produccion) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Las respuestas de la API tienen datos personales: que el navegador no las guarde
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
}

module.exports = { cabecerasSeguras };
