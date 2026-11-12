import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { crearSesion, type UsuarioSesion } from '../src/modules/auth/sessions';
import { reservasDelDia } from '../src/modules/reservas/vigilancia';
import {
  crearUsuarioConApartamento,
  crearZonaConAforo,
  fijarContextoReserva,
  hoyBogota,
  mananaBogota,
  postReserva,
  type Zona,
} from './helpers/fixtures';

const app = createApp();

async function cookieDe(usuario: UsuarioSesion): Promise<string> {
  const { token } = await crearSesion(usuario.id);
  return `sid=${token}`;
}

async function insertarReserva(opciones: {
  apartamentoId: string;
  zonaId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupos: number;
  estado: 'CONFIRMADA' | 'CANCELADA' | 'VENCIDA';
}): Promise<void> {
  await query(
    `INSERT INTO RESERVA (id, apartamento_id, zona_id, fecha, hora_inicio, hora_fin, cupos, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      opciones.apartamentoId,
      opciones.zonaId,
      opciones.fecha,
      opciones.horaInicio,
      opciones.horaFin,
      opciones.cupos,
      opciones.estado,
    ],
  );
}

type Escenario = {
  zonaA: Zona;
  zonaB: Zona;
  hoy: string;
  manana: string;
  vigilante: UsuarioSesion;
  residente: UsuarioSesion;
};

// Cinco reservas: tres del dia de hoy activas o vencidas, una cancelada hoy y
// una confirmada de manana. La vista del vigilante debe traer solo las tres
// primeras: CONFIRMADA y VENCIDA cuentan (la vencida ocurrio y ocup6 el
// bloque, spec 9.6); CANCELADA y otros dias quedan fuera.
async function preparar(): Promise<Escenario> {
  const zonaA = await crearZonaConAforo(10, 120);
  const zonaB = await crearZonaConAforo(10, 120);
  const propio = await crearUsuarioConApartamento('RESIDENTE', '101');
  const ajeno = await crearUsuarioConApartamento('RESIDENTE', '102');
  const hoy = hoyBogota();
  const manana = mananaBogota();

  await insertarReserva({ apartamentoId: propio.apartamentoId!, zonaId: zonaA.id, fecha: hoy, horaInicio: '12:00', horaFin: '14:00', cupos: 2, estado: 'CONFIRMADA' });
  await insertarReserva({ apartamentoId: ajeno.apartamentoId!, zonaId: zonaA.id, fecha: hoy, horaInicio: '10:00', horaFin: '12:00', cupos: 1, estado: 'CONFIRMADA' });
  await insertarReserva({ apartamentoId: propio.apartamentoId!, zonaId: zonaB.id, fecha: hoy, horaInicio: '08:00', horaFin: '10:00', cupos: 3, estado: 'VENCIDA' });
  await insertarReserva({ apartamentoId: ajeno.apartamentoId!, zonaId: zonaA.id, fecha: hoy, horaInicio: '14:00', horaFin: '16:00', cupos: 1, estado: 'CANCELADA' });
  await insertarReserva({ apartamentoId: propio.apartamentoId!, zonaId: zonaA.id, fecha: manana, horaInicio: '16:00', horaFin: '18:00', cupos: 1, estado: 'CONFIRMADA' });
  const vigilante = await crearUsuarioConApartamento('VIGILANTE', '901');
  return { zonaA, zonaB, hoy, manana, vigilante, residente: propio };
}

it('reservasDelDia trae CONFIRMADA y VENCIDA del dia, ordenadas por zona y hora', async () => {
  const { zonaA, zonaB, hoy } = await preparar();

  const reservas = await reservasDelDia(hoy);

  expect(reservas).toHaveLength(3);
  // Orden: zona (nombre) y luego hora de inicio.
  const ordenZonas = [zonaA.nombre, zonaB.nombre].sort();
  const esperadas = ordenZonas[0] === zonaA.nombre
    ? [
        { apartamento: 'A · 102', zona: zonaA.nombre, horaInicio: '10:00', horaFin: '12:00', cupos: 1 },
        { apartamento: 'A · 101', zona: zonaA.nombre, horaInicio: '12:00', horaFin: '14:00', cupos: 2 },
        { apartamento: 'A · 101', zona: zonaB.nombre, horaInicio: '08:00', horaFin: '10:00', cupos: 3 },
      ]
    : [
        { apartamento: 'A · 101', zona: zonaB.nombre, horaInicio: '08:00', horaFin: '10:00', cupos: 3 },
        { apartamento: 'A · 102', zona: zonaA.nombre, horaInicio: '10:00', horaFin: '12:00', cupos: 1 },
        { apartamento: 'A · 101', zona: zonaA.nombre, horaInicio: '12:00', horaFin: '14:00', cupos: 2 },
      ];
  expect(reservas).toEqual(esperadas);
});

it('GET /vigilancia muestra al VIGILANTE la lista del dia por defecto', async () => {
  const { zonaB, hoy, vigilante } = await preparar();

  const res = await request(app)
    .get('/vigilancia')
    .set('Cookie', await cookieDe(vigilante))
    .set('Accept', 'text/html');

  expect(res.status).toBe(200);
  expect(res.text).toContain(hoy);
  expect(res.text).toContain('A · 101');
  expect(res.text).toContain('A · 102');
  expect(res.text).toContain(zonaB.nombre);
  expect(res.text).toContain('08:00');
  expect(res.text).toContain('14:00');
  // Fuera: la cancelada de hoy (14:00-16:00) y la confirmada de manana
  // (16:00-18:00). El 16:00 y el 18:00 no deben aparecer en el dia de hoy.
  expect(res.text).not.toContain('16:00');
  expect(res.text).not.toContain('18:00');
});

it('GET /vigilancia con fecha explicita muestra ese dia y no el de hoy', async () => {
  const escenario = await preparar();

  const res = await request(app)
    .get('/vigilancia')
    .query({ fecha: escenario.manana })
    .set('Cookie', await cookieDe(escenario.vigilante))
    .set('Accept', 'text/html');

  expect(res.status).toBe(200);
  expect(res.text).toContain('16:00');
  expect(res.text).not.toContain('08:00');
  expect(res.text).not.toContain('12:00');
});

it('un RESIDENTE no entra a /vigilancia', async () => {
  const { residente } = await preparar();

  const res = await request(app)
    .get('/vigilancia')
    .set('Cookie', await cookieDe(residente))
    .set('Accept', 'text/html');

  expect(res.status).toBe(403);
});

it('el VIGILANTE recibe 403 en rutas de escritura', async () => {
  const { zonaA, hoy } = await preparar();
  const vigilante = await crearUsuarioConApartamento('VIGILANTE', '903');
  fijarContextoReserva({ zonaId: zonaA.id, fecha: hoy, horaInicio: '10:00' });

  const crear = await postReserva(vigilante, { cupos: 1 });
  expect(crear.status).toBe(403);
});

it('una fecha fuera de formato AAAA-MM-DD se rechaza con 400', async () => {
  const escenario = await preparar();
  const cookie = await cookieDe(escenario.vigilante);

  const basura = await request(app)
    .get('/vigilancia')
    .query({ fecha: 'basura' })
    .set('Cookie', cookie)
    .set('Accept', 'text/html');
  expect(basura.status).toBe(400);
  expect(basura.body.error.code).toBe('VALIDACION');

  const imposible = await request(app)
    .get('/vigilancia')
    .query({ fecha: '2026-13-45' })
    .set('Cookie', cookie)
    .set('Accept', 'text/html');
  expect(imposible.status).toBe(400);
  expect(imposible.body.error.code).toBe('VALIDACION');

  // 2026 no es bisiesto: el formato pasa pero el calendario no.
  const febreroVeintinueve = await request(app)
    .get('/vigilancia')
    .query({ fecha: '2026-02-29' })
    .set('Cookie', cookie)
    .set('Accept', 'text/html');
  expect(febreroVeintinueve.status).toBe(400);
  expect(febreroVeintinueve.body.error.code).toBe('VALIDACION');
});
