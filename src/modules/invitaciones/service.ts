import { randomUUID } from 'node:crypto';
import { withTransaction } from '../../db/pool';
import { generarToken, hashToken } from '../../lib/crypto';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import type { UsuarioSesion } from '../auth/sessions';
import { registrarAuditoria } from '../auditoria/service';
import {
  apartamentoExiste,
  insertarInvitacion,
  marcarInvitacionRevocada,
  obtenerInvitacionFila,
  listarInvitacionesFilas,
} from './repository';

export type Invitacion = {
  id: string;
  apartamentoId: string;
  apartamento: string;
  estado: string;
  venceEn: string;
};

const VIGENCIA_DIAS = 7;

export async function listarInvitaciones(): Promise<Invitacion[]> {
  const filas = await listarInvitacionesFilas();
  return filas.map((fila) => ({
    id: fila.id,
    apartamentoId: fila.apartamento_id,
    apartamento: `${fila.apartamento_torre}-${fila.apartamento_numero}`,
    estado: fila.estado,
    venceEn: new Date(fila.vence_en).toISOString(),
  }));
}

export async function crearInvitacion(
  apartamentoId: string,
  actor: UsuarioSesion,
): Promise<{ token: string; invitacionId: string; venceEn: string }> {
  const id = String(apartamentoId ?? '').trim();
  if (!id) {
    throw new ValidationError('Debes seleccionar un apartamento');
  }

  const invitacionId = randomUUID();
  const token = generarToken();
  const tokenHash = hashToken(token);
  const venceEn = new Date(Date.now() + VIGENCIA_DIAS * 24 * 60 * 60 * 1000);

  await withTransaction(async (conn) => {
    if (!(await apartamentoExiste(conn, id))) {
      throw new ValidationError('El apartamento no existe');
    }

    await insertarInvitacion(conn, {
      id: invitacionId,
      apartamentoId: id,
      creadaPor: actor.id,
      tokenHash,
      venceEn,
    });

    await registrarAuditoria(conn, {
      usuarioId: actor.id,
      accion: 'invitacion.crear',
      entidad: 'INVITACION',
      entidadId: invitacionId,
      detalle: { apartamentoId: id },
    });
  });

  console.info(`Enlace de invitacion: /registro/${token}`);
  return { token, invitacionId, venceEn: venceEn.toISOString() };
}

export async function revocarInvitacion(
  invitacionId: string,
  actor: UsuarioSesion,
): Promise<void> {
  await withTransaction(async (conn) => {
    const invitacion = await obtenerInvitacionFila(conn, invitacionId);
    if (!invitacion) {
      throw new NotFoundError('La invitacion no existe');
    }
    if (invitacion.estado !== 'VIGENTE') {
      throw new ConflictError('Solo se pueden revocar invitaciones vigentes');
    }

    await marcarInvitacionRevocada(conn, invitacionId);

    await registrarAuditoria(conn, {
      usuarioId: actor.id,
      accion: 'invitacion.revocar',
      entidad: 'INVITACION',
      entidadId: invitacionId,
      detalle: { estado: 'REVOCADA' },
    });
  });
}
