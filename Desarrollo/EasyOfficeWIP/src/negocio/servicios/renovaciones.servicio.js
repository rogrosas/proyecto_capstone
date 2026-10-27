/* =========================================================
   CAPA DE NEGOCIO · Renovaciones y cobranza.
   Reglas: rangos permitidos (30 o 60 días, o vencidos sin renovar).
   ========================================================= */
const { conUsuario } = require('../../datos/conexion');
const contratosRepo = require('../../datos/repositorios/contratos.repositorio');

const LIMITE = 300;

function rango(filtro) {
  if (filtro === 'vencidos') return { soloVencidos: true, dias: 0 };
  return { soloVencidos: false, dias: filtro === '30' ? 30 : 60 };
}

async function listar(usuario, { filtro }) {
  return conUsuario(usuario, async (db) => ({
    etapas: await contratosRepo.etapasRenovacion(db),
    contratos: await contratosRepo.listarPorVencer(db, rango(filtro), LIMITE)
  }));
}

module.exports = { listar };
