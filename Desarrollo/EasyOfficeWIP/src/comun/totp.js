/* =========================================================
   Transversal · Segundo factor TOTP (RFC 6238, como Google Authenticator,
   Microsoft Authenticator o Authy): códigos de 6 dígitos cada 30 segundos.
   El secreto se guarda cifrado con AES-256-GCM (clave TOTP_CLAVE del .env).
   ========================================================= */
const crypto = require('crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function aBase32(buf) {
  let bits = 0, valor = 0, salida = '';
  for (const b of buf) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) { salida += BASE32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) salida += BASE32[(valor << (5 - bits)) & 31];
  return salida;
}

function deBase32(texto) {
  let bits = 0, valor = 0;
  const salida = [];
  for (const c of String(texto).toUpperCase().replace(/[\s=-]/g, '')) {
    const i = BASE32.indexOf(c);
    if (i < 0) throw new Error('Secreto TOTP inválido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) { salida.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(salida);
}

const nuevoSecreto = () => aBase32(crypto.randomBytes(20));

// Código de un paso de 30 s (HOTP con HMAC-SHA1 y truncado dinámico)
function codigo(secreto, momento = Date.now()) {
  const paso = Buffer.alloc(8);
  paso.writeBigUInt64BE(BigInt(Math.floor(momento / 1000 / 30)));
  const h = crypto.createHmac('sha1', deBase32(secreto)).update(paso).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

// Acepta el código del paso actual y de uno antes o después (desfase de reloj del teléfono)
function verificar(secreto, dado, momento = Date.now()) {
  const c = String(dado || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(codigo(secreto, momento + d * 30000)), Buffer.from(c)));
}

const uri = (cuenta, secreto, emisor = 'Easy Office CRM') =>
  `otpauth://totp/${encodeURIComponent(`${emisor}:${cuenta}`)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=30`;

/* ---------- Cifrado del secreto en la base ---------- */
function clave(hex) {
  if (!/^[0-9a-f]{64}$/i.test(String(hex || ''))) return null;
  return Buffer.from(hex, 'hex');
}

function cifrar(texto, claveHex) {
  const k = clave(claveHex);
  if (!k) throw new Error('Falta TOTP_CLAVE');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join(':');
}

function descifrar(guardado, claveHex) {
  const k = clave(claveHex);
  const [v, iv, tag, datos] = String(guardado || '').split(':');
  if (!k || v !== 'v1') throw new Error('No se puede leer el secreto TOTP');
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
}

module.exports = { nuevoSecreto, codigo, verificar, uri, cifrar, descifrar, aBase32, deBase32, claveValida: (h) => !!clave(h) };
