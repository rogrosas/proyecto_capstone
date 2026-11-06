/* =========================================================
   CAPA DE NEGOCIO · Exportar los listados del CRM a CSV (HU-37).
   Reutiliza los mismos servicios y filtros de cada pantalla, así lo exportado
   es exactamente lo que el usuario ve (incluida la seguridad por cartera).
   El CSV va en UTF-8 con BOM y separado por ";" para que Excel en español
   lo abra directo, con tildes y columnas.
   ========================================================= */
const { errores } = require('../../comun/errores');
const clientes = require('./clientes.servicio');
const contratos = require('./contratos.servicio');
const renovaciones = require('./renovaciones.servicio');
const documentos = require('./documentos.servicio');
const pagos = require('./pagos.servicio');
const auditoria = require('./auditoria.servicio');

const fechaArchivo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());

// columnas: [encabezado, (fila) => valor]
const LISTAS = {
  clientes: {
    datos: async (u, q) => (await clientes.listar(u, { q: q.q, estado: q.estado })).clientes,
    columnas: [['RUT', (x) => x.rut_fmt], ['Razón social', (x) => x.razon_social], ['Nombre de fantasía', (x) => x.nombre_fantasia],
      ['Correo', (x) => x.email], ['Celular', (x) => x.celular], ['Servicios vigentes', (x) => x.servicios], ['Último folio', (x) => x.folio],
      ['Vence', (x) => x.vence], ['Estado', (x) => x.estado], ['Ejecutivo', (x) => x.ejecutivo], ['Documentos por revisar', (x) => x.docs_por_revisar],
      ['Cliente desde', (x) => x.desde]]
  },
  contratos: {
    datos: async (u, q) => (await contratos.listar(u, { q: q.q, estado: q.estado, mes: q.mes, ejecutivo: q.ejecutivo, desde: q.desde, hasta: q.hasta })).contratos,
    columnas: [['Folio', (x) => x.folio], ['Cliente', (x) => x.cliente], ['RUT', (x) => x.rut], ['Servicios', (x) => x.servicios],
      ['Inicio', (x) => x.inicio], ['Vence', (x) => x.vence], ['Meses', (x) => x.duracion_meses], ['Total neto', (x) => x.total_servicios],
      ['Pagado', (x) => x.pagado], ['Saldo', (x) => x.saldo], ['Estado', (x) => x.estado], ['Ejecutivo', (x) => x.ejecutivo],
      ['Emisora', (x) => x.emisora], ['Sucursal', (x) => x.sucursal]]
  },
  renovaciones: {
    datos: async (u, q) => (await renovaciones.listar(u, { filtro: q.filtro })).contratos,
    columnas: [['Folio', (x) => x.folio], ['Cliente', (x) => x.razon_social], ['RUT', (x) => x.rut], ['Servicios', (x) => x.servicios],
      ['Vence', (x) => x.vence], ['Días', (x) => x.dias], ['Monto neto', (x) => x.total_servicios], ['Saldo', (x) => x.saldo],
      ['Avisos enviados', (x) => x.avisos_enviados], ['Próxima alerta', (x) => x.proxima_alerta],
      ['Renovación automática', (x) => (x.renovacion_automatica ? 'Sí' : 'No')], ['Ejecutivo', (x) => x.ejecutivo]]
  },
  documentos: {
    datos: async (u, q) => (await documentos.listar(u, { tipo: q.tipo })).documentos,
    columnas: [['Id', (x) => `DOC-${x.id}`], ['Documento', (x) => x.tipo], ['Cliente', (x) => x.cliente], ['Folio', (x) => x.folio],
      ['Estado', (x) => x.estado], ['Revisión del cliente', (x) => x.estado_cliente], ['Generado', (x) => x.generado], ['Firmado', (x) => x.firmado],
      ['Código de verificación', (x) => x.codigo_verificacion], ['Ejecutivo', (x) => x.ejecutivo], ['Aprobado por', (x) => x.revisor]]
  },
  pagos: {
    datos: async (u) => (await pagos.resumen(u)).pagos,
    columnas: [['Fecha', (x) => x.fecha], ['Referencia', (x) => x.referencia], ['Cliente', (x) => x.cliente], ['Concepto', (x) => x.concepto],
      ['Monto', (x) => x.monto], ['Cuota', (x) => `${x.cuota} de ${x.total_cuotas}`], ['Pasarela', (x) => x.pasarela], ['Estado', (x) => x.estado]]
  },
  auditoria: {
    datos: async (u, q) => (await auditoria.listar(u, { q: q.q, accion: q.accion, dias: q.dias })).registros,
    columnas: [['Fecha', (x) => x.fecha], ['Usuario', (x) => x.usuario], ['Rol', (x) => x.rol], ['Acción', (x) => x.accion],
      ['Tabla', (x) => x.tabla_afectada], ['Registro', (x) => x.registro_id]]
  }
};

// Un valor de celda: comillas si trae ; " o saltos de línea; números tal cual (Excel los suma)
function celda(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Evita que Excel ejecute fórmulas escritas en los datos (=, +, -, @ al inicio)
  const seguro = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

async function exportar(usuario, lista, query = {}) {
  const def = Object.hasOwn(LISTAS, lista) ? LISTAS[lista] : null;   // no "__proto__" ni "constructor"
  if (!def) throw errores.noEncontrado('Listado no disponible para exportar.');
  const filas = await def.datos(usuario, query);
  const lineas = [def.columnas.map(([t]) => celda(t)).join(';'), ...filas.map((f) => def.columnas.map(([, fn]) => celda(fn(f))).join(';'))];
  return { nombre: `easyoffice_${lista}_${fechaArchivo()}.csv`, contenido: '﻿' + lineas.join('\r\n') + '\r\n', filas: filas.length };
}

module.exports = { exportar, LISTAS: Object.keys(LISTAS) };
