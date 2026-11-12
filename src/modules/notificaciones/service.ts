import type { PoolConnection } from 'mysql2/promise';
import {
  existeNotificacionDe,
  insertarNotificacion,
  listarBandeja,
  marcarLeidaEnBase,
  usuariosActivosDeApartamento,
  type InputNotificacion,
  type NotificacionBandeja,
} from './repository';

export type TipoNotificacion = 'CONFIRMACION' | 'CANCELACION' | 'RECORDATORIO';

export type CrearNotificacionInput = InputNotificacion;

export type NotificarApartamentoInput = {
  reservaId?: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
};

// Toda escritura vive en la transaccion del llamante (crearReserva,
// cancelarReserva): nunca se abre una segunda transaccion aqui.
export async function crearNotificacion(
  conn: PoolConnection,
  input: CrearNotificacionInput,
): Promise<void> {
  await insertarNotificacion(conn, input);
}

export async function notificarApartamento(
  conn: PoolConnection,
  apartamentoId: string,
  input: NotificarApartamentoInput,
): Promise<void> {
  const usuarios = await usuariosActivosDeApartamento(conn, apartamentoId);
  for (const usuarioId of usuarios) {
    await insertarNotificacion(conn, { ...input, usuarioId });
  }
}

export async function bandejaDe(
  usuarioId: string,
): Promise<NotificacionBandeja[]> {
  return listarBandeja(usuarioId);
}

// Propiedad comprobada en el servidor: nadie marca leida una notificacion
// ajena. Devuelve false si la notificacion no existe o no es del usuario.
export async function marcarLeida(
  usuarioId: string,
  notificacionId: string,
): Promise<boolean> {
  if (!(await existeNotificacionDe(usuarioId, notificacionId))) {
    return false;
  }
  await marcarLeidaEnBase(usuarioId, notificacionId);
  return true;
}
