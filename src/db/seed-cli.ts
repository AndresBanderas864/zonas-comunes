import 'dotenv/config';
import { pool } from './pool';
import { runSeed } from './seed';

try {
  await runSeed(pool);
  console.info('Seed de demostracion aplicado');
} finally {
  await pool.end();
}
