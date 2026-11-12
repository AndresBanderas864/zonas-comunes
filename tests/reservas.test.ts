import { describe, expect, it } from 'vitest';
import { query } from '../src/db/pool';
import { crearReserva } from '../src/modules/reservas/service';
import {
  crearUsuarioConApartamento,
  crearZonaConAforo,
  fijarContextoReserva,
  hoyBogota,
  mananaBogota,
  postReserva,
  sumarDiasBogota,
} from './helpers/fixtures';

const BLOQUE = '10:00';

async function cuposOcupados(zonaId: string, fecha: string, horaInicio: string): Promise<number> {
  const filas = await query<{ total: number }>(
    `SELECT COALESCE(SUM(cupos_ocupados), 0) total
     FROM OCUPACION_BLOQUE WHERE zona_id = ? AND fecha = ? AND hora_inicio = ?`,
    [zonaId, fecha, horaInicio],
  );
  return Number(filas[0].total);
}

async function contarReservas(zonaId: string): Promise<number> {
  const filas = await query<{ n: number }>(
    "SELECT COUNT(*) n FROM RESERVA WHERE zona_id = ? AND estado <> 'CANCELADA'",
    [zonaId],
  );
  return Number(filas[0].n);
}

describe('crear reserva', () => {
  // Cada test: zona con aforo 10, duracion 120 y manana como fecha reservable.
  const preparar = async () => {
    const zona = await crearZonaConAforo(10, 120);
    const fecha = mananaBogota();
    fijarContextoReserva({ zonaId: zona.id, fecha, horaInicio: BLOQUE });
    return { zona, fecha };
  };

  it('crea la reserva y la deja CONFIRMADA', async () => {
    const { zona, fecha } = await preparar();
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');

    const res = await postReserva(usuario, {
      zonaId: zona.id,
      fecha,
      horaInicio: BLOQUE,
      cupos: 2,
    });

    expect(res.status).toBe(201);
    expect(res.body.reserva).toMatchObject({
      estado: 'CONFIRMADA',
      zonaId: zona.id,
      fecha,
      horaInicio: BLOQUE,
      horaFin: '12:00',
      cupos: 2,
    });

    const [fila] = await query<{ estado: string; hora_fin: string }>(
      'SELECT estado, hora_fin FROM RESERVA WHERE id = ?',
      [res.body.reserva.id],
    );
    expect(fila.estado).toBe('CONFIRMADA');
    expect(String(fila.hora_fin)).toBe('12:00:00');
    expect(await cuposOcupados(zona.id, fecha, BLOQUE)).toBe(2);
  });

  it('devuelve 409 cuando no hay cupo', async () => {
    const { zona, fecha } = await preparar();
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    await query(
      `INSERT INTO OCUPACION_BLOQUE (zona_id, fecha, hora_inicio, cupos_ocupados)
       VALUES (?, ?, '10:00:00', 9)`,
      [zona.id, fecha],
    );

    const res = await postReserva(usuario, {
      zonaId: zona.id,
      fecha,
      horaInicio: BLOQUE,
      cupos: 2,
    });

    expect(res.status).toBe(409);
    expect(await contarReservas(zona.id)).toBe(0);
    expect(await cuposOcupados(zona.id, fecha, BLOQUE)).toBe(9);
  });

  it('rechaza bloque fuera del horario', async () => {
    const { zona, fecha } = await preparar();
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');

    const res = await postReserva(usuario, {
      zonaId: zona.id,
      fecha,
      horaInicio: '09:30',
      cupos: 2,
    });

    expect(res.status).toBe(400);
    expect(await contarReservas(zona.id)).toBe(0);
  });

  it('rechaza fecha fuera de la anticipacion', async () => {
    const { zona } = await preparar();
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');

    const lejana = await postReserva(usuario, {
      zonaId: zona.id,
      fecha: sumarDiasBogota(mananaBogota(), 30),
      horaInicio: BLOQUE,
      cupos: 2,
    });
    expect(lejana.status).toBe(400);

    const pasada = await postReserva(usuario, {
      zonaId: zona.id,
      fecha: sumarDiasBogota(hoyBogota(), -1),
      horaInicio: BLOQUE,
      cupos: 2,
    });
    expect(pasada.status).toBe(400);

    expect(await contarReservas(zona.id)).toBe(0);
  });

  it('rechaza el cuarto bloque en el mismo dia', async () => {
    const { zona, fecha } = await preparar();
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');

    for (const hora of ['10:00', '12:00', '14:00']) {
      const res = await postReserva(usuario, {
        zonaId: zona.id,
        fecha,
        horaInicio: hora,
        cupos: 1,
      });
      expect(res.status).toBe(201);
    }

    const cuarto = await postReserva(usuario, {
      zonaId: zona.id,
      fecha,
      horaInicio: '16:00',
      cupos: 1,
    });
    expect(cuarto.status).toBe(409);
    expect(await contarReservas(zona.id)).toBe(3);
  });

  it('rechaza cupos 0, negativos, mayores que max_cupos_reserva o que el aforo', async () => {
    // Review Focus 3: max_cupos_reserva = 4, aforo = 10.
    const { zona, fecha } = await preparar();
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');

    for (const cupos of [0, -1, 5, 11]) {
      const res = await postReserva(usuario, {
        zonaId: zona.id,
        fecha,
        horaInicio: BLOQUE,
        cupos,
      });
      expect(res.status).toBe(400);
    }

    expect(await contarReservas(zona.id)).toBe(0);
    expect(await cuposOcupados(zona.id, fecha, BLOQUE)).toBe(0);
  });

  it('rechaza el doble submit en el mismo bloque', async () => {
    // Review Focus 1: un apartamento no termina con dos reservas en el mismo bloque.
    const { zona, fecha } = await preparar();
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    const entrada = { zonaId: zona.id, fecha, horaInicio: BLOQUE, cupos: 2 };

    await crearReserva(usuario, entrada);

    await expect(crearReserva(usuario, entrada)).rejects.toMatchObject({ status: 409 });

    expect(await contarReservas(zona.id)).toBe(1);
    // El rollback revirtio el segundo incremento del contador.
    expect(await cuposOcupados(zona.id, fecha, BLOQUE)).toBe(2);
  });

  it('revalida el aforo cambiado despues del GET', async () => {
    // Review Focus 4: GET ve aforo 10; el aforo baja a 3 (el CHECK de la base
    // obliga a bajar max_cupos_reserva con el aforo); con 2 cupos ya ocupados,
    // la nueva reserva de 2 no cabe (2 + 2 > 3) y responde 409 sin tocar el
    // contador ni las reservas existentes.
    const { zona, fecha } = await preparar();
    const primero = await crearUsuarioConApartamento('RESIDENTE', '101');
    const segundo = await crearUsuarioConApartamento('RESIDENTE', '102');

    await crearReserva(primero, { zonaId: zona.id, fecha, horaInicio: BLOQUE, cupos: 2 });

    await query('UPDATE ZONA SET aforo = 3, max_cupos_reserva = 3 WHERE id = ?', [zona.id]);

    await expect(
      crearReserva(segundo, { zonaId: zona.id, fecha, horaInicio: BLOQUE, cupos: 2 }),
    ).rejects.toMatchObject({ status: 409 });

    const [fila] = await query<{ n: number; confirmadas: number }>(
      `SELECT COUNT(*) n, SUM(estado = 'CONFIRMADA') confirmadas FROM RESERVA WHERE zona_id = ?`,
      [zona.id],
    );
    expect(Number(fila.n)).toBe(1);
    expect(Number(fila.confirmadas)).toBe(1);
    expect(await cuposOcupados(zona.id, fecha, BLOQUE)).toBe(2);
  });
});
