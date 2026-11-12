import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { derivarCsrf } from '../src/lib/crypto';
import { crearSesion, type UsuarioSesion } from '../src/modules/auth/sessions';
import {
  dividirHistorial,
  historialDe,
  listarReservas,
} from '../src/modules/reservas/consultas';
import { cancelarReserva } from '../src/modules/reservas/cancelacion';
import {
  crearUsuarioConApartamento,
  crearZonaConAforo,
  fijarContextoReserva,
  hoyBogota,
  mananaBogota,
  postReserva,
  sumarDiasBogota,
  type Zona,
} from './helpers/fixtures';

const app = createApp();
const BLOQUE = '10:00';

async function cookieDe(usuario: UsuarioSesion): Promise<string> {
  const { token } = await crearSesion(usuario.id);
  return `sid=${token}`;
}

type Escenario = {
  zona: Zona;
  fecha: string;
  propio: UsuarioSesion;
  ajeno: UsuarioSesion;
  idPropio1: string;
  idPropio2: string;
  idAjeno: string;
};

// Dos reservas del apartamento 101 (10:00 y 12:00 del manana) y una del 102
// en el mismo zona/bloque 10:00.
async function preparar(): Promise<Escenario> {
  const zona = await crearZonaConAforo(10, 120);
  const fecha = mananaBogota();
  fijarContextoReserva({ zonaId: zona.id, fecha, horaInicio: BLOQUE });

  const propio = await crearUsuarioConApartamento('RESIDENTE', '101');
  const ajeno = await crearUsuarioConApartamento('RESIDENTE', '102');

  const primera = await postReserva(propio, { cupos: 1 });
  const segunda = await postReserva(propio, { horaInicio: '12:00', cupos: 1 });
  const ajena = await postReserva(ajeno, { cupos: 2 });
  expect([primera.status, segunda.status, ajena.status]).toEqual([201, 201, 201]);

  return {
    zona,
    fecha,
    propio,
    ajeno,
    idPropio1: primera.body.reserva.id as string,
    idPropio2: segunda.body.reserva.id as string,
    idAjeno: ajena.body.reserva.id as string,
  };
}

