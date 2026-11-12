import { query } from '../../db/pool';

export type ZonaActiva = {
  id: string;
  nombre: string;
  aforo: number;
  duracionBloqueMin: number;
};

type ZonaFila = {
  id: string;
  nombre: string;
  aforo: number;
  duracion_bloque_min: number;
};

function aZonaActiva(fila: ZonaFila): ZonaActiva {
  return {
    id: fila.id,
    nombre: fila.nombre,
    aforo: Number(fila.aforo),
    duracionBloqueMin: Number(fila.duracion_bloque_min),
  };
}

export async function obtenerZonaActiva(
  zonaId: string,
): Promise<ZonaActiva | null> {
  const filas = await query<ZonaFila>(
    `SELECT id, nombre, aforo, duracion_bloque_min
     FROM ZONA WHERE id = ? AND activa = 1`,
    [zonaId],
  );
  const fila = filas[0];
  return fila ? aZonaActiva(fila) : null;
}

export async function listarZonasActivas(): Promise<ZonaActiva[]> {
  const filas = await query<ZonaFila>(
    `SELECT id, nombre, aforo, duracion_bloque_min
     FROM ZONA WHERE activa = 1 ORDER BY nombre`,
  );
  return filas.map(aZonaActiva);
}

export type ReservaEnLista = {
  id: string;
  zonaNombre: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupos: number;
  estado: string;
};

type ReservaListaFila = {
  id: string;
  zona_nombre: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  cupos: number;
  estado: string;
};

export async function listarReservasNoCanceladas(
  apartamentoId: string,
): Promise<ReservaEnLista[]> {
  const filas = await query<ReservaListaFila>(
    `SELECT r.id, z.nombre AS zona_nombre,
            DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha,
            TIME_FORMAT(r.hora_inicio, '%H:%i') AS hora_inicio,
            TIME_FORMAT(r.hora_fin, '%H:%i') AS hora_fin,
            r.cupos, r.estado
     FROM RESERVA r
     JOIN ZONA z ON z.id = r.zona_id
     WHERE r.apartamento_id = ? AND r.estado <> 'CANCELADA'
     ORDER BY r.fecha, r.hora_inicio`,
    [apartamentoId],
  );
  return filas.map((fila) => ({
    id: fila.id,
    zonaNombre: fila.zona_nombre,
    fecha: fila.fecha,
    horaInicio: fila.hora_inicio,
    horaFin: fila.hora_fin,
    cupos: Number(fila.cupos),
    estado: fila.estado,
  }));
}
