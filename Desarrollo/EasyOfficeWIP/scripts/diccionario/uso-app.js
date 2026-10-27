/* =========================================================
   Uso actual de cada tabla en la aplicación (CRM conectado por capas).
   Se aplica sobre descripciones.js: reemplaza estado, columnas usadas
   y descripción de uso. Actualizar cuando cambie el código.
   ========================================================= */
module.exports = function aplicarUso(D) {
  const TODAS = (t) => Object.keys(D.tablas[t].cols);
  const USO = {
    regiones: ['conectado', TODAS('regiones'),
      'Selector de región en los formularios de dirección (filtra las comunas; GET /api/crm/opciones) y catálogo "Regiones" en Administración (/api/crm/admin/catalogos/regiones). En el contrato impreso, vía fn_dir_region.'],
    comunas: ['conectado', TODAS('comunas'),
      'Selector de comuna de toda dirección (clientes, representantes, sucursales, propietarios) y catálogo "Comunas" en Administración. En el contrato impreso, vía fn_dir_comuna.'],
    direcciones: ['conectado', TODAS('direcciones'),
      'direcciones.repositorio.js: obtenerOCrear() busca la dirección sin distinguir mayúsculas (igual que ux_direcciones_completa) y solo inserta si no existe. La usan la ficha del cliente (domicilio del representante) y los catálogos de sucursales, propietarios y representantes.'],
    representantes_legales: ['conectado', TODAS('representantes_legales'),
      'Ficha y formulario del cliente (POST/PUT /api/crm/clientes): se crea o actualiza por RUT junto con su dirección, en la misma transacción; registrado_por lo completa la BD con app_usuario(). Administración → "Representantes legales" para los de la emisora y los propietarios. RLS: el ejecutivo ve los suyos y los ligados a clientes, emisoras o propietarios.'],
    empresas_emisoras: ['conectado', TODAS('empresas_emisoras'),
      'Selector "Empresa emisora" al crear un contrato (filtra sucursales y cuentas) y catálogo en Administración. Sus datos y su personería se imprimen en el contrato vía v_datos_contrato.'],
    propietarios_inmueble: ['conectado', TODAS('propietarios_inmueble'),
      'Catálogo en Administración (con dirección y representante). Se asigna a cada sucursal y firma la "Autorización de uso de domicilio" del contrato impreso.'],
    sucursales: ['conectado', TODAS('sucursales'),
      'Selector "Sucursal" al crear un contrato: su prefijo_folio encabeza el folio que asigna el trigger. Catálogo en Administración (prefijo de 2 letras en mayúsculas, dirección, rol y propietario). Dirección y rol aparecen en el contrato impreso.'],
    cuentas_recaudacion: ['conectado', TODAS('cuentas_recaudacion'),
      'Selector "Cuenta para transferencia" al crear un contrato (o link de pago: la BD exige uno de los dos). Catálogo en Administración. v_datos_contrato arma con ella el texto del medio de pago.'],
    roles: ['conectado', TODAS('roles'),
      'Login: el rol decide si la sesión trabaja como rol_admin ("admin" o "dueno") o como rol_ejecutivo. Administración → "Roles y permisos": crear, renombrar, eliminar (si no tiene usuarios) y asignar permisos.'],
    permisos: ['conectado', TODAS('permisos'),
      'Catálogo "Permisos" en Administración. Al iniciar sesión se cargan los permisos del rol del usuario (visibles en la insignia de rol). Las restricciones efectivas siguen siendo las del rol de base de datos (GRANT y RLS).'],
    roles_permisos: ['conectado', TODAS('roles_permisos'),
      'Administración → "Roles y permisos": casillas de permisos por rol (roles.repositorio.js reemplaza la asignación completa). Se leen al iniciar sesión.'],
    usuarios: ['conectado', TODAS('usuarios'),
      'Login (bcrypt contra password_hash; los inactivos no entran). Administración → "Usuarios": crear con contraseña (mínimo 10 caracteres, guardada como hash), cambiar nombre, correo, rol o contraseña y activar/desactivar (no a uno mismo). El nombre aparece como ejecutivo, revisor y autor en todo el CRM. También: npm run crear-usuario.'],
    registros_actividad: ['conectado', ['id', 'usuario_id', 'tabla_afectada', 'registro_id', 'accion', 'fecha'],
      'Escritura: los triggers registran cada cambio y la app inserta LOGIN y LOGOUT del personal y de los clientes del portal (estos con usuario_id NULL, tabla_afectada = clientes y registro_id = id del cliente; la Auditoría los muestra como "Cliente (portal)"). Lectura: módulo Auditoría (solo administradores) con filtros por acción, días y texto. valores_anteriores y valores_nuevos quedan guardados, pero aún no se muestran.'],
    clientes: ['conectado', TODAS('clientes'),
      'Módulo Clientes: listado con búsqueda (nombre, RUT con o sin puntos, folio) y estado calculado; ficha con representante, contratos, documentos y pagos; alta y edición con validación de RUT, correo y celular (normalizados igual que los CHECK); eliminación solo para administradores (falla si tiene contratos, documentos o pagos). Portal de clientes (/mi-cuenta): email es el identificador del acceso por enlace mágico (un enlace firmado por cada cliente con ese correo; si el correo cambia, los enlaces enviados dejan de servir) y el panel muestra sus datos, contratos, documentos y pagos en una transacción de solo lectura filtrada por su id.'],
    servicios: ['conectado', TODAS('servicios'),
      'Catálogo "Servicios" en Administración (precio neto, ciclo, descripción, activo). Selector de servicios al crear o ampliar un contrato y al crear documentos; si no se indica precio o ciclo, el trigger los copia desde aquí. El sitio público sigue usando su propio catálogo (public/js/catalogo.js).'],
    folios_correlativos: ['conectado', TODAS('folios_correlativos'),
      'La usa el trigger fn_asignar_folio en cada contrato nuevo. Administración → "Correlativos de folio" permite ajustar el último número de un año (para migrar desde el Excel); solo administradores, porque rol_ejecutivo no tiene acceso.'],
    contratos: ['conectado', TODAS('contratos').filter((c) => c !== 'datos_formulario'),
      'Módulo Contratos: listado; detalle con saldo, alertas, servicios, pagos y documentos; alta (folio, vencimiento y alertas los calcula la BD); edición de estado, vencimiento, link de pago, renovación automática y observaciones; reasignar ejecutivo solo administradores; "Renovar" crea el contrato siguiente desde el día posterior al vencimiento. También alimenta el Tablero, Renovaciones y Clientes. datos_formulario queda reservado para el formulario de contratación en línea.'],
    contrato_servicios: ['conectado', TODAS('contrato_servicios'),
      'Servicios del contrato (Anexo 1): se agregan al crear el contrato o desde su detalle; precio, ciclo y descripción vacíos los completa el trigger desde servicios; quitar es solo para administradores (rol_ejecutivo no tiene DELETE). Base del monto neto, del monto en riesgo y del ingreso recurrente mensual.'],
    plantillas_documento: ['conectado', TODAS('plantillas_documento'),
      'Catálogo "Plantillas de documento" en Administración (contenido con {variables}, campos JSON, requiere revisión). Al crear un documento se elige la plantilla: sus campos generan el formulario y su contenido se completa en la vista previa; el trigger copia requiere_revision. archivo_base guarda la ubicación del .docx, relativa a la carpeta de contratos (CONTRATOS_DIR): se elige de la lista de archivos de la carpeta o se sube uno nuevo, y es la base de "Generar contrato Word".'],
    clausulas_documento: ['conectado', TODAS('clausulas_documento'),
      'Catálogo "Cláusulas" en Administración. Al crear un documento se ofrecen las cláusulas de la familia de su plantilla, con sus propias variables.'],
    documentos: ['conectado', TODAS('documentos'),
      'Módulo Documentos: alta desde plantilla (con partes y cláusulas); detalle con el texto completado y ciclo de vida borrador → en revisión → aprobado → enviado a firma → firmado (o rechazado / anulado). Aprobar registra revisado_por = app_usuario(); firmar registra firmado_en y genera codigo_verificacion. La BD impide aprobar o firmar sin revisor cuando la plantilla lo exige. url_archivo guarda la ubicación del Word generado desde el contrato (generados/<año>/<folio> <tipo>_vN.docx, relativa a la carpeta de contratos) y se descarga con GET /api/crm/documentos/:id/archivo; regenerar crea la versión siguiente mientras el documento esté en borrador o rechazado.'],
    documento_partes: ['conectado', TODAS('documento_partes').filter((c) => c !== 'direccion_id'),
      'Sección "Partes que comparecen" del formulario de documento (persona natural o jurídica con su representante, RUT validado y acciones) y del detalle. El domicilio de cada parte (direccion_id) aún no se pide en el formulario.'],
    documento_clausulas: ['conectado', TODAS('documento_clausulas'),
      'Cláusulas marcadas al crear el documento, en orden y con sus valores; el detalle las muestra completadas a continuación del texto de la plantilla.'],
    pagos: ['conectado', TODAS('pagos'),
      'Registrar pago desde el detalle de un contrato o de un documento (cuotas 50/50 incluidas; el índice único impide dos cuotas vigentes con el mismo número) y cambiar su estado (al marcar "pagado" se completa la fecha). Módulo Ventas y pagos, Tablero y saldo de v_saldo_contrato.'],
    config_alertas: ['conectado', TODAS('config_alertas'),
      'Administración → "Plazos de alertas": agregar, activar o desactivar días de anticipación. El trigger los aplica a los contratos que se creen o cuyo vencimiento cambie desde ese momento.'],
    alertas: ['conectado', TODAS('alertas'),
      'Detalle del contrato (lista de alertas y "Marcar enviado"), Renovaciones (avisos enviados y próxima alerta) y Tablero (vencimientos sin aviso). Observación: el trigger solo crea alertas con fecha futura, así que un contrato cargado cerca de su vencimiento puede quedar sin alertas.']
  };
  for (const [t, [estado, usa, app]] of Object.entries(USO)) Object.assign(D.tablas[t], { estado, usa, app });

  Object.assign(D.vistas.v_datos_contrato, { estado: 'conectado', app: 'Página "Ver / imprimir contrato" (crm-contrato.html, GET /api/crm/contratos/:id/impresion): comparecencia, objeto, vigencia, medio de pago y autorización del propietario.' });
  Object.assign(D.vistas.v_datos_contrato_servicios, { estado: 'conectado', app: 'Tabla de precios y Anexo 1 del contrato impreso.' });
  Object.assign(D.vistas.v_saldo_contrato, { app: 'Saldo en Renovaciones, en el listado y detalle de contratos y en la ficha del cliente.' });
  D.funciones = D.funciones.map((f) => {
    if (f[0].startsWith('fn_fecha_larga')) return [f[0], f[1], f[2], 'Fechas en texto largo del contrato impreso (vía v_datos_contrato).', 'conectado'];
    if (f[0].startsWith('fn_dir_')) return [f[0], f[1], f[2], 'Direcciones del contrato impreso (v_datos_contrato) y texto de las direcciones en Administración.', 'conectado'];
    if (f[0].startsWith('fn_rut_valido')) return [f[0], f[1], f[2], 'Respaldo de la validación de la app: src/negocio/validacion.js replica el mismo algoritmo para dar mensajes claros antes de llegar a la BD.', 'conectado'];
    return f;
  });
  return D;
};
