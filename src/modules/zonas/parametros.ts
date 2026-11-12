import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool';
import { ValidationError } from '../../lib/errors';
import { requireRole } from '../../middleware/require-role';
import { registrarAuditoria } from '../auditoria/service';

export type Parametros = {
  maxReservasSemana: number;
  maxReservasDia: number;
  anticipacionDias: number;
};

type ParametroFila = {
  max_reservas_semana: number;
  max_reservas_dia: number;
  anticipacion_dias: number;
};

const VALORES_POR_DEFECTO: Parametros = {
  maxReservasSemana: 7,
  maxReservasDia: 3,
  anticipacionDias: 7,
};

const esquemaParametros = z.object({
  maxReservasSemana: z.coerce
    .number()
    .int('El maximo semanal debe ser un numero entero')
    .min(1, 'El maximo semanal debe ser mayor que cero'),
  maxReservasDia: z.coerce
    .number()
    .int('El maximo diario debe ser un numero entero')
    .min(1, 'El maximo diario debe ser mayor que cero'),
  anticipacionDias: z.coerce
    .number()
    .int('La anticipacion debe ser un numero entero de dias')
    .min(1, 'La anticipacion debe ser mayor que cero'),
});

function validarParametros(entrada: unknown): Parametros {
  const resultado = esquemaParametros.safeParse(entrada);
  if (!resultado.success) {
    throw new ValidationError(resultado.error.issues[0].message);
  }

  const datos = resultado.data;
  if (datos.maxReservasDia > datos.maxReservasSemana) {
    throw new ValidationError(
      'El maximo diario no puede superar el maximo semanal',
    );
  }

  return datos;
}

export async function obtenerParametros(): Promise<Parametros> {
  await query(
    `INSERT IGNORE INTO PARAMETRO_RESERVA
       (id, max_reservas_semana, max_reservas_dia, anticipacion_dias)
     VALUES (1, ?, ?, ?)`,
    [
      VALORES_POR_DEFECTO.maxReservasSemana,
      VALORES_POR_DEFECTO.maxReservasDia,
      VALORES_POR_DEFECTO.anticipacionDias,
    ],
  );

  const filas = await query<ParametroFila>(
    `SELECT max_reservas_semana, max_reservas_dia, anticipacion_dias
     FROM PARAMETRO_RESERVA WHERE id = 1`,
  );
  const fila = filas[0];

  return {
    maxReservasSemana: Number(fila.max_reservas_semana),
    maxReservasDia: Number(fila.max_reservas_dia),
    anticipacionDias: Number(fila.anticipacion_dias),
  };
}

export async function actualizarParametros(
  entrada: Parametros,
  actorId: string,
): Promise<void> {
  const datos = validarParametros(entrada);

  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO PARAMETRO_RESERVA
         (id, max_reservas_semana, max_reservas_dia, anticipacion_dias)
       VALUES (1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         max_reservas_semana = VALUES(max_reservas_semana),
         max_reservas_dia = VALUES(max_reservas_dia),
         anticipacion_dias = VALUES(anticipacion_dias)`,
      [
        datos.maxReservasSemana,
        datos.maxReservasDia,
        datos.anticipacionDias,
      ],
    );

    await registrarAuditoria(conn, {
      usuarioId: actorId,
      accion: 'parametros.actualizar',
      entidad: 'PARAMETRO_RESERVA',
      entidadId: '1',
      detalle: datos,
    });
  });
}

export const parametrosRoutes = Router();

const soloAdmin = requireRole('ADMINISTRADOR');

function actorId(req: Request): string {
  return req.usuario!.id;
}

function valoresRecibidos(cuerpo: Record<string, unknown>): Record<string, string> {
  return {
    maxReservasSemana: String(cuerpo.maxReservasSemana ?? ''),
    maxReservasDia: String(cuerpo.maxReservasDia ?? ''),
    anticipacionDias: String(cuerpo.anticipacionDias ?? ''),
  };
}

parametrosRoutes.get('/parametros', soloAdmin, async (_req, res) => {
  const parametros = await obtenerParametros();
  res.render('admin/parametros', {
    titulo: 'Parametros de reserva',
    valores: parametros,
    error: null,
  });
});

parametrosRoutes.post('/parametros', soloAdmin, async (req, res) => {
  try {
    await actualizarParametros(
      req.body as unknown as Parametros,
      actorId(req),
    );
    req.flash('exito', 'Parametros actualizados.');
    res.redirect('/admin/parametros');
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).render('admin/parametros', {
        titulo: 'Parametros de reserva',
        valores: valoresRecibidos(req.body),
        error: error.message,
      });
      return;
    }
    throw error;
  }
});
