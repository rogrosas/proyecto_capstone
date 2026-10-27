/* =========================================================
   CAPA DE DATOS · Almacén de sesiones.
   Por ahora en memoria (se pierden al reiniciar el servidor). Como solo
   se accede por estas funciones, se puede cambiar por una tabla o Redis
   sin tocar las capas de negocio ni de presentación.

   Dos espacios separados: personal del CRM y clientes del portal,
   para que un token de un tipo nunca sirva en el otro.
   ========================================================= */
const personal = new Map();      // token -> { usuario, expira }
const clientes = new Map();      // token -> { cliente, expira }
const enlacesUsados = new Map(); // id del enlace de acceso -> vencimiento (uso único)

function guardar(token, usuario, expira) { personal.set(token, { usuario, expira }); }
function obtener(token) { return personal.get(token) || null; }
function eliminar(token) { personal.delete(token); }

function guardarCliente(token, cliente, expira) { clientes.set(token, { cliente, expira }); }
function obtenerCliente(token) { return clientes.get(token) || null; }
function eliminarCliente(token) { clientes.delete(token); }

// Marca un enlace como usado; devuelve false si ya se había usado
function consumirEnlace(id, vence) {
  const ahora = Date.now();
  for (const [k, v] of enlacesUsados) if (v < ahora) enlacesUsados.delete(k);
  if (enlacesUsados.has(id)) return false;
  enlacesUsados.set(id, vence);
  return true;
}

module.exports = { guardar, obtener, eliminar, guardarCliente, obtenerCliente, eliminarCliente, consumirEnlace };
