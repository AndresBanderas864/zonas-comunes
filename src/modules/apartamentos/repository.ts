import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from '../../db/pool';

export type ApartamentoFila = {
  id: string;
  torre_interior: string;
  numero: string;
  // Cadena ISO UTC ('...Z'): creada_en se almacena en UTC_TIMESTAMP(3) y se
  // formatea en SQL para que la lectura no dependa de la TZ del proceso Node
  // (convencion identica a la de notificaciones y reservas).
  creado_en: string;
};

// Lectura de creado_en con la convencion UTC explicita ('Z'), no como Date
// interpretado en hora local del proceso.
const COLUMNAS_APARTAMENTO = `id, torre_interior, numero,
  CONCAT(DATE_FORMAT(creado_en, '%Y-%m-%dT%H:%i:%s.%f'), 'Z') AS creado_en`;

export async function listarApartamentosFilas(): Promise<ApartamentoFila[]> {
  return query<ApartamentoFila>(
    `SELECT ${COLUMNAS_APARTAMENTO}
     FROM APARTAMENTO ORDER BY torre_interior, numero`,
  );
}

export async function obtenerApartamentoFila(
  conn: PoolConnection,
  id: string,
): Promise<ApartamentoFila | null> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT ${COLUMNAS_APARTAMENTO}
     FROM APARTAMENTO WHERE id = ? FOR UPDATE`,
    [id],
  );
  return (filas[0] as ApartamentoFila | undefined) ?? null;
}

export async function insertarApartamento(
  conn: PoolConnection,
  datos: { id: string; torreInterior: string; numero: string },
): Promise<void> {
  // creado_en en UTC explicito (UTC_TIMESTAMP(3)) en lugar de depender del
  // DEFAULT CURRENT_TIMESTAMP: el servidor tiene TZ=America/Bogota.
  await conn.query<ResultSetHeader>(
    `INSERT INTO APARTAMENTO (id, torre_interior, numero, creado_en)
     VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
    [datos.id, datos.torreInterior, datos.numero],
  );
}

export async function actualizarApartamentoFila(
  conn: PoolConnection,
  datos: { id: string; torreInterior: string; numero: string },
): Promise<void> {
  await conn.query<ResultSetHeader>(
    `UPDATE APARTAMENTO SET torre_interior = ?, numero = ? WHERE id = ?`,
    [datos.torreInterior, datos.numero, datos.id],
  );
}

export async function eliminarApartamentoFila(
  conn: PoolConnection,
  id: string,
): Promise<void> {
  await conn.query<ResultSetHeader>('DELETE FROM APARTAMENTO WHERE id = ?', [
    id,
  ]);
}

export async function contarDependientes(
  conn: PoolConnection,
  apartamentoId: string,
): Promise<number> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM USUARIO WHERE apartamento_id = ?) +
       (SELECT COUNT(*) FROM RESERVA WHERE apartamento_id = ?) +
       (SELECT COUNT(*) FROM INVITACION WHERE apartamento_id = ?) AS n`,
    [apartamentoId, apartamentoId, apartamentoId],
  );
  return Number(filas[0]?.n ?? 0);
}
