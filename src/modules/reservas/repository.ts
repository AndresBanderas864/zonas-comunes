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
