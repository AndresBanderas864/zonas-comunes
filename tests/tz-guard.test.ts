import { expect, it } from 'vitest';
import { query } from '../src/db/pool';
import { crearSesion } from '../src/modules/auth/sessions';
import { crearUsuarioConApartamento } from './helpers/fixtures';

// Guardia de zona horaria del contenedor de prueba. El suite entero asume
// la convencion de Task 18b: NOW(3) en el servidor NO es UTC (compose fija
// TZ=America/Bogota) y toda marca de sistema se escribe con UTC_TIMESTAMP(3).
// Si alguien corre la base de prueba en UTC, NOW(3) == UTC_TIMESTAMP(3) y un
// regression de estampo pasa desapercibido: esta prueba lo hace visible.

it('la base de pruebas corre en Bogota y el estampo UTC de SESION es distinguishable', async (ctx) => {
  const [zona] = await query<{ diff: number }>(
    'SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), NOW(3)) AS diff',
  );
  const diff = Number(zona.diff);
  if (diff === 0) {
    console.info(
      '[tz-guard] base de pruebas en UTC (NOW==UTC): guardia en skip; ' +
        'corre contra el mariadb de docker-compose (TZ=America/Bogota) para ejercitarla',
    );
    ctx.skip();
  }

  // Bogota es UTC-5 sin DST: NOW(3) va 5 h DETRAS del UTC real, o sea
  // TIMESTAMPDIFF(SEGUNDOS, UTC, NOW) = NOW - UTC = -18000.
  expect(diff).toBe(-18000);

  const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
  const { sesionId } = await crearSesion(usuario.id);

  // El estampo que escribe crearSesion es UTC_TIMESTAMP(3) (convencion UTC
  // de la app), mientras el reloj local del servidor va 5 h atras. Dos
  // comparaciones SQL sobre el mismo valor, una con NOW(3) y otra con
  // UTC_TIMESTAMP(3), DEBEN desmentirse: si alguien regresa el writer a
  // NOW(3) el estampo envejece con el reloj local y ambas coinciden, y esta
  // prueba lo captura. Solo SQL de test: no se toca ninguna query de
  // produccion.
  const [selo] = await query<{
    skew_contra_utc: number;
    discrepancia: number;
  }>(
    `SELECT TIMESTAMPDIFF(SECOND, s.ultimo_uso, UTC_TIMESTAMP(3)) AS skew_contra_utc,
            ((s.ultimo_uso > NOW(3)) <> (s.ultimo_uso > UTC_TIMESTAMP(3))) AS discrepancia
     FROM SESION s
     WHERE s.id = ?`,
    [sesionId],
  );

  // Recien escrito por la app: el estampo esta a menos de 5 minutos del
  // reloj UTC de la base (y NO del NOW(3) local, que marcaba ~5 h antes).
  expect(Math.abs(Number(selo.skew_contra_utc))).toBeLessThan(300);
  // NOW(3) dice que el estampo es del futuro; UTC_TIMESTAMP(3) no: disienten.
  expect(Number(selo.discrepancia)).toBe(1);
});
