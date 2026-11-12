import { randomUUID } from 'node:crypto';
import { query } from '../../db/pool';
import { generarToken, hashToken } from '../../lib/crypto';
import type { Rol } from '../../lib/types';

export type UsuarioSesion = {
  id: string;
  rol: Rol;
  apartamentoId: string | null;
  nombre: string;
  correo: string;
  correoVerificado: boolean;
};

type FilaSesion = {
  sesion_id: string;
  ultimo_uso: Date;
  id: string;
  rol: Rol;
  apartamento_id: string | null;
  nombre: string;
  correo: string;
  correo_verificado: number;
};

export async function crearSesion(
  usuarioId: string,
): Promise<{ token: string; sesionId: string }> {
  const token = generarToken();
  const sesionId = randomUUID();

  await query(
    'INSERT INTO SESION (id, usuario_id, token_hash) VALUES (?, ?, ?)',
    [sesionId, usuarioId, hashToken(token)],
  );

  return { token, sesionId };
}

export async function validarSesion(
  token: string,
): Promise<UsuarioSesion | null> {
  const filas = await query<FilaSesion>(
    `SELECT s.id AS sesion_id, s.ultimo_uso,
            u.id, u.rol, u.apartamento_id, u.nombre, u.correo, u.correo_verificado
     FROM SESION s
     JOIN USUARIO u ON u.id = s.usuario_id
     WHERE s.token_hash = ?
       AND s.revocada_en IS NULL
       AND u.estado = 'ACTIVA'
       AND s.ultimo_uso >= DATE_SUB(NOW(3), INTERVAL 30 DAY)`,
    [hashToken(token)],
  );

  const fila = filas[0];
  if (!fila) return null;

  const minutosSinUso = (Date.now() - new Date(fila.ultimo_uso).getTime()) / 60_000;
  if (minutosSinUso >= 60) {
    await query('UPDATE SESION SET ultimo_uso = NOW(3) WHERE id = ?', [
      fila.sesion_id,
    ]);
  }

  return {
    id: fila.id,
    rol: fila.rol,
    apartamentoId: fila.apartamento_id,
    nombre: fila.nombre,
    correo: fila.correo,
    correoVerificado: Boolean(fila.correo_verificado),
  };
}

export async function revocarSesion(token: string): Promise<void> {
  await query(
    `UPDATE SESION SET revocada_en = NOW(3)
     WHERE token_hash = ? AND revocada_en IS NULL`,
    [hashToken(token)],
  );
}

export function leerCookieSid(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const par = cookieHeader
    .split(';')
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith('sid='));
  return par ? par.slice('sid='.length) : null;
}
