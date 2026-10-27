/* =========================================================
   CAPA DE NEGOCIO · Listas para los selectores de formularios.
   ========================================================= */
const { conUsuario } = require('../../datos/conexion');
const opcionesRepo = require('../../datos/repositorios/opciones.repositorio');
const { CICLOS } = require('../validacion');
const { FAMILIAS } = require('../catalogos.definiciones');

async function obtener(usuario) {
  const listas = await conUsuario(usuario, (db) => opcionesRepo.todas(db));
  return {
    ...listas,
    ciclos: CICLOS,
    familias: FAMILIAS,
    estadosContrato: ['pendiente', 'activo', 'vencido', 'cancelado'],
    estadosPago: ['pendiente', 'pagado', 'rechazado', 'reembolsado'],
    pasarelas: ['transbank', 'mercado_pago', 'transferencia']
  };
}

module.exports = { obtener };
