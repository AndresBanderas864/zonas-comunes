import { z } from 'zod';
import { withTransaction } from '../../db/pool';
import { generarToken, hashPassword, hashToken } from '../../lib/crypto';
import { ValidationError } from '../../lib/errors';
import {
  actualizarPasswordUsuario,
  buscarTokenRecuperacion,
  buscarUsuarioPorCorreo,
  crearTokenRecuperacion,
  marcarTokenUsado,
  revocarSesionesDeUsuario,
} from './repository';

const VIGENCIA_MS = 60 * 60 * 1000;

export class EnlaceInvalidoError extends ValidationError {
  constructor() {
    super('El enlace de recuperación no es válido, ya fue usado o venció');
  }
}

const esquemaNuevaPassword = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(200, 'La contraseña no puede superar 200 caracteres');

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

  await withTransaction((conn) =>
    crearTokenRecuperacion(conn, usuario.id, hashToken(token), venceEn),
  );
  console.info(`Enlace de recuperación: /restablecer/${token}`);

  return token;
}

export async function validarTokenRecuperacion(token: string): Promise<void> {
  const filas = await withTransaction((conn) =>
    buscarTokenRecuperacion(conn, hashToken(token)),
  );
  if (!filas || filas.usado_en || new Date(filas.vence_en) <= new Date()) {
    throw new EnlaceInvalidoError();
  }
}

export async function restablecerPassword(token: string, nueva: string): Promise<void> {
  const resultado = esquemaNuevaPassword.safeParse(nueva);
  if (!resultado.success) {
    throw new ValidationError(resultado.error.issues[0].message);
  }

  const passwordHash = await hashPassword(resultado.data);

  await withTransaction(async (conn) => {
    const fila = await buscarTokenRecuperacion(conn, hashToken(token));
    if (!fila || fila.usado_en || new Date(fila.vence_en) <= new Date()) {
      throw new EnlaceInvalidoError();
    }

    await actualizarPasswordUsuario(conn, fila.usuario_id, passwordHash);
    await marcarTokenUsado(conn, fila.id);
    await revocarSesionesDeUsuario(conn, fila.usuario_id);
  });
}
