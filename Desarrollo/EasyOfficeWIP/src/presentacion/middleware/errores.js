/* =========================================================
   CAPA DE PRESENTACIÓN · Manejo de errores HTTP.
   Convierte AppError en { error: mensaje } con su código de estado;
   cualquier otro error se responde como 500 sin exponer detalles.
   ========================================================= */
const { AppError } = require('../../comun/errores');

// Envuelve un controlador async para que sus errores lleguen a manejarErrores
const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars
function manejarErrores(err, req, res, next) {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo o los datos enviados son demasiado grandes.' });
  console.error('[servidor]', err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}

module.exports = { asincrono, manejarErrores };
