import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { query } from '../../db/pool';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { registrarAuditoria } from '../auditoria/service';
import type { UsuarioSesion } from '../auth/sessions';
import { conReintento, type EstadoReserva } from './service';

type FilaReservaCancelable = {
  id: string;
  apartamento_id: string | null;
  zona_id: string;
  fecha: string;
  hora_inicio: string;
  cupos: number;
  estado: EstadoReserva;
};

async function leerReserva(reservaId: string): Promise<FilaReservaCancelable> {
  const filas = await query<FilaReservaCancelable>(
    `SELECT id, apartamento_id, zona_id, DATE_FORMAT(fecha, '%Y-%m-%d') fecha,
            TIME_FORMAT(hora_inicio, '%H:%i:%s') hora_inicio, cupos, estado
     FROM RESERVA WHERE id = ?`,
    [reservaId],
  );
  const fila = filas[0];
  if (!fila) {
    throw new NotFoundError('La reserva no existe');
  }
  return fila;
}

// Diseno 9.2 (cancelacion, transaccion inversa a la reserva). Orden de locks
// OBLIGATORIAMENTE identico al de transaccionReserva en service.ts:
// APARTAMENTO -> OCUPACION_BLOQUE -> RESERVA. Si la cancelacion tocara la
// fila del bloque despues de la RESERVA (p. ej. UPDATE RESERVA primero), un POST
// concurrente del mismo bloque (que lockea bloque antes que reserva) formaria
// un ciclo de deadlock vivo. Los locks se toman en el mismo sentido total, con
// lo cual cancelar y reservar nunca se enredan, y 1213/1020, si aparecieran,
// los cubre el mismo conReintento de la reserva.
async function transaccionCancelacion(
  conn: PoolConnection,
  reserva: FilaReservaCancelable,
  usuarioId: string,
  canceladaPor: 'RESIDENTE' | 'ADMINISTRADOR',
  motivo: string | null,
): Promise<void> {
  // (1) Fila del apartamento, mismo primer lock que la reserva.
  if (reserva.apartamento_id) {
    await conn.query(`SELECT id FROM APARTAMENTO WHERE id = ? FOR UPDATE`, [
      reserva.apartamento_id,
    ]);
  }

  // (2) Asegura y lockea la fila del bloque (no-op si ya existe) ANTES de
  // tocar RESERVA: el decremento posterior ya tiene su lock tomado.
  await conn.query(
    `INSERT INTO OCUPACION_BLOQUE (zona_id, fecha, hora_inicio, cupos_ocupados)
     VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE zona_id = zona_id`,
    [reserva.zona_id, reserva.fecha, reserva.hora_inicio],
  );

  // (3) Idempotencia atomo-concurente: solo pasa de CONFIRMADA a CANCELADA una
  // vez. affectedRows = 0 -> ya estaba cancelada (o vencida en esta carrera)
  // -> 409 sin tocar el contador. La lectura de estado fuera de la transaccion
  // es solo para el mensaje; aqui manda el estado comprometido actual.
  const [actualizacion] = await conn.query<ResultSetHeader>(
    `UPDATE RESERVA
     SET estado = 'CANCELADA', cancelada_por = ?, cancelada_por_usuario = ?,
         motivo_cancelacion = ?, cancelada_en = UTC_TIMESTAMP(3)
     WHERE id = ? AND estado = 'CONFIRMADA'`,
    [canceladaPor, usuarioId, motivo, reserva.id],
  );
  if (actualizacion.affectedRows === 0) {
    throw new ConflictError('La reserva ya no esta confirmada');
  }

  // (4) Devolucion de cupos. La CHECK cupos_ocupados >= 0 de la base hace
  // imposible un contador negativo: cualquier doble resta abortaria la
  // transaccion en vez de corromper el contador.
  await conn.query(
    `UPDATE OCUPACION_BLOQUE
     SET cupos_ocupados = cupos_ocupados - ?
     WHERE zona_id = ? AND fecha = ? AND hora_inicio = ?`,
    [reserva.cupos, reserva.zona_id, reserva.fecha, reserva.hora_inicio],
  );

  if (canceladaPor === 'ADMINISTRADOR') {
    await registrarAuditoria(conn, {
      usuarioId,
      accion: 'reserva.cancelar_admin',
      entidad: 'RESERVA',
      entidadId: reserva.id,
      detalle: { apartamentoId: reserva.apartamento_id, motivo },
    });
  }
}

export async function cancelarReserva(
  usuario: UsuarioSesion,
  reservaId: string,
  motivo?: string,
): Promise<void> {
  const reserva = await leerReserva(String(reservaId));

  let canceladaPor: 'RESIDENTE' | 'ADMINISTRADOR';
  if (usuario.rol === 'ADMINISTRADOR') {
    canceladaPor = 'ADMINISTRADOR';
  } else if (
    usuario.rol === 'RESIDENTE' &&
    usuario.apartamentoId &&
    reserva.apartamento_id === usuario.apartamentoId
  ) {
    canceladaPor = 'RESIDENTE';
  } else {
    throw new ForbiddenError('No puedes cancelar la reserva de otro apartamento');
  }

  if (reserva.estado === 'VENCIDA') {
    throw new ConflictError('La reserva ya vencio y no se puede cancelar');
  }

  const motivoLimpio = typeof motivo === 'string' && motivo.trim() !== '' ? motivo.trim() : null;

  await conReintento((conn) =>
    transaccionCancelacion(conn, reserva, usuario.id, canceladaPor, motivoLimpio),
  );
}
