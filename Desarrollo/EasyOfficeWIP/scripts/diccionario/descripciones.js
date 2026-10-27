// Descripciones de negocio y uso en la app, por tabla y columna.
// estado: conectado | parcial | pendiente | interno
// usa: columnas que la app lee o escribe hoy
module.exports = {
  grupos: [
    { id: 'territorio', t: '1. Territorio y direcciones', tablas: ['regiones', 'comunas', 'direcciones'] },
    { id: 'personas', t: '2. Personas y entidades', tablas: ['representantes_legales', 'empresas_emisoras', 'propietarios_inmueble', 'sucursales', 'cuentas_recaudacion'] },
    { id: 'acceso', t: '3. Roles, permisos y usuarios', tablas: ['roles', 'permisos', 'roles_permisos', 'usuarios'] },
    { id: 'auditoria', t: '4. Auditoría', tablas: ['registros_actividad'] },
    { id: 'clientes', t: '5. Clientes', tablas: ['clientes'] },
    { id: 'catalogo', t: '6. Catálogo de servicios', tablas: ['servicios'] },
    { id: 'contratos', t: '7. Contratos de servicio', tablas: ['folios_correlativos', 'contratos', 'contrato_servicios'] },
    { id: 'documentos', t: '8. Documentos por plantilla', tablas: ['plantillas_documento', 'clausulas_documento', 'documentos', 'documento_partes', 'documento_clausulas'] },
    { id: 'pagos', t: '9. Pagos y alertas', tablas: ['pagos', 'config_alertas', 'alertas'] }
  ],

  tablas: {
    regiones: {
      desc: 'Regiones de Chile. Catálogo base para ubicar comunas y direcciones.',
      estado: 'pendiente', usa: [],
      app: 'Se usará en el formulario de dirección de la ficha del cliente (módulo 1) y al mostrar el contrato (vista v_datos_contrato, vía fn_dir_region).',
      cols: { id: 'Identificador autonumérico.', nombre_region: 'Nombre de la región (único).' }
    },
    comunas: {
      desc: 'Comunas, cada una perteneciente a una región.',
      estado: 'pendiente', usa: [],
      app: 'Selector de comuna en direcciones (módulo 1). Nombre usado por fn_dir_comuna en el contrato.',
      cols: { id: 'Identificador autonumérico.', nombre_comuna: 'Nombre de la comuna; único dentro de su región.', region_id: 'Región a la que pertenece.' }
    },
    direcciones: {
      desc: 'Direcciones normalizadas (calle, número, complemento, comuna). Las comparten representantes, propietarios, sucursales y partes de documentos.',
      estado: 'pendiente', usa: [],
      app: 'Se completará desde la ficha del cliente y de sus representantes (módulo 1). Un índice único impide duplicar la misma dirección. Las funciones fn_dir_calle / fn_dir_comuna / fn_dir_region la formatean para el contrato.',
      cols: { id: 'Identificador autonumérico.', calle: 'Nombre de la calle.', numero: 'Número (texto: admite "S/N", "1234-B").', complemento: 'Oficina, depto., etc. Opcional.', comuna_id: 'Comuna de la dirección.' }
    },
    representantes_legales: {
      desc: 'Personas naturales que representan a clientes, a la empresa emisora o a propietarios. Sus datos personales los exige la comparecencia del contrato.',
      estado: 'pendiente', usa: [],
      app: 'Ficha del cliente (módulo 1): alta y edición del representante. Tiene seguridad por fila: un ejecutivo ve los que registró o los ligados a un cliente, a la emisora o a un propietario.',
      cols: { id: 'Identificador autonumérico.', rut: 'RUT sin puntos con guion (12345678-K); se valida con fn_rut_valido. Único.', nombre_completo: 'Nombre completo.', nacionalidad: 'Nacionalidad (comparecencia).', estado_civil: 'Estado civil (comparecencia).', profesion: 'Profesión u oficio (comparecencia).', direccion_id: 'Domicilio del representante.', registrado_por: 'Usuario que lo registró; por defecto app_usuario(). Base de la visibilidad por ejecutivo.' }
    },
    empresas_emisoras: {
      desc: 'Marcas que emiten los contratos (EASY OFFICE e INOFFICE). Varias marcas pueden compartir razón social, por eso el RUT no es único.',
      estado: 'pendiente', usa: [],
      app: 'Selector de emisora al crear un contrato (módulo 2) y mantención en Administración (módulo 7). El script db:revisar solo cuenta sus filas.',
      cols: { id: 'Identificador autonumérico.', nombre_comercial: 'Marca (única).', razon_social: 'Razón social legal.', rut: 'RUT de la empresa (validado).', representante_legal_id: 'Quién firma por la emisora.', personeria_fecha: 'Fecha de la personería ("con fecha 10 de agosto de 2017").', personeria_fuente: 'Fuente de la personería (p. ej. Registro de Empresas y Sociedades).', telefono: 'Teléfono de contacto que aparece en el contrato.', email: 'Correo de contacto.', activo: 'Si puede usarse en contratos nuevos.' }
    },
    propietarios_inmueble: {
      desc: 'Dueños de los inmuebles que autorizan el uso del domicilio tributario (hoja "AUTORIZACIÓN" del contrato).',
      estado: 'pendiente', usa: [],
      app: 'Administración (módulo 7). Sus datos se imprimen en el contrato vía v_datos_contrato.',
      cols: { id: 'Identificador autonumérico.', rut: 'RUT del propietario (validado, único).', razon_social: 'Razón social o nombre.', representante_legal_id: 'Representante del propietario.', direccion_id: 'Domicilio del propietario.' }
    },
    sucursales: {
      desc: 'Sucursales (inmuebles) de cada emisora. El prefijo de dos letras identifica la sucursal en el folio (LF, VL, SA).',
      estado: 'pendiente', usa: [],
      app: 'Selector de sucursal al crear un contrato (módulo 2): define el prefijo del folio. Administración (módulo 7). db:revisar cuenta sus filas.',
      cols: { id: 'Identificador autonumérico.', empresa_id: 'Emisora dueña de la sucursal.', nombre: 'Nombre de la sucursal; único por emisora.', direccion_id: 'Dirección del inmueble.', rol_propiedad: 'Rol de avalúo del inmueble (formato 123-45).', prefijo_folio: 'Dos letras mayúsculas que encabezan el folio; único.', propietario_id: 'Propietario que autoriza el domicilio.', unidad_sii: 'Unidad del SII ante la que se presenta la autorización.', activo: 'Si recibe contratos nuevos.' }
    },
    cuentas_recaudacion: {
      desc: 'Cuentas bancarias de cada emisora para recibir transferencias.',
      estado: 'pendiente', usa: [],
      app: 'Al crear un contrato (módulo 2) se elige una cuenta o se indica un link de pago (la BD exige uno de los dos). El texto del medio de pago del contrato lo arma v_datos_contrato.',
      cols: { id: 'Identificador autonumérico.', empresa_id: 'Emisora titular de la cuenta.', banco: 'Banco.', tipo_cuenta: 'Cuenta corriente, vista, etc.', numero_cuenta: 'Número; único por banco.', titular: 'Nombre del titular.', rut_titular: 'RUT del titular (validado).', activa: 'Si se ofrece en contratos nuevos.' }
    },
    roles: {
      desc: 'Roles del personal. Los nombres "admin" y "dueno" son administradores para la base de datos (función app_es_admin).',
      estado: 'conectado', usa: ['id', 'rol'],
      app: 'Login: el rol del usuario decide si la sesión trabaja como rol_admin o rol_ejecutivo (src/negocio/roles.js). Auditoría muestra el rol de cada acción. crear-usuario puede crear "admin" y "ejecutivo" si la tabla está vacía.',
      cols: { id: 'Identificador autonumérico.', rol: 'Nombre del rol (único). "admin" y "dueno" ven todo.' }
    },
    permisos: {
      desc: 'Catálogo de permisos con nombre (p. ej. "eliminar_cliente", "aprobar_documento").',
      estado: 'pendiente', usa: [],
      app: 'Hoy los permisos se aplican por rol de base de datos (GRANT) y por reglas en la capa de negocio. Se usará en Administración (módulo 7) para una matriz de permisos configurable.',
      cols: { id: 'Identificador autonumérico.', permiso: 'Nombre del permiso (único).' }
    },
    roles_permisos: {
      desc: 'Relación muchos a muchos entre roles y permisos.',
      estado: 'pendiente', usa: [],
      app: 'Administración (módulo 7). Al borrar un rol o permiso se borran sus asignaciones (ON DELETE CASCADE).',
      cols: { rol_id: 'Rol.', permisos_id: 'Permiso asignado al rol.' }
    },
    usuarios: {
      desc: 'Personal de Easy Office que usa el CRM.',
      estado: 'conectado', usa: ['id', 'nombre', 'email', 'rol_id', 'password_hash', 'activo'],
      app: 'Login del CRM (usuarios.repositorio.js): busca por email y compara password_hash con bcrypt; un usuario inactivo no entra. El nombre aparece como ejecutivo, revisor y autor en clientes, renovaciones, documentos, carga por ejecutivo y auditoría. Altas y cambios de contraseña: npm run crear-usuario.',
      cols: { id: 'Identificador; es el valor de app.usuario_actual durante la sesión.', nombre: 'Nombre visible en el CRM.', email: 'Correo de ingreso (único, sin distinguir mayúsculas: citext).', rol_id: 'Rol del usuario.', password_hash: 'Hash bcrypt de la contraseña. rol_ejecutivo no puede leer esta columna.', activo: 'Si puede ingresar.' }
    },
    registros_actividad: {
      desc: 'Bitácora inmutable: cada INSERT/UPDATE/DELETE de las tablas auditadas (por trigger) y cada LOGIN/LOGOUT del CRM. No se puede modificar, borrar ni vaciar.',
      estado: 'conectado', usa: ['id', 'usuario_id', 'tabla_afectada', 'registro_id', 'accion', 'fecha'],
      app: 'Escritura: el trigger fn_registrar_actividad registra los cambios; la app solo inserta LOGIN y LOGOUT (auth.servicio.js). Lectura: módulo Auditoría del CRM, solo administradores, con filtros por acción, días y texto.',
      cols: { id: 'Identificador autonumérico (bigint).', usuario_id: 'Quién hizo la acción; NULL = acción automática del sistema.', tabla_afectada: 'Tabla modificada (o "usuarios" para LOGIN/LOGOUT).', registro_id: 'Id del registro afectado.', accion: 'INSERT, UPDATE, DELETE, LOGIN o LOGOUT.', valores_anteriores: 'Fila completa antes del cambio (JSON).', valores_nuevos: 'Fila completa después del cambio (JSON).', fecha: 'Momento de la acción (con zona horaria).' }
    },
    clientes: {
      desc: 'Clientes de Easy Office: una razón social = un cliente. Puede tener varios contratos (renovaciones).',
      estado: 'conectado', usa: ['id', 'rut', 'razon_social', 'nombre_fantasia', 'email', 'celular', 'creado_en'],
      app: 'Módulo Clientes: listado con búsqueda por nombre, RUT con o sin puntos (formateado con fn_rut_formato) o folio, estado calculado desde su último contrato, y eliminación solo para administradores. También aparece en el tablero, renovaciones, documentos y pagos. Ficha y edición: módulo 1.',
      cols: { id: 'Identificador autonumérico.', rut: 'RUT sin puntos con guion; validado y único.', razon_social: 'Razón social (búsqueda e índice por minúsculas).', nombre_fantasia: 'Nombre de fantasía.', giro_principal: 'Giro comercial.', email: 'Correo de contacto (formato validado).', celular: 'Celular chileno de 9 dígitos que empieza en 9.', representante_legal_id: 'Representante legal del cliente.', fecha_escritura: 'Fecha de la escritura o estatuto vigente.', sitio_notaria: 'Sitio web o notaría de la escritura.', registrado_por: 'Usuario que lo registró (visibilidad por ejecutivo).', creado_en: 'Fecha de alta ("cliente desde").' }
    },
    servicios: {
      desc: 'Catálogo interno de servicios con precio de lista NETO (más IVA) y ciclo de pago por defecto.',
      estado: 'parcial', usa: ['id', 'nombre'],
      app: 'Hoy solo se lee su nombre para mostrar qué servicios tiene cada cliente o contrato. Al crear un contrato (módulo 2) el trigger copia precio, ciclo y descripción desde aquí. El catálogo del sitio público aún sale de public/js/catalogo.js; pasar a esta tabla solo cambia catalogo.repositorio.js.',
      cols: { id: 'Identificador autonumérico.', nombre: 'Nombre del servicio (único).', tipo: 'PRINCIPAL (del formulario) o COMPLEMENTARIO (Anexo 1).', descripcion_base: 'Texto por defecto del servicio en el contrato.', precio_lista: 'Precio neto en CLP; NULL = por cotizar.', precio_desde: 'Si el precio se muestra como "desde".', unidad: 'Unidad de cobro ("por firma", "por página").', incluye_iva: 'Si el precio ya incluye IVA.', ciclo_pago_defecto: 'UNICO, MENSUAL, TRIMESTRAL, SEMESTRAL o ANUAL.', campos_formulario: 'Campos extra que pide el servicio (JSON).', activo: 'Si se ofrece.' }
    },
    folios_correlativos: {
      desc: 'Contador de folios por año, igual que la macro GenerarFolio del Excel: un correlativo único por año para todas las sucursales.',
      estado: 'interno', usa: [],
      app: 'La app no la toca: la usa el trigger fn_asignar_folio al insertar un contrato. Antes de migrar el Excel conviene cargar aquí el último número de cada año. rol_ejecutivo no tiene acceso.',
      cols: { anio: 'Año del correlativo.', ultimo: 'Último número usado en ese año.' }
    },
    contratos: {
      desc: 'Contratos de servicio; cada uno es un FOLIO (p. ej. LF-0152-2026). Núcleo del negocio: vigencia, estado, ejecutivo y medio de pago.',
      estado: 'conectado', usa: ['id', 'folio', 'cliente_id', 'fecha_vencimiento', 'estado', 'ejecutivo_id', 'creado_en', 'renovacion_automatica', 'link_pago'],
      app: 'Tablero (vigentes, vencidos sin renovar, vencen en 30 días, ingreso recurrente, proyección de 6 meses), Renovaciones (etapas D-60 a D+30) y Clientes (estado desde el último contrato). Seguridad por fila: el ejecutivo solo ve los contratos donde es ejecutivo_id. Crear contratos: módulo 2 (folio, vencimiento y alertas los calcula la BD).',
      cols: { id: 'Identificador autonumérico.', folio: 'PREFIJO-correlativo-año; lo asigna el trigger si viene vacío. Único.', empresa_id: 'Emisora del contrato.', cliente_id: 'Cliente.', sucursal_id: 'Sucursal (debe ser de la misma emisora).', cuenta_recaudacion_id: 'Cuenta para transferencias (de la misma emisora).', link_pago: 'Link de pago; obligatorio si no hay cuenta.', lugar_celebracion: 'Ciudad de firma ("En Santiago, a ...").', fecha_celebracion: 'Fecha de firma; define el año del folio.', fecha_inicio: 'Inicio de la vigencia.', duracion_meses: 'Duración: 12, 6, 4, 3 o 1 meses.', fecha_vencimiento: 'Fin de la vigencia; por defecto inicio + duración − 1 día. Base de las alertas.', renovacion_automatica: 'Cláusula QUINTO del contrato.', estado: 'pendiente, activo, vencido o cancelado.', ejecutivo_id: 'Ejecutivo a cargo (define quién lo ve).', observaciones: 'Notas internas.', datos_formulario: 'Respuestas del formulario de contratación (JSON).', creado_en: 'Fecha de registro ("creados este mes").' }
    },
    contrato_servicios: {
      desc: 'Servicios incluidos en cada contrato (Anexo 1), con su precio y ciclo. Si no se indican, el trigger los copia del catálogo.',
      estado: 'conectado', usa: ['contrato_id', 'servicio_id', 'precio', 'ciclo_pago', 'orden'],
      app: 'Suma del monto neto de cada contrato, monto en riesgo y el ingreso recurrente mensual (precio llevado a mes según ciclo_pago). Nombres de servicios en Clientes, Renovaciones y Pagos. Alta: módulo 2.',
      cols: { id: 'Identificador autonumérico.', contrato_id: 'Contrato (se borra con él).', orden: 'Posición en el Anexo 1.', servicio_id: 'Servicio del catálogo (una vez por contrato).', precio: 'Precio neto acordado.', ciclo_pago: 'Ciclo de cobro de este servicio.', descripcion: 'Contenido del servicio en el contrato.' }
    },
    plantillas_documento: {
      desc: 'Plantillas de documentos (contrato de servicio, poder, acuerdo de accionistas, arriendo...) con sus variables y si requieren revisión humana.',
      estado: 'parcial', usa: ['id', 'tipo_documento'],
      app: 'Hoy solo se muestra el nombre de la plantilla en el módulo Documentos. Crear documentos desde plantilla: módulo 4. El trigger copia requiere_revision al documento.',
      cols: { id: 'Identificador autonumérico.', tipo_documento: 'Nombre del tipo; único por versión.', version: 'Versión de la plantilla.', familia: 'CONTRATO_SERVICIO, PODER, ACUERDO_ACCIONISTAS, ARRIENDO u OTRO.', archivo_base: 'Archivo .docx de origen.', contenido_plantilla: 'Texto con {variables}.', campos: 'Variables: [{clave, etiqueta, tipo}] (JSON).', requiere_revision: 'Si necesita aprobación humana antes de firmar.', activo: 'Si se puede usar.' }
    },
    clausulas_documento: {
      desc: 'Cláusulas reutilizables para armar documentos por artículos (p. ej. cambio de razón social en un acuerdo de accionistas).',
      estado: 'pendiente', usa: [],
      app: 'Selector de cláusulas al crear documentos (módulo 4).',
      cols: { id: 'Identificador autonumérico.', familia: 'Familia de documento a la que aplica.', codigo: 'Código de la cláusula; único por familia.', titulo: 'Título.', texto_plantilla: 'Texto con {variables}.', campos: 'Variables de la cláusula (JSON).', activo: 'Si se ofrece.' }
    },
    documentos: {
      desc: 'Documentos generados para un cliente (y, si corresponde, para un contrato), con su ciclo: borrador → en revisión → aprobado → enviado a firma → firmado.',
      estado: 'conectado', usa: ['id', 'cliente_id', 'contrato_id', 'plantilla_id', 'tipo', 'estado', 'requiere_revision', 'revisado_por', 'revisado_en', 'ejecutivo_id', 'firmado_en', 'codigo_verificacion', 'generado_en'],
      app: 'Módulo Documentos: etapas por estado, listado y botón Aprobar (escribe estado, revisado_por = app_usuario() y revisado_en). Tablero: documentos en revisión y carga por ejecutivo. La BD impide aprobar, enviar o firmar sin revisor cuando requiere_revision es verdadero.',
      cols: { id: 'Identificador autonumérico.', cliente_id: 'Cliente dueño del documento.', contrato_id: 'Contrato de origen (opcional; debe ser del mismo cliente).', servicio_id: 'Servicio vendido (p. ej. "Declaración jurada").', plantilla_id: 'Plantilla usada.', tipo: 'Tipo de documento visible.', lugar: 'Lugar del documento.', fecha_documento: 'Fecha del documento.', datos: 'Valores de las variables de la plantilla (JSON).', estado: 'borrador, en_revision, aprobado, enviado_firma, firmado, rechazado o anulado.', requiere_revision: 'Copiado de la plantilla; obliga a tener revisor.', revisado_por: 'Usuario que aprobó.', revisado_en: 'Momento de la aprobación.', ejecutivo_id: 'Ejecutivo que lo gestiona (visibilidad).', url_archivo: 'Archivo generado.', firma_id_externo: 'Id en la plataforma de firma electrónica.', firmado_en: 'Momento de la firma.', codigo_verificacion: 'Código público para verificar el documento.', generado_en: 'Fecha de creación.' }
    },
    documento_partes: {
      desc: 'Personas que comparecen en un documento (arrendador, accionista, apoderado...).',
      estado: 'pendiente', usa: [],
      app: 'Formulario de partes al crear un documento (módulo 4). Hereda la visibilidad del documento.',
      cols: { id: 'Identificador autonumérico.', documento_id: 'Documento (se borra con él).', orden: 'Orden de aparición; único por documento.', rol: 'Papel en el documento.', tipo_persona: 'natural o juridica.', nombre: 'Nombre o razón social.', rut: 'RUT (validado si se indica).', nacionalidad: 'Nacionalidad.', estado_civil: 'Estado civil.', profesion: 'Profesión.', direccion_id: 'Domicilio.', email: 'Correo.', telefono: 'Teléfono.', representante_nombre: 'Representante si es persona jurídica.', representante_rut: 'RUT del representante (validado).', cantidad_acciones: 'Acciones (acuerdos de accionistas).' }
    },
    documento_clausulas: {
      desc: 'Cláusulas elegidas para un documento, en orden, con sus valores.',
      estado: 'pendiente', usa: [],
      app: 'Armado de documentos por cláusulas (módulo 4). Hereda la visibilidad del documento.',
      cols: { id: 'Identificador autonumérico.', documento_id: 'Documento (se borra con él).', orden: 'Posición; única por documento.', clausula_id: 'Cláusula del catálogo.', valores: 'Valores de las variables (JSON).' }
    },
    pagos: {
      desc: 'Pagos de un contrato o de un documento suelto (servicios instantáneos), con pasarela y cuotas (50/50 = cuota 1 de 2 y 2 de 2).',
      estado: 'conectado', usa: ['id', 'contrato_id', 'documento_id', 'monto', 'estado', 'pasarela', 'fecha_pago', 'cuota', 'total_cuotas'],
      app: 'Módulo Ventas y pagos (resumen de 30 días por pasarela y últimos 100 pagos) y tablero (7 días). Su suma alimenta el saldo de v_saldo_contrato en Renovaciones. Registrar pagos: módulo 5. Un índice impide dos cuotas vigentes con el mismo número.',
      cols: { id: 'Identificador autonumérico.', contrato_id: 'Contrato pagado (o documento).', documento_id: 'Documento pagado (o contrato).', monto: 'Monto en CLP (mayor que 0).', estado: 'pendiente, pagado, rechazado o reembolsado.', pasarela: 'mercado_pago, transbank o transferencia.', fecha_pago: 'Momento del pago.', cuota: 'Número de cuota.', total_cuotas: 'Total de cuotas del pago.' }
    },
    config_alertas: {
      desc: 'Con cuántos días de anticipación se avisa un vencimiento. Viene cargada con 60, 30, 15 y 7.',
      estado: 'pendiente', usa: [],
      app: 'La lee el trigger fn_generar_alertas. Su edición se hará en Administración (módulo 6). rol_ejecutivo solo puede leerla.',
      cols: { dias_anticipacion: 'Días antes del vencimiento (clave).', activo: 'Si se generan alertas para ese plazo.' }
    },
    alertas: {
      desc: 'Alertas de vencimiento por contrato, generadas automáticamente al crear un contrato o cambiar su vencimiento.',
      estado: 'conectado', usa: ['contrato_id', 'fecha_alerta', 'notificado'],
      app: 'Renovaciones: cuántos avisos se enviaron y la fecha de la próxima alerta. Tablero: vencimientos sin aviso. Marcar como notificada: módulo 6 (rol_ejecutivo puede actualizarla).',
      cols: { id: 'Identificador autonumérico.', contrato_id: 'Contrato (se borra con él).', fecha_alerta: 'Fecha en que corresponde avisar.', dias_anticipacion: 'Plazo de la alerta (60, 30, 15, 7).', notificado: 'Si el aviso ya se envió.' }
    }
  },

  vistas: {
    v_datos_contrato: { estado: 'pendiente', desc: 'Una fila por contrato con todos los datos para combinar el contrato en Word: emisora, representante, sucursal, cliente, condiciones, medio de pago y propietario. Fechas en texto largo y RUT con puntos.', app: 'Página "ver/imprimir contrato" (módulo 3). Respeta la seguridad de quien consulta (security_invoker).' },
    v_datos_contrato_servicios: { estado: 'pendiente', desc: 'Una fila por servicio de cada contrato: tabla de precios y Anexo 1.', app: 'Tabla de servicios del contrato impreso (módulo 3).' },
    v_saldo_contrato: { estado: 'conectado', desc: 'Total neto de servicios, monto pagado (pagos en estado pagado) y saldo pendiente por contrato.', app: 'Columna Saldo del módulo Renovaciones (contratos.repositorio.js).' }
  },

  funciones: [
    ['fn_rut_valido(rut)', 'boolean', 'Valida formato 12345678-K y dígito verificador (módulo 11). Se usa en los CHECK de todos los RUT.', 'Indirecto: protege toda escritura de RUT. Un RUT inválido llega a la app como error 400 "RUT inválido".', 'conectado'],
    ['fn_rut_formato(rut)', 'text', '77496835-0 → 77.496.835-0.', 'Clientes y Renovaciones muestran el RUT formateado.', 'conectado'],
    ['fn_fecha_larga(fecha)', 'text', '2026-10-02 → "02 DE OCTUBRE DE 2026".', 'Contrato impreso vía v_datos_contrato (módulo 3).', 'pendiente'],
    ['app_usuario()', 'int', 'Lee app.usuario_actual (lo fija la app en cada transacción).', 'conUsuario() lo fija; documentos.repositorio.js lo usa como revisado_por; triggers lo usan como autor en auditoría.', 'conectado'],
    ['app_es_admin()', 'boolean', 'Verdadero si app.rol_actual es "admin" o "dueno".', 'Las políticas RLS lo consultan. La regla equivalente en la app está en src/negocio/roles.js.', 'conectado'],
    ['fn_dir_calle / fn_dir_comuna / fn_dir_region(id)', 'text', 'Formatean una dirección para el contrato.', 'v_datos_contrato (módulo 3).', 'pendiente']
  ],

  triggers: [
    ['trg_defaults_contrato_servicio', 'contrato_servicios', 'BEFORE INSERT', 'Copia precio, ciclo y descripción desde servicios si no se indican.'],
    ['trg_defaults_contrato', 'contratos', 'BEFORE INSERT', 'fecha_vencimiento = inicio + duración − 1 día si viene vacía.'],
    ['trg_asignar_folio', 'contratos', 'BEFORE INSERT', 'Asigna folio PREFIJO-NNNN-AÑO usando folios_correlativos; si viene uno manual, valida el prefijo y avanza el contador.'],
    ['trg_generar_alertas', 'contratos', 'AFTER INSERT / UPDATE OF fecha_vencimiento', 'Crea las alertas según config_alertas (solo fechas futuras) y borra las no notificadas al cambiar el vencimiento.'],
    ['trg_defaults_documento', 'documentos', 'BEFORE INSERT', 'Copia requiere_revision desde la plantilla.'],
    ['trg_auditoria_<tabla>', '16 tablas', 'AFTER INSERT / UPDATE / DELETE', 'Registra la acción en registros_actividad con valores anteriores y nuevos, y app_usuario() como autor.'],
    ['trg_auditoria_inmutable / _no_truncate', 'registros_actividad', 'BEFORE UPDATE / DELETE / TRUNCATE', 'Impide alterar o borrar la bitácora.']
  ]
};
