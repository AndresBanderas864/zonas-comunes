import { randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { pool, query } from '../../db/pool';
import type { TipoNotificacion } from './service';

export type InputNotificacion = {
  usuarioId: string;
  reservaId?: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
};

export async function insertarNotificacion(
  conn: PoolConnection,
  input: InputNotificacion,
): Promise<void> {
  const id = randomUUID();
  await conn.query(
    `INSERT INTO NOTIFICACION (id, usuario_id, reserva_id, tipo, titulo, mensaje, creada_en)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      id,
      input.usuarioId,
      input.reservaId ?? null,
      input.tipo,
      input.titulo,
      input.mensaje,
    ],
  );

  for (const canal of ['CORREO', 'PUSH'] as const) {
    await conn.query(
      `INSERT INTO ENVIO_NOTIFICACION (id, notificacion_id, canal, estado, intentos)
       VALUES (?, ?, ?, 'PENDIENTE', 0)`,
      [randomUUID(), id, canal],
    );
  }
}

// Orden por id para que la creacion de notificaciones sea determinista
// cuando un apartamento tiene varios residentes activos.
export async function usuariosActivosDeApartamento(
  conn: PoolConnection,
  apartamentoId: string,
): Promise<string[]> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM USUARIO
     WHERE apartamento_id = ? AND estado = 'ACTIVA'
     ORDER BY id`,
    [apartamentoId],
  );
  return filas.map((fila) => String(fila.id));
}

export type NotificacionBandeja = {
  id: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  leida: boolean;
  creadaEn: string;
};

type FilaBandeja = {
  id: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  leida: number;
  creada_en: string;
};

export async function listarBandeja(
  usuarioId: string,
): Promise<NotificacionBandeja[]> {
  const filas = await query<FilaBandeja>(
    `SELECT id, tipo, titulo, mensaje, leida,
            CONCAT(DATE_FORMAT(creada_en, '%Y-%m-%dT%H:%i:%s.%f'), 'Z') creada_en
     FROM NOTIFICACION
     WHERE usuario_id = ?
     ORDER BY leida, creada_en DESC, id`,
    [usuarioId],
  );
  return filas.map((fila) => ({
    id: fila.id,
    tipo: fila.tipo,
    titulo: fila.titulo,
    mensaje: fila.mensaje,
    leida: Boolean(fila.leida),
    creadaEn: fila.creada_en,
  }));
}

export async function existeNotificacionDe(
  usuarioId: string,
  notificacionId: string,
): Promise<boolean> {
  const filas = await query<{ id: string }>(
    `SELECT id FROM NOTIFICACION WHERE id = ? AND usuario_id = ?`,
    [notificacionId, usuarioId],
  );
  return filas.length > 0;
}

export async function marcarLeidaEnBase(
  usuarioId: string,
  notificacionId: string,
): Promise<void> {
  await pool.query(
    `UPDATE NOTIFICACION SET leida = 1 WHERE id = ? AND usuario_id = ?`,
    [notificacionId, usuarioId],
  );
}

export type EnvioPendiente = {
  id: string;
  notificacionId: string;
  canal: string;
  intentos: number;
};

// SKIP LOCKED (MariaDB >= 10.6): dos despachadores concurrentes nunca toman
// el mismo envio. El LIMIT ? escapa mysql2 en la via de query(), no execute().
export async function seleccionarPendientes(
  conn: PoolConnection,
  canal: string,
  limite: number,
): Promise<EnvioPendiente[]> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT id, notificacion_id, canal, intentos
     FROM ENVIO_NOTIFICACION
     WHERE estado = 'PENDIENTE' AND canal = ?
     ORDER BY id
     LIMIT ?
     FOR UPDATE SKIP LOCKED`,
    [canal, limite],
  );
  return filas.map((fila) => ({
    id: String(fila.id),
    notificacionId: String(fila.notificacion_id),
    canal: String(fila.canal),
    intentos: Number(fila.intentos),
  }));
}

export type ResultadoIntento = 'ENVIADO' | 'REINTENTO' | 'FALLIDO' | 'NADA';

export async function registrarIntento(
  conn: PoolConnection,
  envioId: string,
  ok: boolean,
): Promise<ResultadoIntento> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT estado, intentos FROM ENVIO_NOTIFICACION WHERE id = ? FOR UPDATE`,
    [envioId],
  );
  const fila = filas[0] as { estado: string; intentos: number } | undefined;
  if (!fila || fila.estado !== 'PENDIENTE') {
    return 'NADA';
  }

  const intentos = Number(fila.intentos) + 1;
  const estado = ok ? 'ENVIADO' : intentos >= 3 ? 'FALLIDO' : 'PENDIENTE';
  await conn.query(
    `UPDATE ENVIO_NOTIFICACION
     SET estado = ?, intentos = ?, ultimo_intento = UTC_TIMESTAMP(3)
     WHERE id = ?`,
    [estado, intentos, envioId],
  );

  if (estado === 'ENVIADO') return 'ENVIADO';
  if (estado === 'FALLIDO') return 'FALLIDO';
  return 'REINTENTO';
}
