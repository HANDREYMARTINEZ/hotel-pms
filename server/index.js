import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedIfEmpty } from './seed.js';
import { HttpError } from './lib/core.js';
import { router as adminRouter, publicRouter as adminPublic, PUBLIC_DIR } from './routes/admin.js';
import { router as roomsRouter } from './routes/rooms.js';
import { router as guestsRouter } from './routes/guests.js';
import { router as reservationsRouter } from './routes/reservations.js';
import { router as inventoryRouter } from './routes/inventory.js';
import { router as opsRouter, publicRouter as opsPublic } from './routes/ops.js';
import { router as reportsRouter } from './routes/reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
seedIfEmpty({ demo: process.env.SEED_DEMO !== '0' });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

app.use('/uploads', express.static(PUBLIC_DIR, { maxAge: '7d' }));

// Rutas públicas (login, encuesta). Aquí se montará el futuro módulo de reservas en línea.
app.use('/api', adminPublic, opsPublic);
// Rutas protegidas: adminRouter aplica la autenticación al resto.
app.use('/api', adminRouter, roomsRouter, guestsRouter, reservationsRouter, inventoryRouter, opsRouter, reportsRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

const dist = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|uploads).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.name === 'MulterError' || err?.message === 'Tipo de archivo no permitido') return res.status(400).json({ error: err.message });
  if (String(err?.message).includes('UNIQUE constraint')) return res.status(409).json({ error: 'Ya existe un registro con esos datos' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Hotel PMS escuchando en http://localhost:${PORT}`));
