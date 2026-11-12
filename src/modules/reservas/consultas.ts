import { query } from '../../db/pool';
import type { EstadoReserva, Reserva } from './service';

// Reserva enriquecida con los datos de identificacion del apartamento y la
// zona, para las listas de supervision del administrador.
export type ReservaConApartamento = Reserva & {
  torreInterior: string;
  numero: string;
  zonaNombre: string;
};

export type FiltrosReservas = {
  desde?: string;
  hasta?: string;
  zonaId?: string;
  estado?: EstadoReserva;
};

type FilaReserva = {
  id: string;
  apartamento_id: string | null;
  zona_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  cupos: number;
  estado: EstadoReserva;
  creada_en: string;
};

type FilaConApartamento = FilaReserva & {
  torre_interior: string;
  numero: string;
  zona_nombre: string;
};

type FilaConZona = FilaReserva & { zona_nombre: string };

// Columnas con formato fijo en SQL: fecha y horas como texto AAAA-MM-DD /
// HH:MM y creada_en como ISO con sufijo Z (UTC), igual que en la reserva.
// Calificadas con el alias `r` de RESERVA, compartido por las dos consultas.
const COLUMNAS = `
  r.id, r.apartamento_id, r.zona_id,
  DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha,
  TIME_FORMAT(r.hora_inicio, '%H:%i') AS hora_inicio,
  TIME_FORMAT(r.hora_fin, '%H:%i') AS hora_fin,
  r.cupos, r.estado,
  CONCAT(DATE_FORMAT(r.creada_en, '%Y-%m-%dT%H:%i:%s.%f'), 'Z') AS creada_en`;

function aReserva(fila: FilaReserva): Reserva {
  return {
    id: fila.id,
    apartamentoId: String(fila.apartamento_id),
    zonaId: fila.zona_id,
    fecha: fila.fecha,
    horaInicio: fila.hora_inicio,
    horaFin: fila.hora_fin,
    cupos: Number(fila.cupos),
    estado: fila.estado,
    creadaEn: fila.creada_en,
  };
}

// Historial completo del apartamento (incluye canceladas y vencidas), en
// orden descendente por fecha y hora: lo mas reciente primero. Se devuelve
// tambien el nombre de la zona porque la vista del residente lo lista.
export async function historialDe(
  apartamentoId: string,
): Promise<(Reserva & { zonaNombre: string })[]> {
  const filas = await query<FilaConZona>(
    `SELECT ${COLUMNAS}, z.nombre AS zona_nombre
     FROM RESERVA r
     JOIN ZONA z ON z.id = r.zona_id
     WHERE r.apartamento_id = ?
     ORDER BY r.fecha DESC, r.hora_inicio DESC`,
    [apartamentoId],
  );
  return filas.map((fila) => ({ ...aReserva(fila), zonaNombre: fila.zona_nombre }));
}

function ahoraBogota(): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());
  const valor = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((p) => p.type === tipo)!.value;
  return `${valor('year')}-${valor('month')}-${valor('day')} ${valor('hour')}:${valor('minute')}`;
}

// Division proximas/historicas: es proxima una reserva CONFIRMADA cuyo bloque
// (fecha + hora_fin) aun no termino. Lo demas —canceladas, vencidas y
// confirmadas pasadas— va al historial. Cadena "AAAA-MM-DD HH:MM" comparable
// lexicograficamente, same convencion que la ventana de anticipacion.
export function dividirHistorial(reservas: Reserva[]): {
  proximas: Reserva[];
  pasadas: Reserva[];
} {
  const ahora = ahoraBogota();
  const proximas: Reserva[] = [];
  const pasadas: Reserva[] = [];
  for (const reserva of reservas) {
    const esFutura =
      reserva.estado === 'CONFIRMADA' &&
      `${reserva.fecha} ${reserva.horaFin}` >= ahora;
    (esFutura ? proximas : pasadas).push(reserva);
  }
  proximas.reverse();
  return { proximas, pasadas };
}

export type ZonaParaFiltro = { id: string; nombre: string };

export async function listarZonasParaFiltro(): Promise<ZonaParaFiltro[]> {
  const filas = await query<ZonaParaFiltro>(
    `SELECT id, nombre FROM ZONA ORDER BY nombre`,
  );
  return filas;
}

// Supervision del administrador: todas las reservas con su apartamento,
// con filtros opcionales. Los predicados se acumulan como fragmentos fijos
// con marcadores `?`; los valores del usuario jamas se concatenan al SQL.
export async function listarReservas(
  filtros: FiltrosReservas,
): Promise<ReservaConApartamento[]> {
  const predicados: string[] = [];
  const params: unknown[] = [];

  if (filtros.desde) {
    predicados.push('r.fecha >= ?');
    params.push(filtros.desde);
  }
  if (filtros.hasta) {
    predicados.push('r.fecha <= ?');
    params.push(filtros.hasta);
  }
  if (filtros.zonaId) {
    predicados.push('r.zona_id = ?');
    params.push(filtros.zonaId);
  }
  if (filtros.estado) {
    predicados.push('r.estado = ?');
    params.push(filtros.estado);
  }

  const where = predicados.length > 0 ? `WHERE ${predicados.join(' AND ')}` : '';

  const filas = await query<FilaConApartamento>(
    `SELECT ${COLUMNAS},
            a.torre_interior, a.numero, z.nombre AS zona_nombre
     FROM RESERVA r
     JOIN APARTAMENTO a ON a.id = r.apartamento_id
     JOIN ZONA z ON z.id = r.zona_id
     ${where}
     ORDER BY r.fecha DESC, r.hora_inicio DESC`,
    params,
  );

  return filas.map((fila) => ({
    ...aReserva(fila),
    torreInterior: fila.torre_interior,
    numero: fila.numero,
    zonaNombre: fila.zona_nombre,
  }));
}
