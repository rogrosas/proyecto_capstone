/* =========================================================
   Diccionario de datos · lo que agrega el esquema v2 (easyoffice_v2.sql)
   sobre descripciones.js + uso-app.js: tablas nuevas, columnas nuevas
   y su uso actual en la aplicación. Actualizar cuando cambie el esquema.
   ========================================================= */
module.exports = function aplicarV2(D) {
  D.grupos.find((g) => g.id === 'documentos').tablas.push('documento_versiones', 'documento_firmantes', 'plantilla_planes');
  D.grupos.find((g) => g.id === 'pagos').tablas.push('ejecuciones_avisos');
  D.grupos.push(
    { id: 'portal', t: '10. Portal de clientes', tablas: ['cuentas_portal', 'tickets', 'ticket_mensajes'] },
    { id: 'operacion', t: '11. Operación diaria', tablas: ['movimientos_firmas', 'correspondencia', 'gestiones', 'prospectos', 'carros', 'solicitudes_titular'] }
  );

  const columnas = (t, cols) => Object.assign(D.tablas[t].cols, cols);
  const tabla = (t, def) => { D.tablas[t] = def; };

  /* ---------- columnas nuevas en tablas existentes ---------- */
  columnas('usuarios', {
    totp_secreto: 'Secreto del segundo factor (TOTP), cifrado por la aplicación con AES-256-GCM. NULL si no lo activó.',
    totp_activo: 'Si el usuario ingresa con el código de 6 dígitos de su aplicación autenticadora.',
    intentos_fallidos: 'Intentos de ingreso fallidos seguidos (se reinicia al entrar).',
    bloqueado_hasta: 'Bloqueo temporal por intentos fallidos.',
    ultimo_acceso: 'Fecha del último ingreso.',
    creado_en: 'Fecha de creación del usuario.'
  });
  columnas('representantes_legales', { email: 'Correo del representante: recibe los avisos, el borrador y el enlace de firma de la empresa.' });
  columnas('registros_actividad', {
    cliente_id: 'Cliente afectado (sin FK: el registro sobrevive aunque el cliente se elimine).',
    detalle: 'Texto libre: correo intentado, aceptación del cliente, acción denegada…',
    ip: 'IP de la petición.', user_agent: 'Navegador de la petición.'
  });
  columnas('clientes', {
    tipo_persona: 'natural o juridica (la BD lo sugiere por el RUT si no se indica). Una empresa exige representante legal.',
    direccion_id: 'Domicilio del cliente.',
    origen: 'crm (lo registró el personal), web (compra en la tienda) o migracion (planilla Excel).',
    acepta_comunicaciones: 'Consentimiento para comunicaciones comerciales (Ley 21.719).',
    consentimiento_en: 'Cuándo dio el consentimiento (obligatorio si acepta).'
  });
  columnas('servicios', {
    codigo: 'Código del plan en la tienda (ej. dom-anual): enlaza el catálogo del sitio con el servicio.',
    firmas_incluidas: 'Firmas electrónicas que trae el servicio: al contratarlo suman saldo al cliente (movimientos_firmas).'
  });
  columnas('contratos', {
    contrato_anterior_id: 'Contrato que este renueva (misma persona): la renovación queda explícita.',
    origen: 'crm, web o migracion.'
  });
  columnas('plantillas_documento', {
    entrega: 'automatica (al comprar se publica el borrador al cliente) o revision (espera que el personal lo apruebe y publique).',
    mapa_campos: 'Qué dato va en cada marca del Word: {"[RUT EMPRESA]": {"dato": "RUT"}, "[PATENTE]": {"dato": "_tienda", "etiqueta": "Patente"}}.'
  });
  columnas('documentos', {
    version_aprobada: 'Versión del Word que aprobó el personal.',
    estado_cliente: 'Revisión del cliente: por_revisar (ve el borrador con marca de agua), aceptado u objetado (envió un ticket).',
    publicado_en: 'Desde cuándo el cliente ve el borrador.',
    aceptado_en: 'Cuándo lo aceptó.', aceptado_por: 'Correo de quien lo aceptó.', aceptado_ip: 'IP desde la que lo aceptó.',
    version_aceptada: 'Versión del Word que aceptó el cliente.',
    firma_proveedor: 'Plataforma de firma usada: simulador (laboratorio) o la real.',
    enviado_firma_en: 'Cuándo se envió a la plataforma de firma.',
    archivo_firmado: 'Documento firmado que devolvió la plataforma (ruta relativa a la carpeta de contratos).',
    hash_firmado: 'Huella SHA-256 del documento firmado: /verificar la compara con el archivo que tenga el usuario.'
  });
  columnas('pagos', {
    id_transaccion: 'Id de la transacción en la pasarela (único por pasarela).',
    codigo_autorizacion: 'Código de autorización de la pasarela.', ultimos_4: 'Últimos 4 dígitos de la tarjeta.',
    respuesta_pasarela: 'Respuesta completa de la pasarela (JSON), para conciliación.', conciliado_en: 'Cuándo se confirmó con la pasarela.',
    tipo_dte: 'Documento tributario: boleta, factura o exento.', folio_dte: 'Folio del DTE.', url_dte: 'Enlace al DTE emitido.'
  });
  columnas('alertas', { canal: 'Por dónde se avisó: correo (envío automático), whatsapp, llamada o manual.', enviado_en: 'Cuándo se avisó.' });

  /* ---------- tablas nuevas ---------- */
  tabla('documento_versiones', {
    desc: 'Cada versión generada de un documento Word, con su huella SHA-256.',
    estado: 'conectado', usa: ['documento_id', 'version', 'url_archivo', 'hash_sha256'],
    app: 'Generar contrato Word: cada regeneración crea la versión siguiente. La aceptación del cliente guarda qué versión aceptó.',
    cols: { id: 'Identificador.', documento_id: 'Documento.', version: 'Número de versión (1, 2…).', url_archivo: 'Ruta del Word de esa versión.', hash_sha256: 'Huella del archivo.', generado_por: 'Usuario que la generó.', generado_en: 'Fecha.' }
  });
  tabla('documento_firmantes', {
    desc: 'Quienes firman cada documento en la plataforma de firma electrónica y en qué estado está su firma.',
    estado: 'conectado', usa: ['documento_id', 'orden', 'nombre', 'rut', 'email', 'estado', 'id_externo', 'firmado_en', 'ip', 'motivo_rechazo'],
    app: 'Enviar a firma (CRM o al aceptar el borrador): la persona natural o el representante legal. La plataforma avisa cada firma o rechazo; con todas las firmas el documento pasa a "firmado". Se muestra en el detalle del documento, en Mi cuenta y (con iniciales) en /verificar.',
    cols: { id: 'Identificador.', documento_id: 'Documento.', orden: 'Orden de firma.', nombre: 'Nombre del firmante.', rut: 'RUT (validado).', email: 'Correo donde recibe el enlace.', estado: 'pendiente, firmado o rechazado.', id_externo: 'Id del firmante en la plataforma.', firmado_en: 'Cuándo firmó.', ip: 'IP desde la que firmó.', motivo_rechazo: 'Por qué rechazó (abre un ticket).', creado_en: 'Fecha.' }
  });
  tabla('plantilla_planes', {
    desc: 'Planes de la tienda que generan cada plantilla Word al comprarse.',
    estado: 'conectado', usa: ['plantilla_id', 'plan_codigo'],
    app: 'Administración → Documentos de la tienda (vincular planes) y compra en /contratar (qué documentos generar y qué preguntar).',
    cols: { plantilla_id: 'Plantilla Word.', plan_codigo: 'Código del plan en la tienda (ej. dom-anual).' }
  });
  tabla('ejecuciones_avisos', {
    desc: 'Registro de cada envío de avisos de vencimiento por correo.',
    estado: 'conectado', usa: ['origen', 'usuario_id', 'iniciado_en', 'terminado_en', 'contratos', 'correos', 'sin_correo', 'errores', 'detalle'],
    app: 'avisos.servicio.js: una vez al día (AVISOS_HORA) o con "Enviar avisos pendientes ahora" en Renovaciones. Evita repetir el envío automático el mismo día y muestra el último resultado.',
    cols: { id: 'Identificador.', origen: 'automatico o manual.', usuario_id: 'Quién lo pidió (manual).', iniciado_en: 'Inicio.', terminado_en: 'Término.', contratos: 'Contratos avisados.', correos: 'Correos enviados a clientes.', sin_correo: 'Contratos cuyo cliente no tiene correo (para llamar).', errores: 'Envíos con error (se reintentan).', detalle: 'Lista por contrato: folio, cliente y resultado.' }
  });
  tabla('cuentas_portal', {
    desc: 'Personas que entran a Mi cuenta por un cliente, con su contraseña (bcrypt).',
    estado: 'conectado', usa: ['cliente_id', 'email', 'nombre', 'autorizado', 'password_hash', 'activo', 'clave_definida_en', 'ultimo_ingreso', 'registrado_por', 'creado_en'],
    app: 'Ingreso al portal (empresa: RUT + correo + clave; persona: correo + clave), creación y recuperación de la clave con enlace de un solo uso, y "Acceso al portal" en la ficha del cliente (autorizar, bloquear).',
    cols: { id: 'Identificador.', cliente_id: 'Cliente.', email: 'Correo de la persona.', nombre: 'Nombre de la persona autorizada.', autorizado: 'true si la agregó el personal (además del titular o representante).', password_hash: 'Contraseña en bcrypt; NULL hasta que la crea.', activo: 'false: el personal le quitó el acceso.', clave_definida_en: 'Cuándo creó o cambió la clave.', ultimo_ingreso: 'Último ingreso.', registrado_por: 'Usuario que la autorizó.', creado_en: 'Fecha.' }
  });
  tabla('tickets', {
    desc: 'Mensajes del cliente a la administración: no está de acuerdo con un documento, consultas, o rechazo de una firma.',
    estado: 'conectado', usa: ['cliente_id', 'documento_id', 'email', 'motivo', 'detalle', 'estado', 'respuesta', 'atendido_por', 'creado_en', 'actualizado_en'],
    app: 'Mi cuenta (enviar y ver respuestas), CRM → Tickets (responder y cerrar) y detalle del documento. Un rechazo en la plataforma de firma abre uno automáticamente.',
    cols: { id: 'Identificador.', cliente_id: 'Cliente.', documento_id: 'Documento objetado (si aplica).', email: 'Quién lo envió.', motivo: 'datos_incorrectos, condiciones, falta_informacion u otro.', detalle: 'Mensaje del cliente.', estado: 'abierto, en_proceso, resuelto o cerrado.', respuesta: 'Respuesta del personal.', atendido_por: 'Quién respondió.', creado_en: 'Fecha.', actualizado_en: 'Última actualización.' }
  });
  tabla('ticket_mensajes', {
    desc: 'Conversación de cada ticket: mensajes del cliente y del personal, con su autor y hora, y los cambios de estado.',
    estado: 'conectado', usa: ['ticket_id', 'autor_tipo', 'usuario_id', 'email', 'texto', 'creado_en'],
    app: 'CRM → Tickets (conversación, responder y cambiar el estado) y Mi cuenta → Mis tickets (ver y responder). Responder un ticket resuelto lo reabre; uno cerrado no admite mensajes.',
    cols: { id: 'Identificador.', ticket_id: 'Ticket.', autor_tipo: 'cliente, personal o sistema (cambio de estado).', usuario_id: 'Quién del personal escribió o cambió el estado.', email: 'Quién del cliente escribió.', texto: 'Mensaje.', creado_en: 'Fecha y hora.' }
  });
  tabla('movimientos_firmas', {
    desc: 'Compras y consumos de firmas electrónicas de cada cliente (bolsas y planes con firmas incluidas).',
    estado: 'conectado', usa: ['cliente_id', 'motivo', 'cantidad', 'vence_en', 'contrato_id', 'documento_id', 'detalle', 'creado_en'],
    app: 'Los crean los disparadores (al contratar un servicio con firmas, y al firmarse un documento). El saldo (v_saldo_firmas) se ve en Mi cuenta y en la ficha del cliente.',
    cols: { id: 'Identificador.', cliente_id: 'Cliente.', motivo: 'compra, consumo o ajuste.', cantidad: 'Positivo suma, negativo descuenta.', vence_en: 'Vigencia de una compra.', contrato_id: 'Contrato con que se compró.', documento_id: 'Documento que consumió la firma.', detalle: 'Texto.', registrado_por: 'Usuario.', creado_en: 'Fecha.' }
  });
  tabla('correspondencia', {
    desc: 'Cartas y notificaciones recibidas en el domicilio tributario de cada cliente (oficina de partes).',
    estado: 'conectado', usa: ['cliente_id', 'sucursal_id', 'remitente', 'tipo', 'descripcion', 'urgente', 'estado', 'recibida_en', 'plazo_en', 'notificada_en', 'leida_en', 'retirada_en', 'url_archivo'],
    app: 'CRM → Correspondencia: registrar, subir el escaneo (PDF/JPG/PNG en Contratos/correspondencia), avisar al cliente por correo y marcar retirada o devuelta. Mi cuenta → Documentos: el cliente la ve y abrir el escaneo la marca como leída.',
    cols: { id: 'Identificador.', cliente_id: 'Cliente.', sucursal_id: 'Sucursal que la recibió.', remitente: 'Quién la envía (ej. Servicio de Impuestos Internos).', tipo: 'fiscal, judicial, laboral, municipal, bancaria, comercial u otra.', descripcion: 'Detalle.', urgente: 'Fiscal, judicial y laboral son urgentes por defecto.', estado: 'recibida, digitalizada, notificada, retirada o devuelta.', recibida_en: 'Cuándo llegó.', plazo_en: 'Compromiso de aviso (por defecto 24 h).', digitalizada_en: 'Cuándo se escaneó.', notificada_en: 'Cuándo se avisó al cliente.', leida_en: 'Cuándo la vio el cliente en el portal.', retirada_en: 'Cuándo la retiró.', url_archivo: 'Escaneo.', registrado_por: 'Usuario.' }
  });
  tabla('gestiones', {
    desc: 'Bitácora de gestiones con el cliente: llamadas, correos, reuniones, links de pago y notas.',
    estado: 'conectado', usa: ['cliente_id', 'contrato_id', 'usuario_id', 'tipo', 'resultado', 'nota', 'proxima_accion_en', 'creado_en'],
    app: 'Ficha del cliente → "Bitácora de gestiones" (registrar y ver). La próxima acción vencida aparece en el Tablero como "Seguimiento" hasta que se registra otra gestión.',
    cols: { id: 'Identificador.', cliente_id: 'Cliente.', contrato_id: 'Contrato relacionado (opcional).', usuario_id: 'Quién la registró (app_usuario()).', tipo: 'llamada, correo, whatsapp, reunion, link_pago o nota.', resultado: 'sin_respuesta, contactado, promete_pago, renueva, no_renueva u otro.', nota: 'Texto.', proxima_accion_en: 'Fecha comprometida para el siguiente contacto.', creado_en: 'Fecha.' }
  });
  tabla('prospectos', {
    desc: 'Interesados que aún no son clientes: formulario de contacto, llamadas y reuniones.',
    estado: 'pendiente', usa: [], app: 'Previsto para el formulario de contacto del sitio.',
    cols: { id: 'Identificador.', nombre: 'Nombre.', email: 'Correo.', celular: 'Celular.', servicio_interes: 'Servicio que le interesa.', mensaje: 'Mensaje.', origen: 'web, telefono, correo, referido, agenda u otro.', estado: 'nuevo, contactado, convertido o descartado.', asignado_a: 'Ejecutivo.', cliente_id: 'Cliente en que se convirtió.', acepta_comunicaciones: 'Consentimiento.', creado_en: 'Fecha.' }
  });
  tabla('carros', {
    desc: 'Compras empezadas en la tienda y no terminadas (para recordarlas).',
    estado: 'pendiente', usa: [], app: 'Previsto para recordar compras abandonadas.',
    cols: { id: 'Identificador.', email: 'Correo del comprador.', servicio_id: 'Servicio.', codigo_plan: 'Plan de la tienda.', datos: 'Datos del formulario.', creado_en: 'Fecha.', recordado_en: 'Cuándo se le recordó.', convertido_contrato_id: 'Contrato si terminó la compra.', convertido_en: 'Cuándo.' }
  });
  tabla('solicitudes_titular', {
    desc: 'Solicitudes de los titulares de datos personales (Ley 21.719): acceso, rectificación, supresión, oposición, portabilidad y bloqueo.',
    estado: 'pendiente', usa: [], app: 'Prevista para Mi cuenta y un módulo de atención en el CRM.',
    cols: { id: 'Identificador.', cliente_id: 'Cliente (si lo es).', email: 'Correo del titular.', tipo: 'Derecho ejercido.', detalle: 'Detalle.', estado: 'recibida, en_proceso, respondida o rechazada.', recibida_en: 'Fecha.', plazo_en: 'Plazo de respuesta.', respondida_en: 'Cuándo se respondió.', respuesta: 'Respuesta.', atendida_por: 'Usuario.' }
  });

  // Uso actualizado de tablas que ya existían
  D.tablas.alertas.app += ' Envío automático: avisos.servicio.js manda el correo al cliente y marca canal = correo.';
  D.tablas.alertas.usa = Object.keys(D.tablas.alertas.cols);
  return D;
};
