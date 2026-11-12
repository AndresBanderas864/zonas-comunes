import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from '../../db/pool';

export type InvitacionFila = {
  id: string;
  apartamento_id: string;
  apartamento_torre: string;
  apartamento_numero: string;
  estado: string;
  vence_en: Date;
};

export async function listarInvitacionesFilas(): Promise<InvitacionFila[]> {
  return query<InvitacionFila>(
    `SELECT i.id, i.apartamento_id, a.torre_interior AS apartamento_torre,
            a.numero AS apartamento_numero, i.estado, i.vence_en
     FROM INVITACION i
     JOIN APARTAMENTO a ON a.id = i.apartamento_id
     ORDER BY i.creada_en DESC`,
  );
}

export async function apartamentoExiste(
  conn: PoolConnection,
  id: string,
): Promise<boolean> {
  const [filas] = await conn.query<RowDataPacket[]>(
    'SELECT id FROM APARTAMENTO WHERE id = ?',
    [id],
  );
  return filas.length > 0;
}

export async function insertarInvitacion(
  conn: PoolConnection,
  datos: {
    id: string;
    apartamentoId: string;
    creadaPor: string;
    tokenHash: string;
    venceEn: Date;
  },
): Promise<void> {
  await conn.query<ResultSetHeader>(
    `INSERT INTO INVITACION (id, apartamento_id, creada_por, token_hash, estado, vence_en)
     VALUES (?, ?, ?, ?, 'VIGENTE', ?)`,
    [
      datos.id,
      datos.apartamentoId,
      datos.creadaPor,
      datos.tokenHash,
      datos.venceEn,
    ],
  );
}

export type InvitacionEstadoFila = {
  id: string;
  estado: string;
};

export async function obtenerInvitacionFila(
  conn: PoolConnection,
  id: string,
): Promise<InvitacionEstadoFila | null> {
  const [filas] = await conn.query<RowDataPacket[]>(
    'SELECT id, estado FROM INVITACION WHERE id = ? FOR UPDATE',
    [id],
  );
  return (filas[0] as InvitacionEstadoFila | undefined) ?? null;
}

export async function marcarInvitacionRevocada(
  conn: PoolConnection,
  id: string,
): Promise<void> {
  await conn.query(
    `UPDATE INVITACION SET estado = 'REVOCADA' WHERE id = ?`,
    [id],
  );
}
