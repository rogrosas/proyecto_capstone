/* =========================================================
   CAPA DE NEGOCIO · Reglas de roles.
   Debe coincidir con app_es_admin() de easyoffice_er.sql.
   ========================================================= */
const config = require('../config');

const esAdmin = (rol) => config.rolesAdmin.includes(String(rol || '').toLowerCase());

module.exports = { esAdmin };
