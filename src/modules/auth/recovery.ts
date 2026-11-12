import { z } from 'zod';
import { withTransaction } from '../../db/pool';
import { generarToken, hashPassword, hashToken } from '../../lib/crypto';
import { ValidationError } from '../../lib/errors';
import type { PoolConnection } from 'mysql2/promise';
import {
  actualizarPasswordUsuario,
  buscarEstadoUsuario,
  buscarTokenRecuperacion,
  buscarUsuarioPorCorreo,
  crearTokenRecuperacion,
  invalidarTokensRecuperacion,
  marcarTokenUsado,
  revocarSesionesDeUsuario,
  type TokenVerificacionFila,
} from './repository';

const VIGENCIA_MS = 60 * 60 * 1000;

export class EnlaceInvalidoError extends ValidationError {
  constructor() {
    super('El enlace de recuperación no es válido, ya fue usado o venció');
  }
}

export const esquemaCorreoRecuperacion = z.object({
  correo: z
    .string()
    .trim()
    .toLowerCase()
    .email('El correo no es válido')
    .max(254, 'El correo no puede superar 254 caracteres'),
});

const esquemaNuevaPassword = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(200, 'La contraseña no puede superar 200 caracteres');

/** Token utilizable: existe, no usado, no vencido y la cuenta sigue ACTIVA. */
async function obtenerTokenUtilizable(
  conn: PoolConnection,
  token: string,
): Promise<TokenVerificacionFila> {
  const fila = await buscarTokenRecuperacion(conn, hashToken(token));
  if (!fila || fila.usado_en || new Date(fila.vence_en) <= new Date()) {
    throw new EnlaceInvalidoError();
  }
  const estado = await buscarEstadoUsuario(conn, fila.usuario_id);
  if (estado !== 'ACTIVA') {
    throw new EnlaceInvalidoError();
  }
  return fila;
}

/**
 * Crea un token de recuperación para una cuenta activa.
 * Devuelve el token en claro solo para el "envío" (log); si el correo no
 * corresponde a una cuenta activa devuelve null sin revelarlo al llamador HTTP.
 */
export async function solicitarRecuperacion(correo: string): Promise<string | null> {
  const correoNormalizado = correo.trim().toLowerCase();
  if (!correoNormalizado) return null;

  const usuario = await buscarUsuarioPorCorreo(correoNormalizado);
  if (!usuario || usuario.estado !== 'ACTIVA') return null;

  const token = generarToken();
  const venceEn = new Date(Date.now() + VIGENCIA_MS);

  await withTransaction(async (conn) => {
    await invalidarTokensRecuperacion(conn, usuario.id);
    await crearTokenRecuperacion(conn, usuario.id, hashToken(token), venceEn);
  });
  console.info(`Enlace de recuperación: /restablecer/${token}`);

  return token;
}

export async function validarTokenRecuperacion(token: string): Promise<void> {
  await withTransaction((conn) => obtenerTokenUtilizable(conn, token));
}

export async function restablecerPassword(token: string, nueva: string): Promise<void> {
  const resultado = esquemaNuevaPassword.safeParse(nueva);
  if (!resultado.success) {
    throw new ValidationError(resultado.error.issues[0].message);
  }

  const passwordHash = await hashPassword(resultado.data);

  await withTransaction(async (conn) => {
    const fila = await obtenerTokenUtilizable(conn, token);

    await actualizarPasswordUsuario(conn, fila.usuario_id, passwordHash);
    await marcarTokenUsado(conn, fila.id);
    await revocarSesionesDeUsuario(conn, fila.usuario_id);
  });
}
