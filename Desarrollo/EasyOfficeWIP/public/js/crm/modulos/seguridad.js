/* CRM · Seguridad de la cuenta del usuario: verificación en dos pasos (TOTP) */
import { get, post } from '../api.js';
import { esc, toast } from '../util.js';
import { abrirModal, cerrarModal } from '../modal.js';

export async function abrirSeguridad() {
  const s = await get('/yo/seguridad');
  const cuerpo = abrirModal({
    titulo: 'Seguridad de su cuenta',
    contenido: `
      <h4 class="sub-h" style="margin-top:0;">Verificación en dos pasos ${s.totp_activo ? '<span class="bg grn">Activa</span>' : '<span class="bg gry">Inactiva</span>'}</h4>
      <p class="sb" style="font-size:13px;line-height:1.6;">Además de la contraseña, al ingresar se pide el código de 6 dígitos de una aplicación
        autenticadora en su teléfono (Google Authenticator, Microsoft Authenticator o Authy). Así, aunque alguien conozca su contraseña, no puede entrar.</p>
      <div id="secTotp">${!s.totp_disponible
        ? '<div class="note warn">El servidor aún no tiene configurada la clave TOTP_CLAVE: pida al administrador que la agregue al .env.</div>'
        : s.totp_activo
          ? `<div class="gf"><label for="secCodigo">Para desactivarla, escriba el código actual</label><input id="secCodigo" class="codigo-2fa" inputmode="numeric" maxlength="7"></div>
             <button class="btn btn-peligro" data-desactivar>Desactivar verificación en dos pasos</button>`
          : '<button class="btn btn-g" data-iniciar>Activar verificación en dos pasos</button>'}</div>
      <h4 class="sub-h">Contraseña</h4>
      <p class="sb" style="font-size:13px;">Para cambiarla, salga y use "¿Olvidó su contraseña?" en la pantalla de ingreso: le llegará un enlace a su correo.</p>`,
    acciones: [{ texto: 'Cerrar' }]
  });

  cuerpo.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-iniciar],[data-activar],[data-desactivar]');
    if (!t) return;
    try {
      if ('iniciar' in t.dataset) {
        const r = await post('/yo/totp/iniciar');
        cuerpo.querySelector('#secTotp').innerHTML = `
          <ol class="totp-pasos">
            <li>Abra su aplicación autenticadora y elija <b>Agregar cuenta</b> → <b>Ingresar clave de configuración</b>.</li>
            <li>Escriba esta clave (tipo: basada en el tiempo):<div class="totp-secreto">${esc(r.secreto)}</div>
              <span class="sb">En el teléfono también puede abrir <a class="lnk" href="${esc(r.uri)}">este enlace</a> para agregarla directo.</span></li>
            <li>Escriba el código de 6 dígitos que aparece en la aplicación:</li>
          </ol>
          <div class="gf"><input id="secCodigo" class="codigo-2fa" inputmode="numeric" maxlength="7" placeholder="123 456"></div>
          <button class="btn btn-g" data-activar>Confirmar y activar</button>`;
        cuerpo.querySelector('#secCodigo').focus();
        return;
      }
      const codigo = cuerpo.querySelector('#secCodigo')?.value || '';
      t.disabled = true;
      if ('activar' in t.dataset) {
        await post('/yo/totp/activar', { codigo });
        toast('Verificación en dos pasos activada: la próxima vez se le pedirá el código.');
      } else {
        await post('/yo/totp/desactivar', { codigo });
        toast('Verificación en dos pasos desactivada.');
      }
      cerrarModal();
    } catch (err) {
      t.disabled = false;
      if (err.message !== 'sesion') toast(err.message, true);
    }
  });
}
