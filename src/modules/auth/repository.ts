import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { query } from '../../db/pool';
import type { Rol } from '../../lib/types';

export type InvitacionFila = {
  id: string;
  apartamento_id: string;
  estado: string;
  vence_en: Date;
};

export type TextoLegalFila = { id: string };

export type TokenVerificacionFila = {
  id: string;
  usuario_id: string;
  usado_en: Date | null;
  vence_en: Date;
};

export type UsuarioLoginFila = {
  id: string;
  rol: Rol;
  apartamento_id: string | null;
  nombre: string;
  correo: string;
  password_hash: string;
  estado: 'PENDIENTE' | 'ACTIVA' | 'DESACTIVADA' | 'BAJA';
  correo_verificado: number;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
};

export async function buscarUsuarioPorCorreo(
  correo: string,
): Promise<UsuarioLoginFila | null> {
  const filas = await query<UsuarioLoginFila>(
    `SELECT id, rol, apartamento_id, nombre, correo, password_hash, estado,
            correo_verificado, intentos_fallidos, bloqueado_hasta
     FROM USUARIO WHERE correo = ?`,
    [correo],
  );
  return filas[0] ?? null;
}

export async function buscarInvitacionPorHash(
  conn: PoolConnection,
  tokenHash: string,
): Promise<InvitacionFila | null> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT id, apartamento_id, estado, vence_en
     FROM INVITACION WHERE token_hash = ? FOR UPDATE`,
    [tokenHash],
  );
  return (filas[0] as InvitacionFila | undefined) ?? null;
}

export async function obtenerInvitacionPublica(
  tokenHash: string,
): Promise<InvitacionFila | null> {
  const filas = await query<InvitacionFila>(
    `SELECT id, apartamento_id, estado, vence_en
     FROM INVITACION WHERE token_hash = ?`,
    [tokenHash],
  );
  return filas[0] ?? null;
}

export async function existeCorreo(
  conn: PoolConnection,
  correo: string,
): Promise<boolean> {
  const [filas] = await conn.query<RowDataPacket[]>(
    'SELECT id FROM USUARIO WHERE correo = ?',
    [correo],
  );
  return filas.length > 0;
}

export async function insertarUsuario(
  conn: PoolConnection,
  datos: {
    id: string;
    apartamentoId: string;
    nombre: string;
    correo: string;
    passwordHash: string;
  },
): Promise<void> {
  await conn.query(
    // creado_en se fija en UTC explicito (UTC_TIMESTAMP(3)): el contenedor
    // corre con TZ=America/Bogota y el DEFAULT CURRENT_TIMESTAMP(3) daria
    // hora local. Marca de sistema, nunca comparada desde JS.
    `INSERT INTO USUARIO
       (id, rol, apartamento_id, nombre, correo, password_hash, estado, correo_verificado, creado_en)
     VALUES (?, 'RESIDENTE', ?, ?, ?, ?, 'ACTIVA', 0, UTC_TIMESTAMP(3))`,
    [datos.id, datos.apartamentoId, datos.nombre, datos.correo, datos.passwordHash],
  );
}

export async function marcarInvitacionUsada(
  conn: PoolConnection,
  invitacionId: string,
  usuarioId: string,
): Promise<void> {
  await conn.query(
    // usada_en: marca de sistema en UTC explicito (TZ=America/Bogota en el
    // servidor haria que NOW(3) devolviera hora local). Nadie compara su
    // valor desde JS; solo se registra.
    `UPDATE INVITACION SET estado = 'USADA', usada_en = UTC_TIMESTAMP(3), usuario_id = ?
     WHERE id = ?`,
    [usuarioId, invitacionId],
  );
}

export async function buscarTextoLegalVigente(
  conn: PoolConnection,
  tipo: string,
): Promise<TextoLegalFila | null> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM TEXTO_LEGAL WHERE tipo = ? ORDER BY version DESC LIMIT 1`,
    [tipo],
  );
  return (filas[0] as TextoLegalFila | undefined) ?? null;
}

export async function crearAutorizacion(
  conn: PoolConnection,
  usuarioId: string,
  textoLegalId: string,
): Promise<void> {
  await conn.query(
    // aceptada_en: marca de sistema en UTC explicito (NOW(3) daria hora
    // local de Bogota en este servidor).
    `INSERT INTO AUTORIZACION_DATOS (id, usuario_id, texto_legal_id, aceptada_en)
     VALUES (UUID(), ?, ?, UTC_TIMESTAMP(3))`,
    [usuarioId, textoLegalId],
  );
}

