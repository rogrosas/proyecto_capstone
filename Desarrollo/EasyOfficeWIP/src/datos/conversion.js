/* =========================================================
   CAPA DE DATOS · Conversión de tipos de PostgreSQL a JavaScript.
   pg devuelve numeric y count(*) como texto: se pasan a Number aquí,
   para que las capas superiores reciban datos ya tipados.
   ========================================================= */
const num = (v) => (v === null || v === undefined ? null : Number(v));

// Convierte a número las columnas indicadas de una fila
const numeros = (fila, columnas) => {
  const r = { ...fila };
  columnas.forEach((c) => { r[c] = num(r[c]); });
  return r;
};

module.exports = { num, numeros };
