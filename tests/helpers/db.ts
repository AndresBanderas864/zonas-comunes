import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../../src/db/pool';
import { runMigrations } from '../../src/db/migrate';

function datosDeConexion() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function nombreSeguro(nombre: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(nombre)) {
    throw new Error(`Nombre de base invalido: ${nombre}`);
  }
  return nombre;
}

export async function crearBaseDePrueba(nombre: string): Promise<void> {
  const base = nombreSeguro(nombre);
  const admin = await mysql.createConnection(datosDeConexion());
  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${base}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await admin.end();
  }

  const conn = await pool.getConnection();
  try {
    await runMigrations(conn);
  } finally {
    conn.release();
  }
}

export async function resetearBase(): Promise<void> {
  const tablas = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> 'MIGRACIONES'`,
  );

  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const fila of tablas[0]) {
      await conn.query(`TRUNCATE TABLE \`${String(fila.TABLE_NAME)}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
}

export async function destruirBaseDePrueba(nombre: string): Promise<void> {
  const base = nombreSeguro(nombre);
  await pool.end();
  const admin = await mysql.createConnection(datosDeConexion());
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${base}\``);
  } finally {
    await admin.end();
  }
}
