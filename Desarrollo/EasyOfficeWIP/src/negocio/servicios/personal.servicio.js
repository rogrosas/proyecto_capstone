/* =========================================================
   CAPA DE NEGOCIO · Avisos al personal por correo.
   Lo que llega sin que nadie abra el CRM (una venta en la tienda, un ticket
   del cliente, una firma rechazada) se avisa al ejecutivo del cliente, o a
   los administradores si el cliente aún no tiene ejecutivo.
   Un aviso que no se puede enviar nunca interrumpe la operación que lo originó.
   ========================================================= */
const config = require('../../config');
const correo = require('../../datos/correo');
const usuariosRepo = require('../../datos/repositorios/usuarios.repositorio');
const { esc, boton, cuerpo, titulo, pie } = require('../../comun/correos');

/**
 * clienteId: a quién se refiere; a = { asunto, titulo, lineas: [texto], seccion: módulo del CRM, texto }
 */
async function avisar(clienteId, a) {
  try {
    const destinos = await usuariosRepo.equipoDeCliente(clienteId, config.rolesAdmin);
    const html = cuerpo(`${titulo(a.titulo)}${a.lineas.map((l) => `<p>${esc(l)}</p>`).join('')}
      ${boton(`${config.appUrl}/crm#${a.seccion || 'dashboard'}`, 'Abrir en el CRM')}${pie}`);
    for (const para of destinos) await correo.enviar({ para, asunto: a.asunto, texto: a.lineas.join('\n'), html });
    return destinos.length;
  } catch (err) {
    console.warn('[personal] no se pudo avisar al equipo:', err.message);
    return 0;
  }
}

module.exports = { avisar };
