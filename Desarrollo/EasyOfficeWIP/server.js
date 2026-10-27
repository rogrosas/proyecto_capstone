// Punto de entrada: levanta la aplicación armada en src/app.js
const config = require('./src/config');
const app = require('./src/app');

app.listen(config.puerto, () => {
  console.log(`Easy Office corriendo en http://localhost:${config.puerto}`);
  if (!process.env.PGPASSWORD) console.warn('Aviso: falta PGPASSWORD en .env; el CRM no podrá conectarse a PostgreSQL.');
});