export async function crearTokenVerificacion(
  conn: PoolConnection,
  usuarioId: string,
  tokenHash: string,
  venceEn: Date,
): Promise<void> {
  await conn.query(
    // creado_en en UTC explicito (no depender del DEFAULT CURRENT_TIMESTAMP:
    // el servidor tiene TZ=America/Bogota). vence_en es hora UTC serializada
    // desde un Date de JS por el llamante y se relee desde JS: pair coherente.
    `INSERT INTO TOKEN_VERIFICACION (id, usuario_id, tipo, token_hash, vence_en, creado_en)
     VALUES (UUID(), ?, 'VERIFICAR_CORREO', ?, ?, UTC_TIMESTAMP(3))`,
    [usuarioId, tokenHash, venceEn],
  );
}

export async function buscarTokenVerificacion(
  conn: PoolConnection,
  tokenHash: string,
): Promise<TokenVerificacionFila | null> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT id, usuario_id, usado_en, vence_en
     FROM TOKEN_VERIFICACION
     WHERE token_hash = ? AND tipo = 'VERIFICAR_CORREO'
     FOR UPDATE`,
    [tokenHash],
  );
  return (filas[0] as TokenVerificacionFila | undefined) ?? null;
}

export async function crearTokenRecuperacion(
  conn: PoolConnection,
  usuarioId: string,
  tokenHash: string,
  venceEn: Date,
): Promise<void> {
  await conn.query(
    // creado_en en UTC explicito (mismo criterio que crearTokenVerificacion).
    `INSERT INTO TOKEN_VERIFICACION (id, usuario_id, tipo, token_hash, vence_en, creado_en)
     VALUES (UUID(), ?, 'RESTABLECER_PASSWORD', ?, ?, UTC_TIMESTAMP(3))`,
    [usuarioId, tokenHash, venceEn],
  );
}

export async function invalidarTokensRecuperacion(
  conn: PoolConnection,
  usuarioId: string,
): Promise<void> {
  await conn.query(
    // usado_en: marca de sistema en UTC explicito; los lectores solo miran
    // IS NULL, nunca comparan el valor.
    `UPDATE TOKEN_VERIFICACION SET usado_en = UTC_TIMESTAMP(3)
     WHERE usuario_id = ? AND tipo = 'RESTABLECER_PASSWORD' AND usado_en IS NULL`,
    [usuarioId],
  );
}

export async function buscarEstadoUsuario(
  conn: PoolConnection,
  usuarioId: string,
): Promise<string | null> {
  const [filas] = await conn.query<RowDataPacket[]>(
    'SELECT estado FROM USUARIO WHERE id = ?',
    [usuarioId],
  );
  return filas[0] ? String(filas[0].estado) : null;
}

export async function buscarTokenRecuperacion(
  conn: PoolConnection,
  tokenHash: string,
): Promise<TokenVerificacionFila | null> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT id, usuario_id, usado_en, vence_en
     FROM TOKEN_VERIFICACION
     WHERE token_hash = ? AND tipo = 'RESTABLECER_PASSWORD'
     FOR UPDATE`,
    [tokenHash],
  );
  return (filas[0] as TokenVerificacionFila | undefined) ?? null;
}

export async function actualizarPasswordUsuario(
  conn: PoolConnection,
  usuarioId: string,
  passwordHash: string,
): Promise<void> {
  await conn.query(
    `UPDATE USUARIO SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL
     WHERE id = ?`,
    [passwordHash, usuarioId],
  );
}

export async function revocarSesionesDeUsuario(
  conn: PoolConnection,
  usuarioId: string,
): Promise<void> {
  await conn.query(
    // revocada_en: marca de sistema en UTC explicito (NOW(3) daria Bogota).
    `UPDATE SESION SET revocada_en = UTC_TIMESTAMP(3)
     WHERE usuario_id = ? AND revocada_en IS NULL`,
    [usuarioId],
  );
}

export async function marcarCorreoVerificado(
  conn: PoolConnection,
  usuarioId: string,
): Promise<void> {
  await conn.query('UPDATE USUARIO SET correo_verificado = 1 WHERE id = ?', [
    usuarioId,
  ]);
}

export async function marcarTokenUsado(
  conn: PoolConnection,
  tokenId: string,
): Promise<void> {
  // usado_en: marca de sistema en UTC explicito; los lectores solo miran
  // IS NULL, nunca comparan el valor.
  await conn.query(
    'UPDATE TOKEN_VERIFICACION SET usado_en = UTC_TIMESTAMP(3) WHERE id = ?',
    [tokenId],
  );
}
