import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { crearSesion, type UsuarioSesion } from '../src/modules/auth/sessions';
import {
  cancelacionesPorZona,
  horasPico,
  ocupacionPorBloque,
} from '../src/modules/estadisticas/queries';
import {
  crearUsuarioConApartamento,
  crearZonaConAforo,
  type Zona,
} from './helpers/fixtures';

const app = createApp();

// Lunes y martes fijos para que diasSemana sea determinista.
// 2026-06-15 es lunes (WEEKDAY=0 -> diaSemana=1), 2026-06-16 martes.
const LUNES_1 = '2026-06-15';
const MARTES = '2026-06-16';
const LUNES_2 = '2026-06-22';
const RANGO = { desde: '2026-06-01', hasta: '2026-06-30' };

async function cookieDe(usuario: UsuarioSesion): Promise<string> {
  const { token } = await crearSesion(usuario.id);
  return `sid=${token}`;
}

async function sembrarReserva(
  zona: Zona,
  fecha: string,
  horaInicio: string,
  cupos: number,
  estado: 'CONFIRMADA' | 'CANCELADA' | 'VENCIDA',
): Promise<string> {
  const id = randomUUID();
  const [h, m] = horaInicio.split(':').map(Number);
  const fin = h * 60 + m + zona.duracionBloqueMin;
  const horaFin = `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`;
  await query(
    `INSERT INTO RESERVA (id, apartamento_id, zona_id, fecha, hora_inicio, hora_fin, cupos, estado)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
    [id, zona.id, fecha, horaInicio, horaFin, cupos, estado],
  );
  return id;
}

// Zona A: lunes 15 (CONFIRMADA 3 + VENCIDA 2 + CANCELADA 4 en el mismo
// bloque 10:00) y lunes 22 (CONFIRMADA 1 en 10:00).
// Zona B: martes 16 (CONFIRMADA 2 cupos en 14:00) y lunes 22 cancelada.
async function sembrar(): Promise<{ zonaA: Zona; zonaB: Zona }> {
  const zonaA = await crearZonaConAforo(10, 120);
  const zonaB = await crearZonaConAforo(5, 120);

  await sembrarReserva(zonaA, LUNES_1, '10:00', 3, 'CONFIRMADA');
  await sembrarReserva(zonaA, LUNES_1, '10:00', 2, 'VENCIDA');
  await sembrarReserva(zonaA, LUNES_1, '10:00', 4, 'CANCELADA');
  await sembrarReserva(zonaA, LUNES_2, '10:00', 1, 'CONFIRMADA');
  await sembrarReserva(zonaB, MARTES, '14:00', 2, 'CONFIRMADA');
  await sembrarReserva(zonaB, LUNES_2, '14:00', 1, 'CANCELADA');

  return { zonaA, zonaB };
}

it('ocupacionPorBloque suma CONFIRMADA y VENCIDA, nunca CANCELADA', async () => {
  const { zonaA, zonaB } = await sembrar();

  const filas = await ocupacionPorBloque(RANGO.desde, RANGO.hasta);
  const porZona = new Map(filas.map((f) => [`${f.zona}|${f.fecha}|${f.horaInicio}`, f]));

  const lunes = porZona.get(`${zonaA.nombre}|${LUNES_1}|10:00`);
  expect(lunes).toBeDefined();
  // 3 confirmados + 2 vencidos = 5; los 4 cancelados NO cuentan.
  expect(lunes!.cupos).toBe(5);
  expect(lunes!.aforo).toBe(10);
  expect(lunes!.fecha).toBe(LUNES_1);
  expect(lunes!.horaInicio).toBe('10:00');

  const martesB = porZona.get(`${zonaB.nombre}|${MARTES}|14:00`);
  expect(martesB).toMatchObject({ cupos: 2, aforo: 5 });

  // El bloque solo-cancelado de la zona B no aparece: no hubo uso.
  expect(porZona.has(`${zonaB.nombre}|${LUNES_2}|14:00`)).toBe(false);
});

it('ocupacionPorBloque excluye fechas fuera del rango', async () => {
  await sembrar();
  await query(
    `INSERT INTO RESERVA (id, apartamento_id, zona_id, fecha, hora_inicio, hora_fin, cupos, estado)
     SELECT UUID(), NULL, zona_id, '2026-07-06', '10:00', '12:00', 3, 'CONFIRMADA'
     FROM RESERVA WHERE fecha = ? LIMIT 1`,
    [LUNES_1],
  );

  const filas = await ocupacionPorBloque('2026-07-01', '2026-07-31');
  expect(filas).toHaveLength(1);
  expect(filas[0]!.fecha).toBe('2026-07-06');

  const vacio = await ocupacionPorBloque('2030-01-01', '2030-01-31');
  expect(vacio).toEqual([]);
});

it('horasPico agrupa por hora y dia de semana, contando reservas no cupos', async () => {
  await sembrar();

  const filas = await horasPico(RANGO.desde, RANGO.hasta);
  const lunes10 = filas.find((f) => f.hora === 10 && f.diaSemana === 1);
  expect(lunes10).toBeDefined();
  // 3 reservas (2 del lunes 15 + 1 del lunes 22); la cancelada no cuenta.
  // Si contara cupos serian 6, no 3.
  expect(lunes10!.reservas).toBe(3);

  const martes14 = filas.find((f) => f.hora === 14 && f.diaSemana === 2);
  expect(martes14).toBeDefined();
  // 1 reserva de 2 cupos: se cuenta la reserva, no los cupos.
  expect(martes14!.reservas).toBe(1);

  // El lunes a las 14 solo hubo una reserva CANCELADA: no genera cubo.
  expect(filas.some((f) => f.hora === 14 && f.diaSemana === 1)).toBe(false);
});

it('cancelacionesPorZona trata lo VENCIDA como uso, no como cancelacion', async () => {
  const { zonaA, zonaB } = await sembrar();

  const filas = await cancelacionesPorZona(RANGO.desde, RANGO.hasta);
  const porZona = new Map(filas.map((f) => [f.zona, f]));

  const a = porZona.get(zonaA.nombre);
  expect(a).toBeDefined();
  // uso = CONFIRMADA + VENCIDA = 3; canceladas = 1; 1 / (3 + 1) = 25 %.
  // Si la vencida contara como cancelacion serian 2/4 = 50 %.
  expect(a!.confirmadas).toBe(3);
  expect(a!.canceladas).toBe(1);
  expect(a!.porcentaje).toBe(25);

  const b = porZona.get(zonaB.nombre);
  expect(b).toMatchObject({ confirmadas: 1, canceladas: 1, porcentaje: 50 });
});

it('cancelacionesPorZona no divide por cero: rango vacio y zona sin canceladas', async () => {
  const { zonaA } = await sembrar();

  const vacio = await cancelacionesPorZona('2030-01-01', '2030-01-31');
  expect(vacio).toEqual([]);

  // La zona A tiene canceladas; la B tambien. Sembramos una zona sin
  // cancelaciones y su porcentaje debe ser 0, no NaN.
  const zonaC = await crearZonaConAforo(4, 60);
  await sembrarReserva(zonaC, LUNES_1, '10:00', 1, 'CONFIRMADA');
  await sembrarReserva(zonaA, MARTES, '10:00', 1, 'VENCIDA');

  const filas = await cancelacionesPorZona(RANGO.desde, RANGO.hasta);
  const c = filas.find((f) => f.zona === zonaC.nombre);
  expect(c).toMatchObject({ confirmadas: 1, canceladas: 0, porcentaje: 0 });
});

it('las tres consultas no exponen datos de residentes (RF-35)', async () => {
  await sembrar();

  const ocupacion = await ocupacionPorBloque(RANGO.desde, RANGO.hasta);
  const pico = await horasPico(RANGO.desde, RANGO.hasta);
  const cancelaciones = await cancelacionesPorZona(RANGO.desde, RANGO.hasta);

  for (const fila of ocupacion) {
    expect(Object.keys(fila).sort()).toEqual(
      ['aforo', 'cupos', 'fecha', 'horaInicio', 'zona'],
    );
  }
  for (const fila of pico) {
    expect(Object.keys(fila).sort()).toEqual(['diaSemana', 'hora', 'reservas']);
  }
  for (const fila of cancelaciones) {
    expect(Object.keys(fila).sort()).toEqual(
      ['canceladas', 'confirmadas', 'porcentaje', 'zona'],
    );
  }
});

it('GET /admin/estadisticas renderiza las tres tablas con el filtro', async () => {
  const { zonaA } = await sembrar();
  const admin = await crearUsuarioConApartamento('ADMINISTRADOR', '900');

  const res = await request(app)
    .get('/admin/estadisticas')
    .query({ desde: RANGO.desde, hasta: RANGO.hasta })
    .set('Cookie', await cookieDe(admin))
    .set('Accept', 'text/html');

  expect(res.status).toBe(200);
  expect(res.text).toContain(zonaA.nombre);
  // La etiqueta de ocupacion advierte que el porcentaje es contra el aforo vigente.
  expect(res.text).toContain('contra aforo actual');
  // Filtro de zona presente en la vista.
  expect(res.text).toContain('name="zonaId"');
});

it('el filtro de zona reduce las estadisticas de la vista', async () => {
  const { zonaA, zonaB } = await sembrar();
  const admin = await crearUsuarioConApartamento('ADMINISTRADOR', '900');

  const res = await request(app)
    .get('/admin/estadisticas')
    .query({ desde: RANGO.desde, hasta: RANGO.hasta, zonaId: zonaB.id })
    .set('Cookie', await cookieDe(admin))
    .set('Accept', 'text/html');

  expect(res.status).toBe(200);
  expect(res.text).toContain(zonaB.nombre);
  // zonaA solo puede aparecer en el <select> de filtro, nunca en una fila:
  // una aparicion = dropdown; dos o mas = tabla con datos de otra zona.
  expect(res.text.split(zonaA.nombre).length - 1).toBe(1);
});

it('un residente recibe 403 en /admin/estadisticas', async () => {
  const residente = await crearUsuarioConApartamento('RESIDENTE', '101');

  const res = await request(app)
    .get('/admin/estadisticas')
    .set('Cookie', await cookieDe(residente))
    .set('Accept', 'text/html');

  expect(res.status).toBe(403);
});

it('desde y hasta fuera de formato AAAA-MM-DD se rechazan con 400', async () => {
  const admin = await crearUsuarioConApartamento('ADMINISTRADOR', '900');
  const cookie = await cookieDe(admin);

  const basura = await request(app)
    .get('/admin/estadisticas')
    .query({ desde: 'basura' })
    .set('Cookie', cookie)
    .set('Accept', 'text/html');
  expect(basura.status).toBe(400);
  expect(basura.body.error.code).toBe('VALIDACION');

  const imposible = await request(app)
    .get('/admin/estadisticas')
    .query({ hasta: '2026-02-29' })
    .set('Cookie', cookie)
    .set('Accept', 'text/html');
  expect(imposible.status).toBe(400);
  expect(imposible.body.error.code).toBe('VALIDACION');

  // Sin filtros la vista responde 200 con un rango por defecto.
  const limpio = await request(app)
    .get('/admin/estadisticas')
    .set('Cookie', cookie)
    .set('Accept', 'text/html');
  expect(limpio.status).toBe(200);
});
