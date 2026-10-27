/* =========================================================
   Ensambla la aplicación Express con sus capas:

   public/            Presentación (cliente): HTML, CSS y JS del navegador
   src/presentacion   Presentación (servidor): rutas, controladores, middleware
   src/negocio        Negocio: reglas y casos de uso
   src/datos          Datos: conexión a PostgreSQL y repositorios
   src/config, comun  Transversal: configuración y errores
   ========================================================= */
const path = require('path');
const express = require('express');
const { manejarErrores } = require('./presentacion/middleware/errores');

const PUBLIC = path.join(__dirname, '..', 'public');
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '100kb' }));

// Sitio estático con URLs limpias: /contabilidad sirve public/contabilidad.html
app.use(express.static(PUBLIC, { extensions: ['html'] }));
app.get('/asesoriaempresas', (req, res) => res.redirect(301, '/asesoria-empresas')); // URL del WordPress anterior

// API
app.use('/api/catalogo', require('./presentacion/rutas/catalogo.rutas'));
app.use('/api/crm', require('./presentacion/rutas/crm.rutas'));
app.use('/api/cliente', require('./presentacion/rutas/cliente.rutas'));
app.use('/api/tienda', require('./presentacion/rutas/tienda.rutas'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Errores de la API y 404 del sitio
app.use(manejarErrores);
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

module.exports = app;
