import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';

export type EntradaAuditoria = {
  usuarioId: string;
  accion: string;
  entidad: string;
  entidadId: string;
  detalle?: unknown;
};

export async function registrarAuditoria(
  conn: PoolConnection,
  entrada: EntradaAuditoria,
): Promise<void> {
  const detalle =
    entrada.detalle === undefined || entrada.detalle === null
      ? null
      : JSON.stringify(entrada.detalle);

  await conn.query(
    `INSERT INTO BITACORA (id, usuario_id, accion, entidad, entidad_id, detalle, creada_en)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      randomUUID(),
      entrada.usuarioId,
      entrada.accion,
      entrada.entidad,
      entrada.entidadId,
      detalle,
    ],
  );
}
