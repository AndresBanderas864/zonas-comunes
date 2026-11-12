import type { ResultSetHeader } from 'mysql2/promise';
import { pool } from '../db/pool';

// Sesiones y bitacora llevan marcas DATETIME(3) en UTC escritas con
// UTC_TIMESTAMP(3) explicito (el servidor ahora corre con TZ=America/Bogota,
// asi que NOW() ya no es UTC), por lo que aqui la pared es UTC, no Bogota.
// Los milisegundos van padding de 3 digitos: Date.getMilliseconds() los
// devuelve sin ceros iniciales (5 -> '5' que MariaDB lee como 500 ms).
function fechaHoraUtc(ahora: Date): string {
  const ms = String(ahora.getMilliseconds()).padStart(3, '0');
  return `${ahora.toISOString().slice(0, 19).replace('T', ' ')}.${ms}`;
}

// Retencion de sesion: validarSesion acepta 30 dias de inactividad; el job
// borra a los 31 para que la fila muerta no sobreviva a su propio criterio.
export async function limpiarSesionesExpiradas(
  ahora: Date = new Date(),
): Promise<number> {
  const [resultado] = await pool.query<ResultSetHeader>(
    `DELETE FROM SESION WHERE ultimo_uso < DATE_SUB(?, INTERVAL 31 DAY)`,
    [fechaHoraUtc(ahora)],
  );
  return resultado.affectedRows;
}

// Retencion BITACORA: 12 meses (diseno, tabla de indices/retencion).
export async function limpiarBitacoraAntigua(
  ahora: Date = new Date(),
): Promise<number> {
  const [resultado] = await pool.query<ResultSetHeader>(
    `DELETE FROM BITACORA WHERE creada_en < DATE_SUB(?, INTERVAL 12 MONTH)`,
    [fechaHoraUtc(ahora)],
  );
  return resultado.affectedRows;
}
