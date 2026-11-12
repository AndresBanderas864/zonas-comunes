import mysql from 'mysql2/promise';

const databaseUrl =
  process.env.DATABASE_URL ?? 'mysql://ecc:ecc@localhost:3306/ecc';

export const pool = mysql.createPool(databaseUrl);
