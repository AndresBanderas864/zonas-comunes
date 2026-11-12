import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { query } from '../../db/pool';

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

export type Auditoria = {
  id: string;
  usuario: string;
  accion: string;
  entidad: string;
  entidadId: string;
  detalle: unknown;
  creadaEn: string;
};

export type FiltrosAuditoria = {
  desde?: string;
  hasta?: string;
};

type FilaAuditoria = {
  id: string;
  usuario: string;
  accion: string;
  entidad: string;
  entidad_id: string;
  detalle: unknown;
  creada_en: string;
};

// Lectura de la bitacora para el administrador (RF-41). Sin paginacion por
// decision del brief (YAGNI): se devuelven las 200 entradas mas recientes en
// orden descendente. El nombre del usuario se obtiene uniendo USUARIO por la
// FK usuario_id. creada_en sale como ISO UTC (convencion de consultas de
// reservas); mysql2 parsea la columna JSON a valores JS (u null), y se deja
// asi: la vista la re-textualiza y la escapa al renderizar.
export async function listarAuditoria(
  filtros: FiltrosAuditoria,
): Promise<Auditoria[]> {
  const predicados: string[] = [];
  const params: unknown[] = [];

  if (filtros.desde) {
    predicados.push('b.creada_en >= ?');
    params.push(`${filtros.desde} 00:00:00.000`);
  }
  if (filtros.hasta) {
    // Borde inclusivo de dia completo: hasta la medianoche del dia siguiente
    // (exclusiva), para no descartar las horas de la propia fecha.
    predicados.push('b.creada_en < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(`${filtros.hasta} 00:00:00.000`);
  }

  const where = predicados.length > 0 ? `WHERE ${predicados.join(' AND ')}` : '';

  const filas = await query<FilaAuditoria>(
    `SELECT b.id, u.nombre AS usuario, b.accion, b.entidad, b.entidad_id,
            b.detalle,
            CONCAT(DATE_FORMAT(b.creada_en, '%Y-%m-%dT%H:%i:%s.%f'), 'Z') AS creada_en
     FROM BITACORA b
     JOIN USUARIO u ON u.id = b.usuario_id
     ${where}
     ORDER BY b.creada_en DESC, b.id DESC
     LIMIT 200`,
    params,
  );

  return filas.map((fila) => ({
    id: fila.id,
    usuario: fila.usuario,
    accion: fila.accion,
    entidad: fila.entidad,
    entidadId: fila.entidad_id,
    detalle: fila.detalle,
    creadaEn: fila.creada_en,
  }));
}
