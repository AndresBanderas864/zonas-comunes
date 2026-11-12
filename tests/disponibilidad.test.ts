import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { crearSesion } from '../src/modules/auth/sessions';
import { generarBloques } from '../src/modules/reservas/bloques';
import { obtenerDisponibilidad } from '../src/modules/reservas/disponibilidad';

// 2026-11-16 = lunes (dia_semana 1) · 2026-11-14 = sabado (dia_semana 6)
const LUNES = '2026-11-16';
const SABADO = '2026-11-14';

type SembrarZona = {
  id?: string;
  nombre: string;
  aforo: number;
  duracionMin: number;
  activa?: boolean;
  horarios?: { diaSemana: number; apertura: string; cierre: string }[];
};

async function sembrarZona(op: SembrarZona): Promise<string> {
  const id = op.id ?? randomUUID();
  await query(
    `INSERT INTO ZONA (id, nombre, aforo, duracion_bloque_min, max_cupos_reserva, activa)
     VALUES (?, ?, ?, ?, 4, ?)`,
    [id, op.nombre, op.aforo, op.duracionMin, op.activa === false ? 0 : 1],
  );
  for (const horario of op.horarios ?? []) {
    await query(
      `INSERT INTO HORARIO_ZONA (id, zona_id, dia_semana, apertura, cierre)
       VALUES (UUID(), ?, ?, ?, ?)`,
      [id, horario.diaSemana, horario.apertura, horario.cierre],
    );
  }
  return id;
}

async function sembrarOcupacion(
  zonaId: string,
  fecha: string,
  horaInicio: string,
  cupos: number,
): Promise<void> {
  await query(
    `INSERT INTO OCUPACION_BLOQUE (zona_id, fecha, hora_inicio, cupos_ocupados)
     VALUES (?, ?, ?, ?)`,
    [zonaId, fecha, horaInicio, cupos],
  );
}

async function cookieResidente(): Promise<string> {
  const usuarioId = randomUUID();
  const apartamentoId = randomUUID();
  await query(
    `INSERT INTO APARTAMENTO (id, torre_interior, numero)
     VALUES (?, 'A', ?)`,
    [apartamentoId, `10${usuarioId.slice(0, 4)}`],
  );
  await query(
    `INSERT INTO USUARIO (id, rol, apartamento_id, nombre, correo, password_hash, estado, correo_verificado)
     VALUES (?, 'RESIDENTE', ?, 'Residente', 'res@ecc.local', 'x', 'ACTIVA', 1)`,
    [usuarioId, apartamentoId],
  );
  const { token } = await crearSesion(usuarioId);
  return `sid=${token}`;
}

describe('generarBloques', () => {
  it('genera bloques de 120 minutos entre 08:00 y 20:00', () => {
    const bloques = generarBloques('08:00', '20:00', 120);
    expect(bloques).toHaveLength(6);
    expect(bloques[0]).toEqual({ horaInicio: '08:00', horaFin: '10:00' });
    expect(bloques[5]).toEqual({ horaInicio: '18:00', horaFin: '20:00' });
  });

  it('solo incluye bloques completos si el rango no es multiplo exacto', () => {
    expect(generarBloques('08:00', '17:00', 120)).toEqual([
      { horaInicio: '08:00', horaFin: '10:00' },
      { horaInicio: '10:00', horaFin: '12:00' },
      { horaInicio: '12:00', horaFin: '14:00' },
      { horaInicio: '14:00', horaFin: '16:00' },
    ]);
  });

  it('devuelve lista vacia con duracion invalida o rango vacio', () => {
    expect(generarBloques('08:00', '20:00', 0)).toEqual([]);
    expect(generarBloques('20:00', '08:00', 120)).toEqual([]);
  });
});

