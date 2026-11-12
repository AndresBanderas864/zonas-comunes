import mysql, { type PoolConnection, type RowDataPacket } from 'mysql2/promise';

const databaseUrl =
  process.env.DATABASE_URL ?? 'mysql://ecc:ecc@localhost:3306/ecc';

export const pool = mysql.createPool(databaseUrl);

export async function query<T = RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
