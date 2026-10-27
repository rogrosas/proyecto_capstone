/* =========================================================
   CAPA DE NEGOCIO · Catálogos editables en Administración.
   Lista blanca: solo estas tablas y columnas se pueden escribir
   desde la app. La capa de presentación entrega estas definiciones
   al navegador para dibujar los formularios.

   tipo: texto | textarea | numero | fecha | bool | rut | email | json
         | opcion (valores fijos) | ref (id de otro catálogo) | direccion
   ========================================================= */
const { CICLOS } = require('./validacion');

const FAMILIAS = ['CONTRATO_SERVICIO', 'PODER', 'ACUERDO_ACCIONISTAS', 'ARRIENDO', 'OTRO'];

const D = {
  servicios: {
    titulo: 'Servicios', grupo: 'Catálogo comercial', tabla: 'servicios', clave: 'id', orden: ['tipo', 'nombre'],
    lista: ['nombre', 'tipo', 'precio_lista', 'ciclo_pago_defecto', 'activo'],
    campos: [
      { columna: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
      { columna: 'tipo', etiqueta: 'Tipo', tipo: 'opcion', opciones: ['PRINCIPAL', 'COMPLEMENTARIO'], requerido: true },
      { columna: 'precio_lista', etiqueta: 'Precio de lista neto (vacío = por cotizar)', tipo: 'numero' },
      { columna: 'precio_desde', etiqueta: 'Mostrar como "desde"', tipo: 'bool' },
      { columna: 'incluye_iva', etiqueta: 'El precio incluye IVA', tipo: 'bool' },
      { columna: 'unidad', etiqueta: 'Unidad ("por firma", "por página")', tipo: 'texto' },
      { columna: 'ciclo_pago_defecto', etiqueta: 'Ciclo de pago por defecto', tipo: 'opcion', opciones: CICLOS, requerido: true },
      { columna: 'descripcion_base', etiqueta: 'Descripción para el contrato', tipo: 'textarea' },
      { columna: 'campos_formulario', etiqueta: 'Campos del formulario (JSON)', tipo: 'json' },
      { columna: 'activo', etiqueta: 'Activo', tipo: 'bool', porDefecto: true }
    ]
  },
  plantillas_documento: {
    titulo: 'Plantillas de documento', grupo: 'Documentos', tabla: 'plantillas_documento', clave: 'id', orden: ['tipo_documento', 'version'],
    lista: ['tipo_documento', 'version', 'familia', 'archivo_base', 'requiere_revision', 'activo'],
    campos: [
      { columna: 'tipo_documento', etiqueta: 'Tipo de documento', tipo: 'texto', requerido: true },
      { columna: 'version', etiqueta: 'Versión', tipo: 'numero', requerido: true, porDefecto: 1 },
      { columna: 'familia', etiqueta: 'Familia', tipo: 'opcion', opciones: FAMILIAS, requerido: true },
      { columna: 'requiere_revision', etiqueta: 'Requiere revisión humana antes de firmar', tipo: 'bool' },
      { columna: 'archivo_base', etiqueta: 'Archivo Word (.docx) en la carpeta de contratos', tipo: 'archivo' },
      { columna: 'contenido_plantilla', etiqueta: 'Contenido con {variables}', tipo: 'textarea' },
      { columna: 'campos', etiqueta: 'Variables: [{"clave","etiqueta","tipo"}]', tipo: 'json' },
      { columna: 'activo', etiqueta: 'Activa', tipo: 'bool', porDefecto: true }
    ]
  },
  clausulas_documento: {
    titulo: 'Cláusulas', grupo: 'Documentos', tabla: 'clausulas_documento', clave: 'id', orden: ['familia', 'codigo'],
    lista: ['familia', 'codigo', 'titulo', 'activo'],
    campos: [
      { columna: 'familia', etiqueta: 'Familia', tipo: 'opcion', opciones: FAMILIAS, requerido: true },
      { columna: 'codigo', etiqueta: 'Código', tipo: 'texto', requerido: true },
      { columna: 'titulo', etiqueta: 'Título', tipo: 'texto', requerido: true },
      { columna: 'texto_plantilla', etiqueta: 'Texto con {variables}', tipo: 'textarea', requerido: true },
      { columna: 'campos', etiqueta: 'Variables (JSON)', tipo: 'json' },
      { columna: 'activo', etiqueta: 'Activa', tipo: 'bool', porDefecto: true }
    ]
  },
  empresas_emisoras: {
    titulo: 'Empresas emisoras', grupo: 'Empresa', tabla: 'empresas_emisoras', clave: 'id', orden: ['nombre_comercial'],
    lista: ['nombre_comercial', 'razon_social', 'rut', 'activo'],
    campos: [
      { columna: 'nombre_comercial', etiqueta: 'Marca', tipo: 'texto', requerido: true },
      { columna: 'razon_social', etiqueta: 'Razón social', tipo: 'texto', requerido: true },
      { columna: 'rut', etiqueta: 'RUT', tipo: 'rut', requerido: true },
      { columna: 'representante_legal_id', etiqueta: 'Representante legal', tipo: 'ref', ref: 'representantes_legales' },
      { columna: 'personeria_fecha', etiqueta: 'Fecha de personería', tipo: 'fecha' },
      { columna: 'personeria_fuente', etiqueta: 'Fuente de la personería', tipo: 'texto' },
      { columna: 'telefono', etiqueta: 'Teléfono', tipo: 'texto' },
      { columna: 'email', etiqueta: 'Correo', tipo: 'email' },
      { columna: 'activo', etiqueta: 'Activa', tipo: 'bool', porDefecto: true }
    ]
  },
  sucursales: {
    titulo: 'Sucursales', grupo: 'Empresa', tabla: 'sucursales', clave: 'id', orden: ['nombre'],
    lista: ['nombre', 'prefijo_folio', 'empresa_id', 'direccion_id', 'activo'],
    campos: [
      { columna: 'empresa_id', etiqueta: 'Empresa emisora', tipo: 'ref', ref: 'empresas_emisoras', requerido: true },
      { columna: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
      { columna: 'prefijo_folio', etiqueta: 'Prefijo de folio (2 letras)', tipo: 'texto', requerido: true, patron: '^[A-Z]{2}$', mayusculas: true },
      { columna: 'direccion_id', etiqueta: 'Dirección del inmueble', tipo: 'direccion', requerido: true },
      { columna: 'rol_propiedad', etiqueta: 'Rol de la propiedad (123-45)', tipo: 'texto', requerido: true, patron: '^[0-9]+-[0-9]+$' },
      { columna: 'propietario_id', etiqueta: 'Propietario que autoriza', tipo: 'ref', ref: 'propietarios_inmueble' },
      { columna: 'unidad_sii', etiqueta: 'Unidad del SII', tipo: 'texto' },
      { columna: 'activo', etiqueta: 'Activa', tipo: 'bool', porDefecto: true }
    ]
  },
  cuentas_recaudacion: {
    titulo: 'Cuentas de recaudación', grupo: 'Empresa', tabla: 'cuentas_recaudacion', clave: 'id', orden: ['banco', 'numero_cuenta'],
    lista: ['banco', 'tipo_cuenta', 'numero_cuenta', 'empresa_id', 'activa'],
    campos: [
      { columna: 'empresa_id', etiqueta: 'Empresa emisora', tipo: 'ref', ref: 'empresas_emisoras', requerido: true },
      { columna: 'banco', etiqueta: 'Banco', tipo: 'texto', requerido: true },
      { columna: 'tipo_cuenta', etiqueta: 'Tipo de cuenta', tipo: 'texto', requerido: true },
      { columna: 'numero_cuenta', etiqueta: 'Número', tipo: 'texto', requerido: true },
      { columna: 'titular', etiqueta: 'Titular', tipo: 'texto', requerido: true },
      { columna: 'rut_titular', etiqueta: 'RUT del titular', tipo: 'rut', requerido: true },
      { columna: 'activa', etiqueta: 'Activa', tipo: 'bool', porDefecto: true }
    ]
  },
  propietarios_inmueble: {
    titulo: 'Propietarios de inmuebles', grupo: 'Empresa', tabla: 'propietarios_inmueble', clave: 'id', orden: ['razon_social'],
    lista: ['razon_social', 'rut', 'direccion_id'],
    campos: [
      { columna: 'rut', etiqueta: 'RUT', tipo: 'rut', requerido: true },
      { columna: 'razon_social', etiqueta: 'Razón social', tipo: 'texto', requerido: true },
      { columna: 'representante_legal_id', etiqueta: 'Representante legal', tipo: 'ref', ref: 'representantes_legales' },
      { columna: 'direccion_id', etiqueta: 'Domicilio', tipo: 'direccion' }
    ]
  },
  representantes_legales: {
    titulo: 'Representantes legales', grupo: 'Empresa', tabla: 'representantes_legales', clave: 'id', orden: ['nombre_completo'],
    lista: ['nombre_completo', 'rut', 'profesion', 'direccion_id'],
    campos: [
      { columna: 'rut', etiqueta: 'RUT', tipo: 'rut', requerido: true },
      { columna: 'nombre_completo', etiqueta: 'Nombre completo', tipo: 'texto', requerido: true },
      { columna: 'nacionalidad', etiqueta: 'Nacionalidad', tipo: 'texto' },
      { columna: 'estado_civil', etiqueta: 'Estado civil', tipo: 'texto' },
      { columna: 'profesion', etiqueta: 'Profesión', tipo: 'texto' },
      { columna: 'direccion_id', etiqueta: 'Domicilio', tipo: 'direccion' }
    ]
  },
  regiones: {
    titulo: 'Regiones', grupo: 'Territorio', tabla: 'regiones', clave: 'id', orden: ['nombre_region'],
    lista: ['nombre_region'],
    campos: [{ columna: 'nombre_region', etiqueta: 'Región', tipo: 'texto', requerido: true }]
  },
  comunas: {
    titulo: 'Comunas', grupo: 'Territorio', tabla: 'comunas', clave: 'id', orden: ['nombre_comuna'],
    lista: ['nombre_comuna', 'region_id'],
    campos: [
      { columna: 'nombre_comuna', etiqueta: 'Comuna', tipo: 'texto', requerido: true },
      { columna: 'region_id', etiqueta: 'Región', tipo: 'ref', ref: 'regiones', requerido: true }
    ]
  },
  permisos: {
    titulo: 'Permisos', grupo: 'Acceso', tabla: 'permisos', clave: 'id', orden: ['permiso'],
    lista: ['permiso'],
    campos: [{ columna: 'permiso', etiqueta: 'Permiso (ej. aprobar_documentos)', tipo: 'texto', requerido: true, patron: '^[a-z_]+$' }]
  },
  config_alertas: {
    titulo: 'Plazos de alertas', grupo: 'Operación', tabla: 'config_alertas', clave: 'dias_anticipacion', claveEditable: true,
    orden: ['dias_anticipacion'], lista: ['dias_anticipacion', 'activo'],
    nota: 'Los cambios aplican a los contratos que se creen o cuyo vencimiento cambie desde ahora.',
    campos: [
      { columna: 'dias_anticipacion', etiqueta: 'Días de anticipación', tipo: 'numero', requerido: true, min: 1 },
      { columna: 'activo', etiqueta: 'Activo', tipo: 'bool', porDefecto: true }
    ]
  },
  folios_correlativos: {
    titulo: 'Correlativos de folio', grupo: 'Operación', tabla: 'folios_correlativos', clave: 'anio', claveEditable: true,
    orden: ['anio'], lista: ['anio', 'ultimo'],
    nota: 'Último número de folio usado por año. Ajústelo solo al migrar contratos desde el Excel.',
    campos: [
      { columna: 'anio', etiqueta: 'Año', tipo: 'numero', requerido: true, min: 2000 },
      { columna: 'ultimo', etiqueta: 'Último correlativo usado', tipo: 'numero', requerido: true, min: 0 }
    ]
  }
};

// Etiqueta que se muestra al referenciar un registro de cada catálogo
const ETIQUETAS = {
  servicios: 'nombre', plantillas_documento: 'tipo_documento', clausulas_documento: 'titulo',
  empresas_emisoras: 'nombre_comercial', sucursales: 'nombre', cuentas_recaudacion: 'numero_cuenta',
  propietarios_inmueble: 'razon_social', representantes_legales: 'nombre_completo',
  regiones: 'nombre_region', comunas: 'nombre_comuna', permisos: 'permiso'
};

module.exports = { DEFINICIONES: D, ETIQUETAS, FAMILIAS };
