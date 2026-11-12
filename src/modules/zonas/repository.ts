import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { query } from '../../db/pool';

export type ZonaFila = {
  id: string;
  nombre: string;
  aforo: number;
  duracion_bloque_min: number;
  max_cupos_reserva: number;
  activa: number;
};

export type HorarioFila = {
  id: string;
  zona_id: string;
  dia_semana: number;
  apertura: string;
  cierre: string;
};

export type DatosZona = {
  id: string;
  nombre: string;
  aforo: number;
  duracionBloqueMin: number;
  maxCuposReserva: number;
  activa: boolean;
};

export type DatosHorario = {
  id: string;
  zonaId: string;
  diaSemana: number;
  apertura: string;
  cierre: string;
};

export async function listarZonasFilas(): Promise<ZonaFila[]> {
  return query<ZonaFila>(
    `SELECT id, nombre, aforo, duracion_bloque_min, max_cupos_reserva, activa
     FROM ZONA ORDER BY nombre`,
  );
}

export async function listarHorariosFilas(
  zonaIds: string[],
): Promise<HorarioFila[]> {
  if (zonaIds.length === 0) return [];
  const marcadores = zonaIds.map(() => '?').join(', ');
  return query<HorarioFila>(
    `SELECT id, zona_id, dia_semana, apertura, cierre
     FROM HORARIO_ZONA WHERE zona_id IN (${marcadores})
     ORDER BY zona_id, dia_semana`,
    zonaIds,
  );
}

export async function obtenerZonaFila(
  conn: PoolConnection,
  id: string,
): Promise<ZonaFila | null> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT id, nombre, aforo, duracion_bloque_min, max_cupos_reserva, activa
     FROM ZONA WHERE id = ? FOR UPDATE`,
    [id],
  );
  return (filas[0] as ZonaFila | undefined) ?? null;
}

export async function insertarZona(
  conn: PoolConnection,
  datos: DatosZona,
): Promise<void> {
  await conn.query<ResultSetHeader>(
    `INSERT INTO ZONA (id, nombre, aforo, duracion_bloque_min, max_cupos_reserva, activa)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      datos.id,
      datos.nombre,
      datos.aforo,
      datos.duracionBloqueMin,
      datos.maxCuposReserva,
      datos.activa ? 1 : 0,
    ],
  );
}

export async function actualizarZona(
  conn: PoolConnection,
  datos: DatosZona,
): Promise<void> {
  await conn.query<ResultSetHeader>(
    `UPDATE ZONA
     SET nombre = ?, aforo = ?, duracion_bloque_min = ?, max_cupos_reserva = ?, activa = ?
     WHERE id = ?`,
    [
      datos.nombre,
      datos.aforo,
      datos.duracionBloqueMin,
      datos.maxCuposReserva,
      datos.activa ? 1 : 0,
      datos.id,
    ],
  );
}

export async function borrarHorariosDeZona(
  conn: PoolConnection,
  zonaId: string,
): Promise<void> {
  await conn.query('DELETE FROM HORARIO_ZONA WHERE zona_id = ?', [zonaId]);
}

export async function insertarHorario(
  conn: PoolConnection,
  datos: DatosHorario,
): Promise<void> {
  await conn.query<ResultSetHeader>(
    `INSERT INTO HORARIO_ZONA (id, zona_id, dia_semana, apertura, cierre)
     VALUES (?, ?, ?, ?, ?)`,
    [datos.id, datos.zonaId, datos.diaSemana, datos.apertura, datos.cierre],
  );
}
