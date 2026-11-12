import { describe, expect, it } from 'vitest';
import { query } from '../src/db/pool';
import {
  crearUsuarioConApartamento,
  crearZonaConAforo,
  fijarContextoReserva,
  mananaBogota,
  postReserva,
} from './helpers/fixtures';

async function fijarMaxDia(n: number): Promise<void> {
  // Sembrar la fila para que obtenerParametros (INSERT IGNORE) no la cree con
  // los defectos (7,3,7); el limite diario se fija antes de disparar los POST.
  await query(
    `INSERT INTO PARAMETRO_RESERVA (id, max_reservas_semana, max_reservas_dia, anticipacion_dias)
     VALUES (1, 4, ?, 7)
     ON DUPLICATE KEY UPDATE max_reservas_semana = 4, max_reservas_dia = VALUES(max_reservas_dia)`,
    [n],
  );
}

async function contarAptDia(apartamentoId: string, fecha: string): Promise<number> {
  const [fila] = await query<{ n: number }>(
    `SELECT COUNT(*) n FROM RESERVA
     WHERE apartamento_id = ? AND fecha = ? AND estado <> 'CANCELADA'`,
    [apartamentoId, fecha],
  );
  return Number(fila.n);
}


// 20 usuarios en 20 apartamentos distintos: el limite de reservas es por
// apartamento y el duplicado tambien, asi que solo con apartamentos distintos
// el test mide el aforo del bloque y no otra cosa.
it('20 reservas simultaneas de 2 cupos sobre aforo 10: exactamente 5 exitosas', async () => {
  const zona = await crearZonaConAforo(10, 120);
  const fecha = mananaBogota();
  fijarContextoReserva({ zonaId: zona.id, fecha, horaInicio: '10:00' });

  const usuarios = [];
  for (let i = 0; i < 20; i++) {
    usuarios.push(await crearUsuarioConApartamento('RESIDENTE', `1${String(i + 1).padStart(2, '0')}`));
  }

  const inicio = Date.now();
  const respuestas = await Promise.all(
    usuarios.map((usuario) => postReserva(usuario, { cupos: 2 })),
  );
  const duracionMs = Date.now() - inicio;

  const codigos = respuestas.map((res) => res.status);
  console.log(
    `concurrencia 20vias: ${duracionMs} ms · 201=${codigos.filter((c) => c === 201).length} · ` +
      `409=${codigos.filter((c) => c === 409).length} · otros=${codigos.filter((c) => c !== 201 && c !== 409).length} · ` +
      `codigos=${JSON.stringify(codigos)}`,
  );

  expect(respuestas.filter((r) => r.status === 201)).toHaveLength(5);
  expect(respuestas.filter((r) => r.status === 409)).toHaveLength(15);

  const [{ total }] = await query<{ total: number }>(
    'SELECT cupos_ocupados total FROM OCUPACION_BLOQUE WHERE zona_id = ? AND fecha = ? AND hora_inicio = ?',
    [zona.id, fecha, '10:00:00'],
  );
  expect(Number(total)).toBe(10);

  const [{ confirmadas }] = await query<{ confirmadas: number }>(
    "SELECT COUNT(*) confirmadas FROM RESERVA WHERE zona_id = ? AND estado = 'CONFIRMADA'",
    [zona.id],
  );
  expect(Number(confirmadas)).toBe(5);
}, 30_000);

describe('limiten dia/semana por apartamento bajo concurrencia', () => {
  // Mismo apartamento, bloques DISTINTOS del mismo dia: los POST no pelean por
  // la fila de OCUPACION_BLOQUE y, sin un lock por apartamento, leen el mismo
  // snapshot y pueden pasar juntos el limite diario (TOCTOU).

  it('dos POST concurrentes en bloques distintos con max_dia=2: ambos 201', async () => {
    await fijarMaxDia(2);
    const zona = await crearZonaConAforo(20, 120);
    const fecha = mananaBogota();
    fijarContextoReserva({ zonaId: zona.id, fecha, horaInicio: '08:00' });
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '201');

    const respuestas = await Promise.all(
      ['08:00', '10:00'].map((hora) =>
        postReserva(usuario, { zonaId: zona.id, fecha, horaInicio: hora, cupos: 1 }),
      ),
    );
    console.log(`max_dia=2 vs 2: codigos=${JSON.stringify(respuestas.map((r) => r.status))}`);

    expect(respuestas.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await contarAptDia(usuario.apartamentoId!, fecha)).toBe(2);
  }, 30_000);

  it('tres POST concurrentes en bloques distintos con max_dia=2: 2x201 y 1x409, sin exceder 2', async () => {
    await fijarMaxDia(2);
    const zona = await crearZonaConAforo(20, 120);
    const fecha = mananaBogota();
    fijarContextoReserva({ zonaId: zona.id, fecha, horaInicio: '08:00' });
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '202');

    const respuestas = await Promise.all(
      ['08:00', '10:00', '12:00'].map((hora) =>
        postReserva(usuario, { zonaId: zona.id, fecha, horaInicio: hora, cupos: 1 }),
      ),
    );
    const codigos = respuestas.map((r) => r.status);
    console.log(`max_dia=2 vs 3: codigos=${JSON.stringify(codigos)}`);

    expect(respuestas.filter((r) => r.status === 201)).toHaveLength(2);
    expect(respuestas.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await contarAptDia(usuario.apartamentoId!, fecha)).toBeLessThanOrEqual(2);
  }, 30_000);
});
