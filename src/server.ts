import 'dotenv/config';
import { createApp } from './app';
import { pool } from './db/pool';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

const server = app.listen(port, () => {
  console.info(`Servidor escuchando en http://localhost:${port}`);
});

async function cerrar() {
  server.close();
  await pool.end();
}

process.on('SIGINT', () => void cerrar());
process.on('SIGTERM', () => void cerrar());