describe('obtenerDisponibilidad', () => {
  it('devuelve lista vacia si la zona no tiene horario ese dia', async () => {
    const zonaId = await sembrarZona({
      id: 'zona-sin-horario',
      nombre: 'Sin Horario',
      aforo: 10,
      duracionMin: 120,
      horarios: [{ diaSemana: 1, apertura: '08:00', cierre: '20:00' }],
    });

    await expect(obtenerDisponibilidad(zonaId, SABADO)).resolves.toEqual([]);
  });

  it('descuenta los cupos ya ocupados', async () => {
    const zonaId = await sembrarZona({
      id: 'zona-descuento',
      nombre: 'Descuento',
      aforo: 10,
      duracionMin: 120,
      horarios: [{ diaSemana: 1, apertura: '08:00', cierre: '20:00' }],
    });
    await sembrarOcupacion(zonaId, LUNES, '08:00:00', 4);

    const bloques = await obtenerDisponibilidad(zonaId, LUNES);
    expect(bloques).toHaveLength(6);

    const primero = bloques.find((b) => b.horaInicio === '08:00');
    expect(primero).toEqual({
      horaInicio: '08:00',
      horaFin: '10:00',
      aforo: 10,
      cuposDisponibles: 6,
    });

    const segundo = bloques.find((b) => b.horaInicio === '10:00');
    expect(segundo?.cuposDisponibles).toBe(10);
  });

  it('ignora la ocupacion de otras fechas', async () => {
    const zonaId = await sembrarZona({
      id: 'zona-otras-fechas',
      nombre: 'Otras Fechas',
      aforo: 10,
      duracionMin: 120,
      horarios: [{ diaSemana: 1, apertura: '08:00', cierre: '10:00' }],
    });
    await sembrarOcupacion(zonaId, '2026-11-23', '08:00', 10);

    const bloques = await obtenerDisponibilidad(zonaId, LUNES);
    expect(bloques).toHaveLength(1);
    expect(bloques[0]?.cuposDisponibles).toBe(10);
  });
});

describe('rutas de reserva', () => {
  it('GET /reservar exige sesion', async () => {
    const res = await request(createApp()).get('/reservar');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('GET /reservar lista zonas activas y oculta las inactivas', async () => {
    const cookie = await cookieResidente();
    await sembrarZona({
      nombre: 'Piscina',
      aforo: 20,
      duracionMin: 120,
      horarios: [{ diaSemana: 1, apertura: '08:00', cierre: '20:00' }],
    });
    await sembrarZona({
      nombre: 'BBQ Cerrada',
      aforo: 8,
      duracionMin: 120,
      activa: false,
      horarios: [{ diaSemana: 1, apertura: '08:00', cierre: '20:00' }],
    });

    const res = await request(createApp()).get('/reservar').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Piscina');
    expect(res.text).not.toContain('BBQ Cerrada');
  });

  it('GET /reservar/:zona/:fecha muestra solo bloques con cupos disponibles', async () => {
    const cookie = await cookieResidente();
    const zonaId = await sembrarZona({
      nombre: 'Salon',
      aforo: 10,
      duracionMin: 120,
      horarios: [{ diaSemana: 1, apertura: '08:00', cierre: '16:00' }],
    });
    await sembrarOcupacion(zonaId, LUNES, '10:00', 10);
    await sembrarOcupacion(zonaId, LUNES, '12:00', 4);

    const res = await request(createApp())
      .get(`/reservar/${zonaId}/${LUNES}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.text).toContain('08:00 - 10:00');
    expect(res.text).toContain('12:00 - 14:00');
    expect(res.text).toContain('14:00 - 16:00');
    expect(res.text).not.toContain('10:00 - 12:00');
  });

  it('GET /reservar/:zona/:fecha sin horario ese dia responde 200 con lista vacia', async () => {
    const cookie = await cookieResidente();
    const zonaId = await sembrarZona({
      nombre: 'Gimnasio',
      aforo: 10,
      duracionMin: 120,
      horarios: [{ diaSemana: 1, apertura: '08:00', cierre: '20:00' }],
    });

    const res = await request(createApp())
      .get(`/reservar/${zonaId}/${SABADO}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.text).toContain('No hay bloques disponibles');
  });

  it('GET /reservar/:zona/:fecha con zona inexistente o inactiva responde 404', async () => {
    const cookie = await cookieResidente();
    const inactiva = await sembrarZona({
      nombre: 'Cerrada',
      aforo: 4,
      duracionMin: 60,
      activa: false,
      horarios: [{ diaSemana: 1, apertura: '08:00', cierre: '10:00' }],
    });

    const fantasma = await request(createApp())
      .get(`/reservar/${randomUUID()}/${LUNES}`)
      .set('Cookie', cookie);
    expect(fantasma.status).toBe(404);

    const cerrada = await request(createApp())
      .get(`/reservar/${inactiva}/${LUNES}`)
      .set('Cookie', cookie);
    expect(cerrada.status).toBe(404);
  });

  it('GET /reservar/:zona/:fecha con fecha malformada responde 400', async () => {
    const cookie = await cookieResidente();
    const zonaId = await sembrarZona({
      nombre: 'Terraza',
      aforo: 6,
      duracionMin: 60,
      horarios: [{ diaSemana: 1, apertura: '08:00', cierre: '10:00' }],
    });

    const res = await request(createApp())
      .get(`/reservar/${zonaId}/16-11-2026`)
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
  });
});
