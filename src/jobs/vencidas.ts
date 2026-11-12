import type { ResultSetHeader } from 'mysql2/promise';
import { pool } from '../db/pool';

// Marca CONFIRMADA -> VENCIDA cuando TIMESTAMP(fecha, hora_fin) ya paso
// (diseno 9.6). fecha/hora son hora local de Bogota, asi que el reloj
// inyectado se compara contra la pared de Bogota, no contra UTC.
export function fechaHoraBogota(ahora: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ahora);
  const valor = (tipo: string): string =>
    partes.find((p) => p.type === tipo)?.value ?? '00';
  return `${valor('year')}-${valor('month')}-${valor('day')} ${valor('hour')}:${valor('minute')}:${valor('second')}`;
}

// El guardado por estado hace el job idempotente: una fila ya VENCIDA nunca
// vuelve a contar. No toca OCUPACION_BLOQUE: el bloque ocurrio y sus cupos
// quedan como registro historico de uso.
export async function marcarVencidas(ahora: Date = new Date()): Promise<number> {
  const [resultado] = await pool.query<ResultSetHeader>(
    `UPDATE RESERVA
     SET estado = 'VENCIDA'
     WHERE estado = 'CONFIRMADA' AND TIMESTAMP(fecha, hora_fin) < ?`,
    [fechaHoraBogota(ahora)],
  );
  return resultado.affectedRows;
}
