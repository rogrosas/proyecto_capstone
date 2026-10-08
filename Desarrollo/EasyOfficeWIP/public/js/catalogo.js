/* =========================================================
   Catálogo único de servicios y planes (precios de easyoffice.cl).
   Lo usan el navegador (window.CATALOGO) y el servidor Node (/api/catalogo).

   price    -> número en CLP, o null si requiere cotización
   priceTxt -> texto cuando price es null (ej. "UF 14")
   recur    -> anual | semestral | mensual | bolsa | unico | cotiza
   feats    -> resumen corto (tarjetas de /contratar)
   detalle  -> lista completa de la página del servicio (opcional)
   grupo    -> agrupación en la página de firmas (bolsas | planes | digitales)
   ========================================================= */
(function (root) {
  const CATALOGO = [
    {
      id: 'domicilio',
      tab: 'Domicilio tributario',
      note: 'Cobertura verificada en las regiones Metropolitana y de Valparaíso. Incluye recepción, digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo).',
      plans: [
        {
          id: 'dom-anual', name: 'Plan Anual', price: 59990, per: '12 meses · pago único', recur: 'anual',
          feats: ['Domicilio tributario, postal y comercial x 12 meses', 'Recepción de correspondencia', 'Digitalización y envío de correspondencia fiscal', 'Inicio de actividad ante S.I.I.', 'Firmas electrónicas avanzadas del contrato'],
          detalle: ['Domicilio tributario, postal y comercial x 12 meses', 'Recepción de correspondencia y oficina de partes', 'Digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)', 'Inicio de actividad ante el S.I.I.', 'Firmas electrónicas avanzadas del contrato']
        },
        {
          id: 'dom-sem', name: 'Plan Semestral', price: 39990, per: '6 meses · pago único', recur: 'semestral',
          feats: ['Domicilio tributario, postal y comercial x 6 meses', 'Recepción de correspondencia', 'Digitalización y envío de correspondencia fiscal', 'Inicio de actividad ante S.I.I.', 'Firmas avanzadas por $5.000 adicionales'],
          detalle: ['Domicilio tributario, postal y comercial x 6 meses', 'Recepción de correspondencia y oficina de partes', 'Digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)', 'Inicio de actividad ante el S.I.I.', 'Firma avanzada del contrato $5.000']
        },
        {
          id: 'dom-bod', name: 'Plan Anual de Bodega Virtual', price: 59990, per: '12 meses · pago único', recur: 'anual',
          feats: ['Domicilio bodega x 12 meses', 'Inmueble con rol de bodega', 'Válido ante S.I.I.', 'Firmas electrónicas avanzadas del contrato']
        }
      ]
    },
    {
      id: 'contabilidad',
      tab: 'Contabilidad & Tributaria',
      note: 'Planes mensuales válidos para regímenes Pro Pyme y Transparente. Otros regímenes requieren cotización personalizada con un ejecutivo.',
      plans: [
        {
          id: 'cont-bas', name: 'Plan Básico', price: 22990, per: 'mensual', recur: 'mensual',
          feats: ['Declaración mensual de IVA', 'Libros electrónicos de ventas y compras', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Hasta 5 facturas mensuales'],
          detalle: ['Declaración mensual de IVA', 'Libro Electrónico de Ventas, confeccionado y enviado mensualmente', 'Libro Electrónico de Compras, confeccionado y enviado mensualmente', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Válido sólo para regímenes Pro Pyme y Transparente', 'Hasta 5 facturas x mes']
        },
        {
          id: 'cont-est', name: 'Plan Estándar', price: 37900, per: 'mensual', recur: 'mensual',
          feats: ['Declaración mensual de IVA', 'Libros electrónicos de ventas y compras', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Hasta 10 facturas mensuales'],
          detalle: ['Declaración mensual de IVA', 'Libro Electrónico de Ventas, confeccionado y enviado mensualmente', 'Libro Electrónico de Compras, confeccionado y enviado mensualmente', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Válido sólo para regímenes Pro Pyme y Transparente', 'Hasta 10 facturas x mes']
        },
        {
          id: 'cont-pyme', name: 'Plan Pyme', price: 59000, per: 'mensual', recur: 'mensual',
          feats: ['Declaración mensual de IVA', 'Libros electrónicos de ventas y compras', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Hasta 15 facturas mensuales'],
          detalle: ['Declaración mensual de IVA', 'Libro Electrónico de Ventas, confeccionado y enviado mensualmente', 'Libro Electrónico de Compras, confeccionado y enviado mensualmente', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Válido sólo para regímenes Pro Pyme y Transparente', 'Hasta 15 facturas x mes']
        },
        {
          id: 'cont-rrhh', name: 'Servicio de RR.HH.', price: 14900, per: 'mensual · por persona', recur: 'mensual',
          feats: ['Liquidaciones de sueldo', 'Contratos de trabajo, anexos y finiquitos', 'Licencias médicas y nómina PreviRed', 'Libro de remuneraciones electrónico a la DT'],
          detalle: ['Cálculo y confección de liquidaciones de sueldo', 'Confección de contratos de trabajo y anexos', 'Cálculo y confección de finiquitos del personal', 'Procesar y tramitar licencias médicas', 'Carga de nómina de imposiciones PreviRed', 'Control de vacaciones', 'Emisión y envío del libro de remuneraciones electrónico a la DT']
        },
        {
          id: 'cont-inicio', name: 'Inicio de actividad', price: 14900, per: 'plan único', recur: 'unico',
          feats: ['Obtención de clave secreta', 'Inicio y verificación de actividad', 'Inscripción en factura electrónica SII', 'Logo en la factura electrónica'],
          detalle: ['Obtención de clave secreta', 'Inicio de actividades', 'Verificación de actividad', 'Inscripción en factura electrónica SII', 'Centralización del certificado digital', 'Incorporación del logo a la factura electrónica']
        }
      ]
    },
    {
      id: 'firmas',
      tab: 'Firmas Electrónicas',
      note: 'Las bolsas tienen vigencia de 3 meses; los planes, de 1 año. El saldo disponible queda visible en el panel del cliente y se descuenta por cada documento firmado.',
      plans: [
        { id: 'fir-1', grupo: 'bolsas', corto: '1 firma electrónica avanzada', name: 'Bolsa · 1 firma avanzada', price: 3490, per: 'vigencia 3 meses', recur: 'bolsa', feats: ['1 firma electrónica avanzada', 'Validez legal Ley 19.799', 'Firma desde cualquier dispositivo', 'Sin ir a notaría'] },
        { id: 'fir-3', grupo: 'bolsas', corto: '3 firmas electrónicas avanzadas', name: 'Bolsa · 3 firmas avanzadas', price: 8990, per: 'vigencia 3 meses', recur: 'bolsa', feats: ['3 firmas electrónicas avanzadas', 'Validez legal Ley 19.799', 'Firma desde cualquier dispositivo', 'Saldo visible en su panel'] },
        { id: 'fir-10', grupo: 'bolsas', corto: '10 firmas electrónicas avanzadas', name: 'Bolsa · 10 firmas avanzadas', price: 24990, per: 'vigencia 3 meses', recur: 'bolsa', feats: ['10 firmas electrónicas avanzadas', 'Validez legal Ley 19.799', 'Firma desde cualquier dispositivo', 'Saldo visible en su panel'] },
        { id: 'fir-5a', grupo: 'planes', corto: '5 firmas electrónicas avanzadas', name: 'Plan · 5 firmas avanzadas', price: 9990, per: 'vigencia 1 año', recur: 'anual', feats: ['5 firmas electrónicas avanzadas', 'Vigencia 12 meses', 'Recordatorio antes de vencer', 'Saldo visible en su panel'] },
        { id: 'fir-25', grupo: 'planes', corto: '25 firmas electrónicas avanzadas', name: 'Plan · 25 firmas avanzadas', price: 34990, per: 'vigencia 1 año', recur: 'anual', feats: ['25 firmas electrónicas avanzadas', 'Vigencia 12 meses', 'Recordatorio antes de vencer', 'Ideal para contratos recurrentes'] },
        { id: 'fir-50', grupo: 'planes', corto: '50 firmas electrónicas avanzadas', name: 'Plan · 50 firmas avanzadas', price: 49990, per: 'vigencia 1 año', recur: 'anual', feats: ['50 firmas electrónicas avanzadas', 'Vigencia 12 meses', 'Recordatorio antes de vencer', 'Mejor precio por firma'] }
      ]
    },
    {
      id: 'digitales',
      tab: 'Servicios digitales',
      note: 'Servicios de apoyo a la gestión documental. El acceso a la API permite a estudios contables y plataformas integrar la firma en sus propios sistemas.',
      plans: [
        { id: 'dig-not', grupo: 'digitales', corto: '1 certificación o protocolización notarial', name: 'Certificación o protocolización notarial', price: 13490, per: 'por documento', recur: 'unico', feats: ['1 certificación o protocolización', 'Red de notarios digitales', 'Documento con validez legal', 'Entrega digital'] },
        { id: 'dig-api', grupo: 'digitales', corto: 'Acceso a la API, x mes desde', name: 'Acceso a la API', price: 8990, per: 'mensual · desde', recur: 'mensual', feats: ['Integración de firma en su sistema', 'Documentación técnica', 'Ambiente de pruebas', 'Soporte de implementación'] },
        { id: 'dig-simple', grupo: 'digitales', corto: '100 firmas electrónicas simples', name: 'Bolsa · 100 firmas simples', price: 24990, per: 'por bolsa', recur: 'bolsa', feats: ['100 firmas electrónicas simples', 'Para documentos de uso interno', 'Descuento por volumen', 'Saldo visible en su panel'] }
      ]
    },
    {
      id: 'empresa',
      tab: 'Empresa en 1 Día · Rebaja Tributaria',
      note: 'Los planes de Empresa en 1 Día se pagan en línea. La Rebaja Tributaria (valor en UF) y la asesoría dependen del capital declarado y del tipo de sociedad: el flujo termina en agendamiento con un ejecutivo, no en pago directo.',
      plans: [
        {
          id: 'emp-te1d', name: 'Plan Básico TE1D', price: 79990, per: 'pago único', recur: 'unico',
          feats: ['Empresa en 1 Día, hasta 3 socios', 'Obtención de RUT', 'Domicilio tributario por 3 meses', 'Inicio de actividad ante el S.I.I.'],
          detalle: ['Constitución de Empresa en 1 Día, hasta 3 socios', 'Obtención de RUT', 'Domicilio tributario por 3 meses', 'Inicio de actividad ante el S.I.I.', 'Verificación de actividad', 'Solicitud de factura electrónica', 'Solicitud de cuenta Emprendedor BancoEstado']
        },
        {
          id: 'emp-activa', name: 'Plan EmpresActiva', price: 144990, per: 'pago único', recur: 'unico',
          feats: ['Creación de estatutos TE1D', 'Domicilio tributario x 1 año', 'Trámites SII hasta emitir factura', 'Certificado digital, dominio .cl y correo'],
          detalle: ['Creación de estatutos TE1D', 'Domicilio tributario x 1 año', 'Todo trámite en SII hasta emitir factura (*)', 'Certificado digital x 1 año', 'Cuenta bancaria empresa', 'Dominio .cl', 'Webmail: 1 correo corporativo x 1 año', '(*) No incluye situaciones pendientes del representante legal o socios']
        },
        {
          id: 'emp-lista', name: 'Plan Empresa Lista', price: 199990, per: 'pago único', recur: 'unico',
          feats: ['TE1D + RUT + inicio de actividades', 'Folios autorizados para facturar hoy', 'Domicilio tributario x 1 año', 'Incluye gasto notarial'],
          detalle: ['TE1D + RUT + inicio de actividades', 'Folios autorizados para facturar hoy', 'Domicilio tributario x un año', 'Compraventa x el 100% de las acciones', 'Proceso 100% online', 'Incluye gasto notarial']
        },
        {
          id: 'reb-anual', name: 'Rebaja Tributaria · Anual', price: null, priceTxt: 'UF 14', per: '12 meses · según capital propio', recur: 'cotiza',
          feats: ['Reduce 50% la patente comercial', 'Beneficio Municipalidad de La Florida', 'Domicilio tributario x 12 meses', 'Firmas avanzadas del contrato'],
          detalle: ['Domicilio tributario, postal y comercial x 12 meses', 'Recepción de correspondencia y oficina de partes', 'Digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)', 'Firmas electrónicas avanzadas del contrato']
        },
        {
          id: 'reb-sem', name: 'Rebaja Tributaria · Semestral', price: null, priceTxt: 'UF 7,5', per: '6 meses · según capital propio', recur: 'cotiza',
          feats: ['Reduce 50% la patente comercial', 'Beneficio Municipalidad de La Florida', 'Domicilio tributario x 6 meses', 'Firmas avanzadas del contrato'],
          detalle: ['Domicilio tributario, postal y comercial por 6 meses', 'Recepción de correspondencia y oficina de partes', 'Digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)', 'Firmas electrónicas avanzadas del contrato']
        },
        {
          id: 'emp-ases', name: 'Asesoría Empresas', price: null, per: 'reunión de 30 minutos', recur: 'cotiza',
          feats: ['Diagnóstico de su situación tributaria', 'Recomendación de plan', 'Sin costo ni compromiso', 'Presencial o por videollamada']
        }
      ]
    }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = CATALOGO; // Node
  else root.CATALOGO = CATALOGO;                                                  // navegador
})(this);
