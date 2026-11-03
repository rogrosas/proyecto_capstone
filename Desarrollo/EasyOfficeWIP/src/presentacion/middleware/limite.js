/* =========================================================
   CAPA DE PRESENTACIÓN · Límite de peticiones por IP para rutas públicas
   (verificación de documentos, firma simulada). En memoria: basta para un servidor.
   ========================================================= */
const { errores } = require('../../comun/errores');

function limitePorIp(max, ventanaMs, mensaje = 'Demasiadas solicitudes. Espere unos minutos e intente de nuevo.') {
  const conteo = new Map();   // ip -> { n, desde }
  return (req, res, next) => {
    const ahora = Date.now();
    if (conteo.size > 5000) for (const [k, x] of conteo) if (ahora - x.desde > ventanaMs) conteo.delete(k);
    const r = conteo.get(req.ip);
    if (!r || ahora - r.desde > ventanaMs) conteo.set(req.ip, { n: 1, desde: ahora });
    else if (++r.n > max) return next(errores.demasiadosIntentos(mensaje));
    next();
  };
}

module.exports = { limitePorIp };