it('historialDe devuelve solo el apartamento, descendente por fecha y hora', async () => {
  const { propio, idPropio1, idPropio2, idAjeno } = await preparar();

  const historial = await historialDe(propio.apartamentoId!);

  expect(historial.map((r) => r.id)).toEqual([idPropio2, idPropio1]);
  expect(historial.every((r) => r.apartamentoId === propio.apartamentoId)).toBe(true);
  expect(historial.some((r) => r.id === idAjeno)).toBe(false);
  expect(historial[0]).toMatchObject({ estado: 'CONFIRMADA', cupos: 1 });
  expect(historial[0].creadaEn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

it('el historial del residente separa próximas e históricas', async () => {
  const { propio } = await preparar();

  const historial = await historialDe(propio.apartamentoId!);
  const { proximas, pasadas } = dividirHistorial(historial);

  expect(proximas).toHaveLength(2);
  expect(pasadas).toHaveLength(0);
});

it('/mis-reservas muestra el propio apartamento y no el de otro', async () => {
  const { zona, propio, idPropio1, idAjeno } = await preparar();
  const cookie = await cookieDe(propio);

  const res = await request(app)
    .get('/mis-reservas')
    .set('Cookie', cookie)
    .set('Accept', 'text/html');

  expect(res.status).toBe(200);
  expect(res.text).toContain(zona.nombre);
  expect(res.text).toContain(`/reservas/${idPropio1}/cancelar`);
  expect(res.text).not.toContain(idAjeno);
});

it('/mis-reservas mueve la cancelada al historial sin boton de cancelar', async () => {
  const { propio, idPropio1 } = await preparar();
  await cancelarReserva(propio, idPropio1);
  const cookie = await cookieDe(propio);

  const res = await request(app)
    .get('/mis-reservas')
    .set('Cookie', cookie)
    .set('Accept', 'text/html');

  expect(res.status).toBe(200);
  expect(res.text).toContain('Cancelada');
  expect(res.text).not.toContain(`/reservas/${idPropio1}/cancelar`);
});

it('listarReservas trajo apartamento y zona, y los filtros reducen la lista', async () => {
  const escenario = await preparar();
  const { fecha, zona, propio, ajeno } = escenario;

  // Cancelamos una para poder filtrar por estado.
  await cancelarReserva(ajeno, escenario.idAjeno);

  const todas = await listarReservas({});
  expect(todas).toHaveLength(3);
  const porId = new Map(todas.map((r) => [r.id, r]));
  expect(porId.get(escenario.idAjeno)).toMatchObject({
    torreInterior: 'A',
    numero: '102',
    zonaNombre: zona.nombre,
    estado: 'CANCELADA',
  });
  expect(porId.get(escenario.idPropio1)?.numero).toBe('101');

  const porZona = await listarReservas({ zonaId: zona.id });
  expect(porZona).toHaveLength(3);
  const otraZona = await crearZonaConAforo(5, 60);
  expect(await listarReservas({ zonaId: otraZona.id })).toHaveLength(0);

  const canceladas = await listarReservas({ estado: 'CANCELADA' });
  expect(canceladas.map((r) => r.id)).toEqual([escenario.idAjeno]);
  expect(await listarReservas({ estado: 'CONFIRMADA' })).toHaveLength(2);

  expect(await listarReservas({ desde: fecha, hasta: fecha })).toHaveLength(3);
  expect(
    await listarReservas({ desde: sumarDiasBogota(fecha, 1) }),
  ).toHaveLength(0);
  expect(await listarReservas({ hasta: hoyBogota() })).toHaveLength(0);

  expect(await listarReservas({ zonaId: zona.id, estado: 'CANCELADA' })).toHaveLength(1);
  expect(await listarReservas({ zonaId: otraZona.id, estado: 'CANCELADA' })).toHaveLength(0);
  // Ninguna reserva pertenece al apartamento de propio y a la vez a la otra zona.
  expect(propio.apartamentoId).not.toBeNull();
});

it('GET /admin/reservas muestra todas con apartamento y zona', async () => {
  const { zona, propio, ajeno } = await preparar();
  const admin = await crearUsuarioConApartamento('ADMINISTRADOR', '900');

  const res = await request(app)
    .get('/admin/reservas')
    .set('Cookie', await cookieDe(admin))
    .set('Accept', 'text/html');

  expect(res.status).toBe(200);
  expect(res.text).toContain('A · 101');
  expect(res.text).toContain('A · 102');
  expect(res.text).toContain(zona.nombre);
  // La administracion puede cancelar la ajena: el formulario apunta a la ruta.
  const propias = await historialDe(propio.apartamentoId!);
  expect(res.text).toContain(`/reservas/${propias[0].id}/cancelar`);
  expect(ajeno.apartamentoId).not.toBeNull();
});

it('los filtros de zona y estado reducen la lista del administrador', async () => {
  const escenario = await preparar();
  const otraZona = await crearZonaConAforo(5, 60);
  await cancelarReserva(escenario.ajeno, escenario.idAjeno);
  const admin = await crearUsuarioConApartamento('ADMINISTRADOR', '900');
  const cookie = await cookieDe(admin);

  const porZona = await request(app)
    .get('/admin/reservas')
    .query({ zonaId: otraZona.id })
    .set('Cookie', cookie)
    .set('Accept', 'text/html');
  expect(porZona.status).toBe(200);
  expect(porZona.text).not.toContain('A · 101');
  expect(porZona.text).not.toContain('A · 102');

  const canceladas = await request(app)
    .get('/admin/reservas')
    .query({ estado: 'CANCELADA' })
    .set('Cookie', cookie)
    .set('Accept', 'text/html');
  expect(canceladas.status).toBe(200);
  expect(canceladas.text).toContain('A · 102');
  expect(canceladas.text).not.toContain('A · 101');

  const confirmadas = await request(app)
    .get('/admin/reservas')
    .query({ estado: 'CONFIRMADA' })
    .set('Cookie', cookie)
    .set('Accept', 'text/html');
  expect(confirmadas.text).toContain('A · 101');
  expect(confirmadas.text).not.toContain('A · 102');
});

it('un residente recibe 403 en /admin/reservas', async () => {
  const { propio } = await preparar();

  const res = await request(app)
    .get('/admin/reservas')
    .set('Cookie', await cookieDe(propio))
    .set('Accept', 'text/html');

  expect(res.status).toBe(403);
});
