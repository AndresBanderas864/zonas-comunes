import cron from 'node-cron';
import { crearRecordatorios } from './recordatorios';
import { limpiarBitacoraAntigua, limpiarSesionesExpiradas } from './limpieza';
import { marcarVencidas } from './vencidas';

// Registro central de los jobs programados. Nunca se invoca con
// NODE_ENV=test: los tests importan las funciones y les inyectan el reloj.
export function registrarJobs(): void {
  if (process.env.NODE_ENV === 'test') return;

  const ejecutar = (nombre: string, fn: () => Promise<number>) => {
    fn().then(
      (afectadas) => console.info(`[jobs] ${nombre}: ${afectadas} filas`),
      (error: unknown) => console.error(`[jobs] ${nombre} fallo`, error),
    );
  };

  cron.schedule(
    '*/15 * * * *',
    () => ejecutar('marcarVencidas', marcarVencidas),
    { noOverlap: true },
  );
  cron.schedule(
    '*/5 * * * *',
    () => ejecutar('crearRecordatorios', crearRecordatorios),
    { noOverlap: true },
  );
  // Limpieza diaria a las 03:00 hora de Bogota: sesiones primero, bitacora despues.
  cron.schedule('0 3 * * *', () => {
    const total = Promise.all([
      limpiarSesionesExpiradas(),
      limpiarBitacoraAntigua(),
    ]).then(([sesiones, bitacora]) => sesiones + bitacora);
    void total
      .then((afectadas) => console.info(`[jobs] limpieza: ${afectadas} filas`))
      .catch((error: unknown) => console.error('[jobs] limpieza fallo', error));
  }, { timezone: 'America/Bogota' });
}
