import type { RowDataPacket } from 'mysql2/promise';
import { withTransaction, query } from '../../db/pool';
import { ConflictError, NotFoundError } from '../../lib/errors';
import type { Rol } from '../../lib/types';
import { revocarSesionesDeUsuario } from '../auth/repository';
import { registrarAuditoria } from '../auditoria/service';
import type { UsuarioSesion } from '../auth/sessions';

export type Usuario = {
  id: string;
  nombre: string;
  correo: string;
  rol: Rol;
  estado: string;
  apartamentoId: string | null;
  apartamento: string | null;
};

type UsuarioFila = {
  id: string;
  nombre: string;
  correo: string;
  rol: Rol;
  estado: string;
  apartamento_id: string | null;
  torre_interior: string | null;
  numero: string | null;
};

export async function listarUsuarios(): Promise<Usuario[]> {
  const filas = await query<UsuarioFila>(
    `SELECT u.id, u.nombre, u.correo, u.rol, u.estado, u.apartamento_id,
            a.torre_interior, a.numero
     FROM USUARIO u
     LEFT JOIN APARTAMENTO a ON a.id = u.apartamento_id
     ORDER BY u.nombre`,
  );

  return filas.map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    correo: fila.correo,
    rol: fila.rol,
    estado: fila.estado,
    apartamentoId: fila.apartamento_id,
    apartamento:
      fila.torre_interior && fila.numero
        ? `${fila.torre_interior}-${fila.numero}`
        : null,
  }));
}

export async function desactivarUsuario(
  usuarioId: string,
  actor: UsuarioSesion,
): Promise<void> {
  await withTransaction(async (conn) => {
    const [filas] = await conn.query<RowDataPacket[]>(
      'SELECT rol, estado FROM USUARIO WHERE id = ? FOR UPDATE',
      [usuarioId],
    );
    const usuario = filas[0] as { rol: Rol; estado: string } | undefined;
    if (!usuario) {
      throw new NotFoundError('El usuario no existe');
    }

    if (usuarioId === actor.id) {
      throw new ConflictError('No puedes desactivar tu propia cuenta');
    }

    if (usuario.estado === 'DESACTIVADA') {
      throw new ConflictError('El usuario ya esta desactivado');
    }

    if (usuario.rol === 'ADMINISTRADOR' && usuario.estado === 'ACTIVA') {
      const [admins] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) n FROM USUARIO
         WHERE rol = 'ADMINISTRADOR' AND estado = 'ACTIVA' AND id <> ?`,
        [usuarioId],
      );
      if (Number(admins[0]?.n ?? 0) === 0) {
        throw new ConflictError(
          'El sistema debe conservar al menos un administrador activo',
        );
      }
    }

    await conn.query(
      `UPDATE USUARIO SET estado = 'DESACTIVADA' WHERE id = ?`,
      [usuarioId],
    );
    await revocarSesionesDeUsuario(conn, usuarioId);

    await registrarAuditoria(conn, {
      usuarioId: actor.id,
      accion: 'usuario.desactivar',
      entidad: 'USUARIO',
      entidadId: usuarioId,
      detalle: { rol: usuario.rol, estado: 'DESACTIVADA' },
    });
  });
}
