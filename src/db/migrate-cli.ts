import 'dotenv/config';
import { runMigrations } from './migrate';
import { pool } from './pool';

const conn = await pool.getConnection();
try {
  const aplicadas = await runMigrations(conn);
  console.info(`Migraciones aplicadas: ${aplicadas}`);
} finally {
  conn.release();
  await pool.end();
}
