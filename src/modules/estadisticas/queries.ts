import { query } from '../../db/pool';

// Estadisticas de RF-31..RF-35: solo agregados. Ninguna consulta toca
// USUARIO ni APARTAMENTO; la salida jamas identifica residentes (RF-35).
// Regla de negocio: lo "no cancelado" (CONFIRMADA + VENCIDA) cuenta como
// uso. Una reserva VENCIDA ocupo el bloque: nunca es cancelacion.

export type OcupacionFila = {
  zona: string;
  fecha: string;
  horaInicio: string;
  cupos: number;
  aforo: number;
};

export type HoraPicoFila = {
  hora: number;
  diaSemana: number;
  reservas: number;
};

export type CancelacionesFila = {
  zona: string;
  // Uso en el rango: CONFIRMADA + VENCIDA. Es el denominador junto con
  // canceladas; se lama "confirmadas" por la interfaz del brief, pero
  // incluye tambien las vencidas.
  confirmadas: number;
  canceladas: number;
  // Porcentaje de cancelacion sobre (uso + canceladas), 1 decimal.
  // Con grupos vacios no se divide: el porcentaje solo existe si el
  // grupo tiene al menos una reserva, y aun asi se protege con 0.
  porcentaje: number;
};

// diaSemana: 1 = lunes ... 7 = domingo, la convencion de HORARIO_ZONA.
// WEEKDAY() da 0..6 con lunes=0; +1 alinea.

function condicionesRango(
  desde: string,
  hasta: string,
  zonaId: string | undefined,
  alias: string,
): { where: string; params: unknown[] } {
  const params: unknown[] = [desde, hasta];
  let where = `${alias}.fecha >= ? AND ${alias}.fecha <= ?`;
  if (zonaId) {
    where += ` AND ${alias}.zona_id = ?`;
    params.push(zonaId);
  }
  return { where, params };
}

// Ocupacion por bloque: SUM(cupos) de todo lo no cancelado por
// (zona, fecha, hora_inicio), junto con el aforo VIGENTE de la zona.
// No hay snapshot historico del aforo: el porcentaje que se derive de
// esto debe presentarse como "contra aforo actual".
export async function ocupacionPorBloque(
  desde: string,
  hasta: string,
  zonaId?: string,
): Promise<OcupacionFila[]> {
  const { where, params } = condicionesRango(desde, hasta, zonaId, 'r');
  const filas = await query<{
    zona: string;
    fecha: string;
    horaInicio: string;
    cupos: number;
    aforo: number;
  }>(
    `SELECT z.nombre AS zona,
            DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha,
            TIME_FORMAT(r.hora_inicio, '%H:%i') AS horaInicio,
            SUM(r.cupos) AS cupos,
            z.aforo
     FROM RESERVA r
     JOIN ZONA z ON z.id = r.zona_id
     WHERE ${where} AND r.estado IN ('CONFIRMADA', 'VENCIDA')
     GROUP BY r.zona_id, r.fecha, r.hora_inicio, z.nombre, z.aforo
     ORDER BY r.fecha, r.hora_inicio, z.nombre`,
    params,
  );
  return filas.map((f) => ({
    zona: f.zona,
    fecha: f.fecha,
    horaInicio: f.horaInicio,
    cupos: Number(f.cupos),
    aforo: Number(f.aforo),
  }));
}

// Horas pico: numero de RESERVAS (no cupos) no canceladas, agrupado por
// hora de inicio y dia de la semana, ordenado de mayor a menor uso.
export async function horasPico(
  desde: string,
  hasta: string,
  zonaId?: string,
): Promise<HoraPicoFila[]> {
  const { where, params } = condicionesRango(desde, hasta, zonaId, 'r');
  const filas = await query<{
    hora: number;
    diaSemana: number;
    reservas: number;
  }>(
    `SELECT HOUR(r.hora_inicio) AS hora,
            WEEKDAY(r.fecha) + 1 AS diaSemana,
            COUNT(*) AS reservas
     FROM RESERVA r
     WHERE ${where} AND r.estado IN ('CONFIRMADA', 'VENCIDA')
     GROUP BY HOUR(r.hora_inicio), WEEKDAY(r.fecha) + 1
     ORDER BY reservas DESC, diaSemana, hora`,
    params,
  );
  return filas.map((f) => ({
    hora: Number(f.hora),
    diaSemana: Number(f.diaSemana),
    reservas: Number(f.reservas),
  }));
}

// Cancelaciones por zona: una reserva vencida cuenta como uso, no como
// cancelacion; por eso el numerador es solo CANCELADA y el denominador
// es (CONFIRMADA + VENCIDA) + CANCELADA. Sin reservas en el rango la
// lista queda vacia; dentro de un grupo el denominador es >= 1 por
// construccion, y aun asi se protege la division con un ternario.
export async function cancelacionesPorZona(
  desde: string,
  hasta: string,
  zonaId?: string,
): Promise<CancelacionesFila[]> {
  const { where, params } = condicionesRango(desde, hasta, zonaId, 'r');
  const filas = await query<{
    zona: string;
    uso: number;
    canceladas: number;
  }>(
    `SELECT z.nombre AS zona,
            SUM(r.estado IN ('CONFIRMADA', 'VENCIDA')) AS uso,
            SUM(r.estado = 'CANCELADA') AS canceladas
     FROM RESERVA r
     JOIN ZONA z ON z.id = r.zona_id
     WHERE ${where}
     GROUP BY r.zona_id, z.nombre
     ORDER BY z.nombre`,
    params,
  );
  return filas.map((f) => {
    const uso = Number(f.uso);
    const canceladas = Number(f.canceladas);
    const total = uso + canceladas;
    return {
      zona: f.zona,
      confirmadas: uso,
      canceladas,
      porcentaje: total > 0 ? Math.round((canceladas * 1000) / total) / 10 : 0,
    };
  });
}
