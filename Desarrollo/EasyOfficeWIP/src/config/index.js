/* =========================================================
   Configuración (transversal a todas las capas).
   Los valores salen del archivo .env; aquí solo hay valores por defecto.
   La conexión a PostgreSQL usa PGHOST, PGPORT, PGDATABASE, PGUSER y
   PGPASSWORD, que la librería pg lee directamente del entorno.
   ========================================================= */
const path = require('path');

module.exports = {
  puerto: Number(process.env.PORT) || 3000,
  produccion: process.env.NODE_ENV === 'production',

  bd: {
    maxConexiones: 10,
    inactividadMs: 30000,
    zonaHoraria: 'America/Santiago'
  },

  sesion: {
    cookie: 'eo_crm',
    ruta: '/api/crm',
    duracionMs: 8 * 60 * 60 * 1000   // una jornada laboral
  },

  login: {
    maxIntentos: 10,
    ventanaMs: 15 * 60 * 1000
  },

  // Roles de la tabla roles que la función app_es_admin() de la BD reconoce como administradores
  rolesAdmin: ['admin', 'dueno'],

  // Portal de clientes (/mi-cuenta): acceso por enlace mágico enviado al correo de clientes.email
  appUrl: (process.env.APP_URL || `http://localhost:${Number(process.env.PORT) || 3000}`).replace(/\/$/, ''),
  cliente: {
    cookie: 'eo_cli',
    ruta: '/api/cliente',
    duracionMs: 4 * 60 * 60 * 1000,      // sesión del cliente
    enlaceMs: 15 * 60 * 1000,            // vigencia del enlace de acceso
    secreto: process.env.CLIENTE_SECRETO || null,  // firma de los enlaces (si falta, se genera al iniciar)
    maxSolicitudes: 5,                   // pedidos de enlace por IP y por correo en la ventana
    ventanaMs: 15 * 60 * 1000
  },

  // Carpeta de plantillas y contratos Word. En la BD solo se guarda la ruta RELATIVA a esta carpeta
  // (plantillas_documento.archivo_base, documentos.url_archivo), así funciona en cualquier equipo.
  archivos: {
    dir: path.resolve(__dirname, '..', '..', process.env.CONTRATOS_DIR || '../base de datos/Contratos'),
    generados: 'generados',            // subcarpeta de los contratos generados: generados/<año>/...
    maxBytes: 15 * 1024 * 1024
  },

  // Correo saliente. Sin SMTP_HOST, los correos se guardan en correos-dev/ y el enlace se muestra en consola.
  correo: {
    host: process.env.SMTP_HOST || null,
    puerto: Number(process.env.SMTP_PORT) || 587,
    usuario: process.env.SMTP_USER || null,
    clave: process.env.SMTP_PASS || null,
    remitente: process.env.CORREO_REMITENTE || 'Easy Office <no-responder@easyoffice.cl>'
  }
};
