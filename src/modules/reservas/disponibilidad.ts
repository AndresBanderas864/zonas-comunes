import { query } from '../../db/pool';
import {
  obtenerZonaActiva as repoObtenerZonaActiva,
  listarZonasActivas as repoListarZonasActivas,
  type ZonaActiva,
} from './repository';
import { generarBloques } from './bloques';

export type { ZonaActiva };

export function obtenerZonaActiva(zonaId: string): Promise<ZonaActiva | null> {
  return repoObtenerZonaActiva(zonaId);
}

export function listarZonasActivas(): Promise<ZonaActiva[]> {
  return repoListarZonasActivas();
}

export type BloqueDisponible = {
  horaInicio: string;
  horaFin: string;
  aforo: number;
  cuposDisponibles: number;
};

type HorarioFila = {
  aforo: number;
  duracion_bloque_min: number;
  apertura: string;
  cierre: string;
};

type OcupacionFila = {
  hora_inicio: string;
  cupos_ocupados: number;
};

// dia_semana: 1 = lunes ... 7 = domingo, segun la convencion de HORARIO_ZONA.
// Un dia inexistente en su mes (2026-11-31, 2026-02-30) cuenta como 0: sin
// esa comprobacion, Date.UTC lo rodaba al dia siguiente y devolvia el dia de
// la semana equivocado (disponibilidad fantasma).
export function diaSemanaDeFecha(fecha: string): number {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  if (
    !Number.isInteger(anio) ||
    !Number.isInteger(mes) ||
    !Number.isInteger(dia) ||
    mes < 1 ||
    mes > 12 ||
    dia < 1
  ) {
    return 0;
  }
  const ultimoDia = new Date(Date.UTC(anio!, mes, 0)).getUTCDate();
  if (dia > ultimoDia) {
    return 0;
  }
  const js = new Date(Date.UTC(anio!, mes! - 1, dia!)).getUTCDay();
  return js === 0 ? 7 : js;
}

function normalizarHora(hora: string): string {
  return String(hora).slice(0, 5);
}

export async function obtenerDisponibilidad(
  zonaId: string,
  fecha: string,
): Promise<BloqueDisponible[]> {
  const dia = diaSemanaDeFecha(fecha);
  if (dia === 0) return [];

  const horarios = await query<HorarioFila>(
    `SELECT z.aforo, z.duracion_bloque_min, h.apertura, h.cierre
     FROM HORARIO_ZONA h
     JOIN ZONA z ON z.id = h.zona_id
     WHERE h.zona_id = ? AND h.dia_semana = ?`,
    [zonaId, dia],
  );

  const horario = horarios[0];
  if (!horario) return [];

  const ocupaciones = await query<OcupacionFila>(
    `SELECT hora_inicio, cupos_ocupados
     FROM OCUPACION_BLOQUE
     WHERE zona_id = ? AND fecha = ?`,
    [zonaId, fecha],
  );

  const ocupadosPorBloque = new Map<string, number>(
    ocupaciones.map((fila) => [normalizarHora(fila.hora_inicio), Number(fila.cupos_ocupados)]),
  );

  const aforo = Number(horario.aforo);

  return generarBloques(
    normalizarHora(horario.apertura),
    normalizarHora(horario.cierre),
    Number(horario.duracion_bloque_min),
  ).map((bloque) => ({
    ...bloque,
    aforo,
    cuposDisponibles: aforo - (ocupadosPorBloque.get(bloque.horaInicio) ?? 0),
  }));
}

export async function listarBloquesDisponibles(
  zonaId: string,
  fecha: string,
): Promise<BloqueDisponible[]> {
  const bloques = await obtenerDisponibilidad(zonaId, fecha);
  return bloques.filter((bloque) => bloque.cuposDisponibles > 0);
}
