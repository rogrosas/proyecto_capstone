/* =========================================================
   CAPA DE NEGOCIO · Tablero del CRM.
   Arma el resumen en una sola transacción con la identidad del usuario,
   de modo que cada ejecutivo vea solo los indicadores de su cartera.
   ========================================================= */
const { conUsuario } = require('../../datos/conexion');
const dashboardRepo = require('../../datos/repositorios/dashboard.repositorio');
const pagosRepo = require('../../datos/repositorios/pagos.repositorio');

const MESES_PROYECCION = 6;
const PENDIENTES_POR_TIPO = 4;
const DIAS_PAGOS = 7;

async function obtener(usuario) {
  return conUsuario(usuario, async (db) => {
    const k = await dashboardRepo.indicadoresContratos(db);
    const conteos = await dashboardRepo.conteosMenu(db);
    const carga = (await dashboardRepo.cargaPorEjecutivo(db))
      .filter((c) => c.contratos + c.documentos > 0); // sin asignaciones no aporta al gráfico

    return {
      kpi: {
        activos: k.activos,
        nuevosMes: k.nuevos_mes,
        vencidos: k.vencidos,
        montoRiesgo: await dashboardRepo.montoEnRiesgo(db),
        vencen30: k.vencen_30,
        vencen30SinAviso: k.vencen_30_sin_aviso,
        mrr: await dashboardRepo.ingresoRecurrenteMensual(db)
      },
      barras: await dashboardRepo.vencimientosPorMes(db, MESES_PROYECCION),
      accion: await dashboardRepo.pendientesDelDia(db, PENDIENTES_POR_TIPO),
      ventas: await pagosRepo.resumenPorPasarela(db, DIAS_PAGOS),
      carga,
      conteos: { clientes: conteos.clientes, vencidos: k.vencidos, enRevision: conteos.en_revision }
    };
  });
}

module.exports = { obtener };
