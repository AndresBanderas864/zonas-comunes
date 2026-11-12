import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withTransaction } from '../../db/pool';
import { hashPassword, hashToken, generarToken } from '../../lib/crypto';
import { ValidationError } from '../../lib/errors';
import type { Rol } from '../../lib/types';
import {
  buscarInvitacionPorHash,
  buscarTextoLegalVigente,
  buscarTokenVerificacion,
  crearAutorizacion,
  crearTokenVerificacion,
  existeCorreo,
  insertarUsuario,
  marcarCorreoVerificado,
  marcarInvitacionUsada,
  marcarTokenUsado,
  obtenerInvitacionPublica,
  buscarUsuarioPorCorreo,
} from './repository';

export type Usuario = {
  id: string;
  nombre: string;
  correo: string;
  rol: Rol;
  estado: 'PENDIENTE' | 'ACTIVA' | 'DESACTIVADA' | 'BAJA';
  apartamentoId: string | null;
  correoVerificado: boolean;
};

export type UsuarioLogin = {
  id: string;
  nombre: string;
  correo: string;
  rol: Rol;
  estado: 'PENDIENTE' | 'ACTIVA' | 'DESACTIVADA' | 'BAJA';
  apartamentoId: string | null;
  correoVerificado: boolean;
  passwordHash: string;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
};

export async function buscarUsuarioParaLogin(
  correo: string,
): Promise<UsuarioLogin | null> {
  const fila = await buscarUsuarioPorCorreo(correo);
  if (!fila) return null;

  return {
    id: fila.id,
    nombre: fila.nombre,
    correo: fila.correo,
    rol: fila.rol,
    estado: fila.estado,
    apartamentoId: fila.apartamento_id,
    correoVerificado: Boolean(fila.correo_verificado),
    passwordHash: fila.password_hash,
    intentosFallidos: Number(fila.intentos_fallidos),
    bloqueadoHasta: fila.bloqueado_hasta
      ? new Date(fila.bloqueado_hasta)
      : null,
  };
}

export const esquemaRegistro = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(120, 'El nombre no puede superar 120 caracteres'),
  correo: z
    .string()
    .trim()
    .toLowerCase()
    .email('El correo no es válido')
    .max(254, 'El correo no puede superar 254 caracteres'),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(200, 'La contraseña no puede superar 200 caracteres'),
});

type DatosRegistro = z.infer<typeof esquemaRegistro>;

function validarDatos(datos: unknown): DatosRegistro {
  const resultado = esquemaRegistro.safeParse(datos);
  if (!resultado.success) {
    throw new ValidationError(resultado.error.issues[0].message);
  }
  return resultado.data;
}

export async function obtenerInvitacionVigente(
  token: string,
): Promise<{ apartamentoId: string }> {
  const invitacion = await obtenerInvitacionPublica(hashToken(token));
  if (!invitacion) {
    throw new ValidationError('La invitación no es válida');
  }
  if (invitacion.estado !== 'VIGENTE') {
    throw new ValidationError('La invitación ya fue usada o no está vigente');
  }
  if (new Date(invitacion.vence_en) <= new Date()) {
    throw new ValidationError('La invitación venció');
  }
  return { apartamentoId: invitacion.apartamento_id };
}

export async function registrarConInvitacion(
  token: string,
  datos: unknown,
): Promise<Usuario> {
  const validos = validarDatos(datos);
  const tokenHash = hashToken(token);
  const passwordHash = await hashPassword(validos.password);

  return withTransaction(async (conn) => {
    const invitacion = await buscarInvitacionPorHash(conn, tokenHash);
    if (!invitacion) {
      throw new ValidationError('La invitación no es válida');
    }
    if (invitacion.estado !== 'VIGENTE') {
      throw new ValidationError('La invitación ya fue usada o no está vigente');
    }
    if (new Date(invitacion.vence_en) <= new Date()) {
      throw new ValidationError('La invitación venció');
    }
    if (await existeCorreo(conn, validos.correo)) {
      throw new ValidationError('Ese correo ya está registrado');
    }

    const usuarioId = randomUUID();
    try {
      await insertarUsuario(conn, {
        id: usuarioId,
        apartamentoId: invitacion.apartamento_id,
        nombre: validos.nombre,
        correo: validos.correo,
        passwordHash,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new ValidationError('Ese correo ya está registrado');
      }
      throw error;
    }

    await marcarInvitacionUsada(conn, invitacion.id, usuarioId);

    const textoLegal = await buscarTextoLegalVigente(conn, 'AUTORIZACION');
    if (textoLegal) {
      await crearAutorizacion(conn, usuarioId, textoLegal.id);
    }

    const tokenVerificacion = generarToken();
    const venceEn = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await crearTokenVerificacion(
      conn,
      usuarioId,
      hashToken(tokenVerificacion),
      venceEn,
    );
    console.info(`Enlace de verificación: /verificar/${tokenVerificacion}`);

    return {
      id: usuarioId,
      nombre: validos.nombre,
      correo: validos.correo,
      rol: 'RESIDENTE' as const,
      estado: 'ACTIVA' as const,
      apartamentoId: invitacion.apartamento_id,
      correoVerificado: false,
    };
  });
}

export async function verificarCorreo(token: string): Promise<void> {
  const tokenHash = hashToken(token);

  await withTransaction(async (conn) => {
    const fila = await buscarTokenVerificacion(conn, tokenHash);
    if (!fila) {
      throw new ValidationError('El enlace de verificación no es válido');
    }
    if (fila.usado_en) {
      return;
    }
    if (new Date(fila.vence_en) <= new Date()) {
      throw new ValidationError('El enlace de verificación venció');
    }

    await marcarCorreoVerificado(conn, fila.usuario_id);
    await marcarTokenUsado(conn, fila.id);
  });
}
