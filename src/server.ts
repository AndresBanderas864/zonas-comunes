import 'dotenv/config';
import { createApp } from './app';
import { pool } from './db/pool';
import { registrarJobs } from './jobs';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

// Los jobs quedan fuera del camino de prueba: registrarJobs es no-op con
// NODE_ENV=test, y los tests de jobs importan las funciones directamente.
registrarJobs();

const server = app.listen(port, () => {
  console.info(`Servidor escuchando en http://localhost:${port}`);
});

async function cerrar() {
  server.close();
  await pool.end();
}

process.on('SIGINT', () => void cerrar());
process.on('SIGTERM', () => void cerrar());
