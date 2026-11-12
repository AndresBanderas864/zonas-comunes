import { expect, it } from 'vitest';
import request from 'supertest';
import type { Response } from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { derivarCsrf } from '../src/lib/crypto';
import { crearSesion, type UsuarioSesion } from '../src/modules/auth/sessions';
import { cancelarReserva } from '../src/modules/reservas/cancelacion';
import {
  crearUsuarioConApartamento,
  crearZonaConAforo,
  fijarContextoReserva,
  mananaBogota,
  postReserva,
} from './helpers/fixtures';

const app = createApp();
const BLOQUE = '10:00';

type Credenciales = { cookie: string; csrf: string };

async function credencialesDe(usuario: UsuarioSesion): Promise<Credenciales> {
  const { token } = await crearSesion(usuario.id);
  return {
    cookie: `sid=${token}`,
    csrf: derivarCsrf(token, process.env.SESSION_SECRET as string),
  };
}

// postCancelar: JSON por defecto (acepto implicito */* -> rama json de la
// ruta). Con headers { Accept: 'text/html' } ejerce la rama de navegador.
async function postCancelar(
  usuario: UsuarioSesion,
  reservaId: string,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  const credenciales = await credencialesDe(usuario);
  return request(app)
    .post(`/reservas/${reservaId}/cancelar`)
    .set('Cookie', credenciales.cookie)
    .set(headers)
    .send({ _csrf: credenciales.csrf, ...body });
}

async function cuposOcupados(zonaId: string, fecha: string): Promise<number> {
  const filas = await query<{ total: number }>(
    `SELECT COALESCE(SUM(cupos_ocupados), 0) total
     FROM OCUPACION_BLOQUE WHERE zona_id = ? AND fecha = ? AND hora_inicio = '10:00:00'`,
    [zonaId, fecha],
  );
  return Number(filas[0].total);
}

async function estadoReserva(
  reservaId: string,
): Promise<{ estado: string; cancelada_por: string | null; motivo: string | null }> {
  const filas = await query<{
    estado: string;
    cancelada_por: string | null;
    motivo: string | null;
  }>(
    `SELECT estado, cancelada_por, motivo_cancelacion AS motivo
     FROM RESERVA WHERE id = ?`,
    [reservaId],
  );
  return filas[0];
}

// Reserva de 2 cupos en el bloque 10:00 de manana, con su usuario dueno.
async function preparar(
  numero: string,
): Promise<{ zona: { id: string }; fecha: string; usuario: UsuarioSesion; reservaId: string }> {
  const zona = await crearZonaConAforo(10, 120);
  const fecha = mananaBogota();
  fijarContextoReserva({ zonaId: zona.id, fecha, horaInicio: BLOQUE });
  const usuario = await crearUsuarioConApartamento('RESIDENTE', numero);
  const res = await postReserva(usuario, { cupos: 2 });
  expect(res.status).toBe(201);
  return { zona, fecha, usuario, reservaId: res.body.reserva.id };
}

it('cancelar devuelve los cupos al bloque', async () => {
  const { zona, fecha, usuario, reservaId } = await preparar('101');
  expect(await cuposOcupados(zona.id, fecha)).toBe(2);

  const res = await postCancelar(usuario, reservaId, { motivo: 'Cambio de planes' });

  expect(res.status).toBe(204);
  expect(await cuposOcupados(zona.id, fecha)).toBe(0);
  expect(await estadoReserva(reservaId)).toEqual({
    estado: 'CANCELADA',
    cancelada_por: 'RESIDENTE',
    motivo: 'Cambio de planes',
  });
});

it('cancelar dos veces no resta dos veces', async () => {
  const { zona, fecha, usuario, reservaId } = await preparar('101');

  await cancelarReserva(usuario, reservaId);
  const despuesDeLaPrimera = await cuposOcupados(zona.id, fecha);
  expect(despuesDeLaPrimera).toBe(0);

  await expect(cancelarReserva(usuario, reservaId)).rejects.toMatchObject({ status: 409 });
  expect(await cuposOcupados(zona.id, fecha)).toBe(despuesDeLaPrimera);

  const porHttp = await postCancelar(usuario, reservaId);
  expect(porHttp.status).toBe(409);
  expect(await cuposOcupados(zona.id, fecha)).toBe(despuesDeLaPrimera);
});

it('un residente no puede cancelar la reserva de otro apartamento', async () => {
  const { zona, fecha, reservaId } = await preparar('101');
  const ajeno = await crearUsuarioConApartamento('RESIDENTE', '102');

  const res = await postCancelar(ajeno, reservaId);

  expect(res.status).toBe(403);
  expect(await estadoReserva(reservaId)).toMatchObject({ estado: 'CONFIRMADA' });
  expect(await cuposOcupados(zona.id, fecha)).toBe(2);
});

