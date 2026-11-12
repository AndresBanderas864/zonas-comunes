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
  // Cadena ISO UTC ('YYYY-MM-DDTHH:mm:ss.SSSZ') producida por DATE_FORMAT
  // en la consulta de validarSesion (columna almacenada en UTC_TIMESTAMP(3)).
  ultimo_uso: string;
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

  // Marca de sistema en UTC explicito: el contenedor MariaDB corre con
  // TZ=America/Bogota, asi que NOW()/DEFAULT CURRENT_TIMESTAMP darian hora
  // local. Se fija ultimo_uso y creada_en aqui en vez de depender del DEFAULT.
  await query(
    `INSERT INTO SESION (id, usuario_id, token_hash, ultimo_uso, creada_en)
     VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [sesionId, usuarioId, hashToken(token)],
  );

  return { token, sesionId };
}

export async function validarSesion(
  token: string,
): Promise<UsuarioSesion | null> {
  const filas = await query<FilaSesion>(
    // ultimo_uso se lee como cadena UTC ('...Z') para que el calculo de
    // minutos sin uso no dependa de la zona horaria del proceso Node: la
    // columna se escribe en UTC_TIMESTAMP(3). La ventana de 30 dias se
    // compara contra UTC_TIMESTAMP(3), no contra NOW(3) local de Bogota.
    `SELECT s.id AS sesion_id,
            CONCAT(DATE_FORMAT(s.ultimo_uso, '%Y-%m-%dT%H:%i:%s.%f'), 'Z') AS ultimo_uso,
            u.id, u.rol, u.apartamento_id, u.nombre, u.correo, u.correo_verificado
     FROM SESION s
     JOIN USUARIO u ON u.id = s.usuario_id
     WHERE s.token_hash = ?
       AND s.revocada_en IS NULL
       AND u.estado = 'ACTIVA'
       AND s.ultimo_uso >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)`,
    [hashToken(token)],
  );

  const fila = filas[0];
  if (!fila) return null;

  const minutosSinUso = (Date.now() - new Date(fila.ultimo_uso).getTime()) / 60_000;
  if (minutosSinUso >= 60) {
    // Marca de sistema en UTC (ver comentario del INSERT).
    await query('UPDATE SESION SET ultimo_uso = UTC_TIMESTAMP(3) WHERE id = ?', [
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
  // Marca de sistema en UTC explicito (contenedor con TZ=America/Bogota).
  await query(
    `UPDATE SESION SET revocada_en = UTC_TIMESTAMP(3)
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
