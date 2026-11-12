import { describe, expect, it } from 'vitest';
import { query } from '../src/db/pool';
import {
  crearUsuarioConApartamento,
  crearZonaConAforo,
  fijarContextoReserva,
  mananaBogota,
  postReserva,
} from './helpers/fixtures';

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