it('un administrador si puede cancelar una reserva ajena y deja BITACORA', async () => {
  const { zona, fecha, reservaId } = await preparar('101');
  const admin = await crearUsuarioConApartamento('ADMINISTRADOR', '900');

  const res = await postCancelar(admin, reservaId, { motivo: 'Aforo de emergencia' });

  expect(res.status).toBe(204);
  expect(await estadoReserva(reservaId)).toMatchObject({
    estado: 'CANCELADA',
    cancelada_por: 'ADMINISTRADOR',
  });
  expect(await cuposOcupados(zona.id, fecha)).toBe(0);

  const bitacora = await query<{ accion: string; entidad_id: string; usuario_id: string }>(
    `SELECT accion, entidad_id, usuario_id FROM BITACORA
     WHERE accion = 'reserva.cancelar_admin' AND entidad_id = ?`,
    [reservaId],
  );
  expect(bitacora).toHaveLength(1);
  expect(bitacora[0].usuario_id).toBe(admin.id);
});

it('no se puede cancelar una reserva VENCIDA', async () => {
  const { zona, fecha, usuario, reservaId } = await preparar('101');
  await query(`UPDATE RESERVA SET estado = 'VENCIDA' WHERE id = ?`, [reservaId]);

  await expect(cancelarReserva(usuario, reservaId)).rejects.toMatchObject({ status: 409 });
  const res = await postCancelar(usuario, reservaId);
  expect(res.status).toBe(409);

  expect(await estadoReserva(reservaId)).toMatchObject({ estado: 'VENCIDA' });
  // VENCIDA no devuelve cupos: el contador sigue con los 2 de la reserva.
  expect(await cuposOcupados(zona.id, fecha)).toBe(2);
});

it('cancelaciones simultáneas nunca dejan el contador negativo', async () => {
  // 5 reservas de 2 cupos sobre aforo 10 (contador al tope, 10 ocupados) y
  // 10 cancelaciones concurrentes: cada reserva se cancela dos veces a la vez.
  // Invariante: exactamente 5 exitosas y 5 conflictos, contador = 0, y nunca
  // una resta doble (la CHECK cupos_ocupados >= 0 convertiria el error en 500,
  // asi que cualquier codigo distinto de 204/409 tambien delataria la carrera).
  const zona = await crearZonaConAforo(10, 120);
  const fecha = mananaBogota();
  fijarContextoReserva({ zonaId: zona.id, fecha, horaInicio: BLOQUE });

  const dueños: { usuario: UsuarioSesion; reservaId: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const usuario = await crearUsuarioConApartamento('RESIDENTE', `3${String(i + 1).padStart(2, '0')}`);
    const res = await postReserva(usuario, { cupos: 2 });
    expect(res.status).toBe(201);
    dueños.push({ usuario, reservaId: res.body.reserva.id as string });
  }
  expect(await cuposOcupados(zona.id, fecha)).toBe(10);

  const peticiones = dueños.flatMap(({ usuario, reservaId }) => [
    postCancelar(usuario, reservaId),
    postCancelar(usuario, reservaId),
  ]);

  const inicio = Date.now();
  const respuestas = await Promise.all(peticiones);
  const codigos = respuestas.map((res) => res.status);
  console.log(
    `cancelaciones simultaneas: ${Date.now() - inicio} ms · codigos=${JSON.stringify(codigos)}`,
  );

  expect(respuestas.filter((res) => res.status === 204)).toHaveLength(5);
  expect(respuestas.filter((res) => res.status === 409)).toHaveLength(5);

  expect(await cuposOcupados(zona.id, fecha)).toBe(0);

  const conteo = await query<{ n: number; canceladas: number }>(
    `SELECT COUNT(*) n, SUM(estado = 'CANCELADA') canceladas
     FROM RESERVA WHERE zona_id = ? AND fecha = ?`,
    [zona.id, fecha],
  );
  expect(Number(conteo[0].n)).toBe(5);
  expect(Number(conteo[0].canceladas)).toBe(5);
}, 30_000);

it('la cancelacion por navegador redirige a mis-reservas y la lista oculta la cancelada', async () => {
  const zona = await crearZonaConAforo(10, 120);
  const fecha = mananaBogota();
  fijarContextoReserva({ zonaId: zona.id, fecha, horaInicio: BLOQUE });
  const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');

  const primera = await postReserva(usuario, { cupos: 2 });
  const segunda = await postReserva(usuario, { zonaId: zona.id, fecha, horaInicio: '12:00', cupos: 1 });
  expect(primera.status).toBe(201);
  expect(segunda.status).toBe(201);

  const res = await postCancelar(
    usuario,
    primera.body.reserva.id,
    {},
    { Accept: 'text/html' },
  );
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/reservas/mis-reservas');

  // Se reenvia la cookie de flash que el 302 acabo de emitir (patron PRG).
  const crudas = res.headers['set-cookie'] as unknown;
  const flashCookies = (Array.isArray(crudas) ? crudas : crudas ? [crudas] : [])
    .map((c) => String(c).split(';')[0])
    .filter((c) => c.startsWith('flash='));
  const credenciales = await credencialesDe(usuario);
  const lista = await request(app)
    .get('/reservas/mis-reservas')
    .set('Cookie', [credenciales.cookie, ...flashCookies].join('; '))
    .set('Accept', 'text/html');

  expect(lista.status).toBe(200);
  expect(lista.text).toContain('Reserva cancelada');
  expect(lista.text).not.toContain(`/reservas/${primera.body.reserva.id}/cancelar`);
  expect(lista.text).toContain(`/reservas/${segunda.body.reserva.id}/cancelar`);
});
