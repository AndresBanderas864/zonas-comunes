import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

const migracionesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

export async function runMigrations(conn: PoolConnection): Promise<number> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS MIGRACIONES (
      nombre VARCHAR(255) NOT NULL,
      aplicada_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [aplicadas] = await conn.query<RowDataPacket[]>(
    'SELECT nombre FROM MIGRACIONES',
  );
  const yaAplicadas = new Set(aplicadas.map((fila) => String(fila.nombre)));

  const archivos = (await readdir(migracionesDir))
    .filter((archivo) => archivo.endsWith('.sql'))
    .sort();

  let aplicadasAhora = 0;

  for (const archivo of archivos) {
    if (yaAplicadas.has(archivo)) continue;

    const contenido = await readFile(path.join(migracionesDir, archivo), 'utf8');
    const sentencias = contenido
      .split(/;\s*(?:\r?\n|$)/)
      .map((sentencia) => sentencia.trim())
      .filter(Boolean);

    try {
      for (const sentencia of sentencias) {
        await conn.query(sentencia);
      }
      await conn.query('INSERT INTO MIGRACIONES (nombre) VALUES (?)', [archivo]);
      aplicadasAhora++;
    } catch (error) {
      throw new Error(`Fallo aplicando ${archivo}: ${(error as Error).message}`);
    }
  }

  return aplicadasAhora;
}
