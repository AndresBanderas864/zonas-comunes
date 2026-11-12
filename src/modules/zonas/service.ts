import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withTransaction } from '../../db/pool';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { registrarAuditoria } from '../auditoria/service';
import {
  actualizarZona as repoActualizarZona,
  borrarHorariosDeZona,
  insertarHorario,
  insertarZona,
  listarHorariosFilas,
  listarZonasFilas,
  obtenerZonaFila,
} from './repository';

export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type HorarioZona = {
  diaSemana: DiaSemana;
  apertura: string;
  cierre: string;
};

export type Zona = {
  id: string;
  nombre: string;
  aforo: number;
  duracionBloqueMin: number;
  maxCuposReserva: number;
  activa: boolean;
  horarios: HorarioZona[];
};

export type ZonaInput = {
  nombre: string;
  aforo: number;
  duracionBloqueMin: number;
  maxCuposReserva: number;
  activa: boolean;
  horarios: HorarioZona[];
};

const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const esquemaHorario = z.object({
  diaSemana: z.coerce
    .number()
    .int('El dia de semana debe ser entero')
    .refine(
      (valor) => valor >= 1 && valor <= 7,
      'El dia de semana debe estar entre 1 y 7',
    )
    .transform((valor) => valor as DiaSemana),
  apertura: z.string().trim().regex(PATRON_HORA, 'Hora de apertura invalida'),
  cierre: z.string().trim().regex(PATRON_HORA, 'Hora de cierre invalida'),
});

const coerceBooleano = z.preprocess((valor) => {
  if (valor === undefined || valor === null) return false;
  if (typeof valor === 'string') {
    const texto = valor.trim().toLowerCase();
    return !(texto === '' || texto === '0' || texto === 'false');
  }
  return Boolean(valor);
}, z.boolean());

const esquemaZonaInput = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(80),
  aforo: z.coerce.number().int().min(1, 'El aforo debe ser mayor que cero'),
  duracionBloqueMin: z.coerce
    .number()
    .int()
    .min(1, 'La duracion del bloque debe ser mayor que cero'),
  maxCuposReserva: z.coerce
    .number()
    .int()
    .min(1, 'Los cupos maximos deben ser mayores que cero'),
  activa: coerceBooleano,
  horarios: z.array(esquemaHorario).max(7, 'Maximo un horario por dia'),
});

function aMinutos(hora: string): number {
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
}

function esDuplicado(error: unknown): boolean {
  return (error as { code?: string }).code === 'ER_DUP_ENTRY';
}

export function validarHorario(
  apertura: string,
  cierre: string,
  duracionMin: number,
): void {
  const inicio = aMinutos(apertura);
  const fin = aMinutos(cierre);

  if (fin <= inicio) {
    throw new ValidationError('El cierre debe ser posterior a la apertura');
  }
  if ((fin - inicio) % duracionMin !== 0) {
    throw new ValidationError(
      'El horario debe cubrir un multiplo exacto de la duracion del bloque',
    );
  }
}

function validarZonaInput(entrada: unknown): ZonaInput {
  const resultado = esquemaZonaInput.safeParse(entrada);
  if (!resultado.success) {
    throw new ValidationError(resultado.error.issues[0].message);
  }

  const datos = resultado.data;

  if (datos.maxCuposReserva > datos.aforo) {
    throw new ValidationError(
      'Los cupos maximos por reserva no pueden superar el aforo',
    );
  }

  const dias = new Set<number>();
  for (const horario of datos.horarios) {
    if (dias.has(horario.diaSemana)) {
      throw new ValidationError('No se permiten dias de horario duplicados');
    }
    dias.add(horario.diaSemana);
    validarHorario(horario.apertura, horario.cierre, datos.duracionBloqueMin);
  }

  return datos;
}

function formatearHora(hora: string): string {
  const [horas, minutos] = hora.split(':');
  return `${horas!.padStart(2, '0')}:${minutos!.padStart(2, '0')}`;
}

export async function listarZonas(): Promise<Zona[]> {
  const zonas = await listarZonasFilas();
  const horarios = await listarHorariosFilas(zonas.map((zona) => zona.id));

  const porZona = new Map<string, HorarioZona[]>();
  for (const horario of horarios) {
    const lista = porZona.get(horario.zona_id) ?? [];
    lista.push({
      diaSemana: horario.dia_semana as DiaSemana,
      apertura: formatearHora(horario.apertura),
      cierre: formatearHora(horario.cierre),
    });
    porZona.set(horario.zona_id, lista);
  }

  return zonas.map((zona) => ({
    id: zona.id,
    nombre: zona.nombre,
    aforo: Number(zona.aforo),
    duracionBloqueMin: Number(zona.duracion_bloque_min),
    maxCuposReserva: Number(zona.max_cupos_reserva),
    activa: Number(zona.activa) === 1,
    horarios: porZona.get(zona.id) ?? [],
  }));
}

export async function obtenerZona(id: string): Promise<Zona | null> {
  const todas = await listarZonas();
  return todas.find((zona) => zona.id === id) ?? null;
}

export async function crearZona(
  input: ZonaInput,
  actorId: string,
): Promise<Zona> {
  const datos = validarZonaInput(input);
  const zonaId = randomUUID();

  await withTransaction(async (conn) => {
    try {
      await insertarZona(conn, {
        id: zonaId,
        nombre: datos.nombre,
        aforo: datos.aforo,
        duracionBloqueMin: datos.duracionBloqueMin,
        maxCuposReserva: datos.maxCuposReserva,
        activa: datos.activa,
      });
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictError('Ya existe una zona con ese nombre');
      }
      throw error;
    }

    for (const horario of datos.horarios) {
      await insertarHorario(conn, {
        id: randomUUID(),
        zonaId,
        diaSemana: horario.diaSemana,
        apertura: horario.apertura,
        cierre: horario.cierre,
      });
    }

    await registrarAuditoria(conn, {
      usuarioId: actorId,
      accion: 'zona.crear',
      entidad: 'ZONA',
      entidadId: zonaId,
      detalle: { nombre: datos.nombre, activa: datos.activa },
    });
  });

  return { id: zonaId, ...datos };
}

export async function actualizarZona(
  id: string,
  input: ZonaInput,
  actorId: string,
): Promise<Zona> {
  const datos = validarZonaInput(input);

  await withTransaction(async (conn) => {
    const existente = await obtenerZonaFila(conn, id);
    if (!existente) {
      throw new NotFoundError('La zona no existe');
    }

    try {
      await repoActualizarZona(conn, {
        id,
        nombre: datos.nombre,
        aforo: datos.aforo,
        duracionBloqueMin: datos.duracionBloqueMin,
        maxCuposReserva: datos.maxCuposReserva,
        activa: datos.activa,
      });
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictError('Ya existe una zona con ese nombre');
      }
      throw error;
    }

    await borrarHorariosDeZona(conn, id);
    for (const horario of datos.horarios) {
      await insertarHorario(conn, {
        id: randomUUID(),
        zonaId: id,
        diaSemana: horario.diaSemana,
        apertura: horario.apertura,
        cierre: horario.cierre,
      });
    }

    await registrarAuditoria(conn, {
      usuarioId: actorId,
      accion: 'zona.actualizar',
      entidad: 'ZONA',
      entidadId: id,
      detalle: { nombre: datos.nombre, activa: datos.activa },
    });
  });

  return { id, ...datos };
}
