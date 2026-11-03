/* =========================================================
   CAPA DE NEGOCIO · Tablero del CRM.
   Arma el resumen en una sola transacción con la identidad del usuario,
   de modo que cada ejecutivo vea solo los indicadores de su cartera.
   ========================================================= */
const { conUsuario } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const v = require('../validacion');
const dashboardRepo = require('../../datos/repositorios/dashboard.repositorio');
const pagosRepo = require('../../datos/repositorios/pagos.repositorio');

const MESES_PROYECCION = 6;
const PENDIENTES_POR_TIPO = 4;
const DIAS_PAGOS = 7;
const MAX_DIAS_PERIODO = 3 * 366;

// Hoy en Chile como 'YYYY-MM-DD'
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());

// Período de los indicadores: por defecto, el mes en curso. Un ejecutivo solo ve su cartera (la BD ya lo filtra).
function periodo(usuario, { desde, hasta, ejecutivo } = {}) {
  const h = v.fecha(hasta, 'La fecha final', { opcional: true }) || hoy();
  const d = v.fecha(desde, 'La fecha inicial', { opcional: true }) || `${h.slice(0, 7)}-01`;
  if (d > h) throw errores.solicitudInvalida('La fecha inicial es posterior a la final.');
  if ((Date.parse(h) - Date.parse(d)) / 864e5 > MAX_DIAS_PERIODO) throw errores.solicitudInvalida('El período no puede superar 3 años.');
  return { desde: d, hasta: h, ejecutivo: usuario.admin ? v.id(ejecutivo, 'Ejecutivo', { opcional: true }) : null };
}

async function obtener(usuario, filtros) {
  const p = periodo(usuario, filtros);
  return conUsuario(usuario, async (db) => {
    const k = await dashboardRepo.indicadoresContratos(db);
    const conteos = await dashboardRepo.conteosMenu(db);
    const carga = (await dashboardRepo.cargaPorEjecutivo(db))
      .filter((c) => c.contratos + c.documentos > 0); // sin asignaciones no aporta al gráfico

    return {
      periodo: { ...p, indicadores: await dashboardRepo.indicadoresPeriodo(db, p) },
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
