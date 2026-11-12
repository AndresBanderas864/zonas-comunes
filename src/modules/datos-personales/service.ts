import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { registrarAuditoria } from '../auditoria/service';

export type TextoLegal = {
  id: string;
  tipo: 'AUTORIZACION' | 'POLITICA' | 'AVISO_PRIVACIDAD';
  version: number;
  contenido: string;
  vigenteDesde: string;
};

type TextoLegalFila = {
  id: string;
  tipo: TextoLegal['tipo'];
  version: number;
  contenido: string;
  vigente_desde: string;
};

const esquemaNombre = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(120, 'El nombre no puede superar 120 caracteres'),
});

export async function actualizarNombre(
  usuarioId: string,
  nombre: string,
): Promise<void> {
  const resultado = esquemaNombre.safeParse({ nombre });
  if (!resultado.success) {
    throw new ValidationError(resultado.error.issues[0].message);
  }

  await withTransaction(async (conn) => {
    const [header] = await conn.query<ResultSetHeader>(
      'UPDATE USUARIO SET nombre = ? WHERE id = ?',
      [resultado.data.nombre, usuarioId],
    );
    if (header.affectedRows === 0) {
      throw new NotFoundError('El usuario no existe');
    }

    await registrarAuditoria(conn, {
      usuarioId,
      accion: 'usuario.rectificar_nombre',
      entidad: 'USUARIO',
      entidadId: usuarioId,
      detalle: { nombre: resultado.data.nombre },
    });
  });
}

export async function aceptarPolitica(
  usuarioId: string,
  textoLegalId: string,
): Promise<void> {
  await withTransaction(async (conn) => {
    const [filas] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM TEXTO_LEGAL WHERE id = ? AND tipo = 'POLITICA'`,
      [textoLegalId],
    );
    if (filas.length === 0) {
      throw new NotFoundError('La política de datos no existe');
    }

    try {
      // aceptada_en: marca de sistema en UTC explicito (el contenedor corre
      // con TZ=America/Bogota y NOW(3) daria hora local).
      await conn.query(
        `INSERT INTO AUTORIZACION_DATOS (id, usuario_id, texto_legal_id, aceptada_en)
         VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
        [randomUUID(), usuarioId, textoLegalId],
      );
    } catch (error) {
      // UNIQUE(usuario_id, texto_legal_id): reaceptar la misma version es
      // no-op idempotente, nunca un error ni un duplicado.
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        return;
      }
      throw error;
    }
  });
}

export async function politicaVigente(): Promise<TextoLegal> {
  const filas = await query<TextoLegalFila>(
    // vigente_desde se lee como cadena UTC ('...Z') via DATE_FORMAT para que
    // la comparacion no dependa de la zona horaria del proceso Node; la
    // columna se escribe en UTC_TIMESTAMP(3).
    `SELECT id, tipo, version, contenido,
            CONCAT(DATE_FORMAT(vigente_desde, '%Y-%m-%dT%H:%i:%s.%f'), 'Z') AS vigente_desde
     FROM TEXTO_LEGAL
     WHERE tipo = 'POLITICA' AND vigente_desde <= UTC_TIMESTAMP(3)
     ORDER BY version DESC
     LIMIT 1`,
  );

  const fila = filas[0];
  if (!fila) {
    throw new NotFoundError('No hay una política de datos vigente');
  }

  return {
    id: fila.id,
    tipo: fila.tipo,
    version: Number(fila.version),
    contenido: fila.contenido,
    vigenteDesde: fila.vigente_desde,
  };
}

export async function politicaAceptada(
  usuarioId: string,
  textoLegalId: string,
): Promise<boolean> {
  const filas = await query<{ id: string }>(
    `SELECT id FROM AUTORIZACION_DATOS WHERE usuario_id = ? AND texto_legal_id = ?`,
    [usuarioId, textoLegalId],
  );
  return filas.length > 0;
}
