/* =========================================================
   Error de aplicación con código HTTP, compartido por todas las capas.
   La capa de datos traduce los errores de PostgreSQL a este tipo,
   la de negocio lo lanza en sus reglas y la de presentación lo responde.
   ========================================================= */
class AppError extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

const errores = {
  solicitudInvalida: (m = 'Datos inválidos.') => new AppError(400, m),
  noAutenticado: (m = 'Sesión expirada. Ingrese nuevamente.') => new AppError(401, m),
  sinPermiso: (m = 'Su rol no tiene permiso para esta acción.') => new AppError(403, m),
  noEncontrado: (m = 'Registro no encontrado.') => new AppError(404, m),
  conflicto: (m) => new AppError(409, m),
  demasiadosIntentos: (m) => new AppError(429, m),
  sinBaseDatos: (m = 'No hay conexión con la base de datos.') => new AppError(503, m)
};

module.exports = { AppError, errores };
