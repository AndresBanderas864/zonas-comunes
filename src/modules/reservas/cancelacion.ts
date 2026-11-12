import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { query } from '../../db/pool';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { registrarAuditoria } from '../auditoria/service';
import { notificarApartamento } from '../notificaciones/service';
import type { UsuarioSesion } from '../auth/sessions';
import { conReintento, type EstadoReserva } from './service';

// Motivo de cancelacion: limite de VARCHAR(255) de RESERVA, validado en el
// servicio (convencion de esquemaCrear) para responder 400 y nunca 1406/500.
const esquemaMotivo = z
  .string()
  .trim()
  .max(255, 'El motivo no puede superar 255 caracteres');

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

  // Notificacion a los residentes activos, en la misma transaccion (mismo
  // razonamiento que en transaccionReserva: se revierte con el ROLLBACK).
  // Orden completo de locks de esta transaccion, identico al de la reserva:
  //   APARTAMENTO -> OCUPACION_BLOQUE -> RESERVA -> USUARIO(S) -> NOTIFICACION
  // El hook solo anade locks compartidos (FK) sobre USUARIO y la RESERVA ya
  // exclusiva. ATENCION: cualquier transaccion futura que tome un lock sobre
  // USUARIO antes de RESERVA formaria ciclo y deadlock con este orden; toda
  // tx que toque estas filas debe respetar la cadena anterior.
  if (reserva.apartamento_id) {
    const motivoTexto = motivo ? ` Motivo: ${motivo}.` : '';
    await notificarApartamento(conn, reserva.apartamento_id, {
      reservaId: reserva.id,
      tipo: 'CANCELACION',
      titulo: 'Reserva cancelada',
      mensaje: `La reserva del ${reserva.fecha} de ${String(reserva.hora_inicio).slice(0, 5)} quedó cancelada.${motivoTexto}`,
    });
  }

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
  let motivoLimpio: string | null = null;
  if (typeof motivo === 'string' && motivo.trim() !== '') {
    const resultado = esquemaMotivo.safeParse(motivo);
    if (!resultado.success) {
      throw new ValidationError(resultado.error.issues[0].message);
    }
    motivoLimpio = resultado.data;
  }

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

  await conReintento((conn) =>
    transaccionCancelacion(conn, reserva, usuario.id, canceladaPor, motivoLimpio),
  );
}
