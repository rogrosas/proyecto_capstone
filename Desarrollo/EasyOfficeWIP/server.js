// Servidor de Easy Office: sirve las páginas HTML de /public y una API JSON.
const path = require('path');
const express = require('express');
const CATALOGO = require('./public/js/catalogo');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// URLs limpias: /contabilidad sirve public/contabilidad.html
app.use(express.static(PUBLIC, { extensions: ['html'] }));

// Compatibilidad con la URL del sitio WordPress anterior
app.get('/asesoriaempresas', (req, res) => res.redirect(301, '/asesoria-empresas'));

// API: catálogo de planes (aquí se conectará la base de datos)
app.get('/api/catalogo', (req, res) => res.json(CATALOGO));
app.get('/api/catalogo/:id', (req, res) => {
  for (const f of CATALOGO) {
    const p = f.plans.find((x) => x.id === req.params.id);
    if (p) return res.json({ ...p, fam: f.tab, famId: f.id });
  }
  res.status(404).json({ error: 'Plan no encontrado' });
});

app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

app.listen(PORT, () => console.log(`Easy Office corriendo en http://localhost:${PORT}`));
