import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { derivarCsrf } from '../src/lib/crypto';
import { crearSesion } from '../src/modules/auth/sessions';

async function sembrarAdmin(): Promise<{
  cookie: string;
  csrf: string;
  usuarioId: string;
}> {
  const usuarioId = randomUUID();
  await query(
    `INSERT INTO USUARIO (id, rol, nombre, correo, password_hash, estado, correo_verificado)
     VALUES (?, 'ADMINISTRADOR', 'Admin', 'admin@ecc.local', 'x', 'ACTIVA', 1)`,
    [usuarioId],
  );

  const { token } = await crearSesion(usuarioId);
  const csrf = derivarCsrf(token, process.env.SESSION_SECRET as string);
  return { cookie: `sid=${token}`, csrf, usuarioId };
}

async function sembrarParametros(): Promise<void> {
  await query(
    `INSERT INTO PARAMETRO_RESERVA (id, max_reservas_semana, max_reservas_dia, anticipacion_dias)
     VALUES (1, 7, 3, 7)`,
  );
}

type CuerpoParametros = {
  csrf: string;
  maxReservasSemana?: string;
  maxReservasDia?: string;
  anticipacionDias?: string;
};

function cuerpoParametros(op: CuerpoParametros): Record<string, string> {
  return {
    _csrf: op.csrf,
    maxReservasSemana: op.maxReservasSemana ?? '7',
    maxReservasDia: op.maxReservasDia ?? '3',
    anticipacionDias: op.anticipacionDias ?? '7',
  };
}

describe('parametros de reserva', () => {
  it('renderiza el formulario con los valores actuales', async () => {
    const admin = await sembrarAdmin();
    await sembrarParametros();

    const res = await request(createApp())
      .get('/admin/parametros')
      .set('Cookie', admin.cookie);

    expect(res.status).toBe(200);
    expect(res.text).toContain('name="maxReservasSemana"');
    expect(res.text).toContain('name="maxReservasDia"');
    expect(res.text).toContain('name="anticipacionDias"');
    expect(res.text).toContain('name="_csrf"');
    expect(res.text).toContain('value="7"');
    expect(res.text).toContain('value="3"');
  });

  it('rechaza dia mayor que semana: 400, conserva la fila y no audita', async () => {
    const admin = await sembrarAdmin();
    await sembrarParametros();

    const res = await request(createApp())
      .post('/admin/parametros')
      .set('Cookie', admin.cookie)
      .type('form')
      .send(
        cuerpoParametros({
          csrf: admin.csrf,
          maxReservasSemana: '7',
          maxReservasDia: '10',
          anticipacionDias: '7',
        }),
      );

    expect(res.status).toBe(400);
    expect(res.text).toContain('value="10"');

    const [fila] = await query<{
      max_reservas_semana: number;
      max_reservas_dia: number;
      anticipacion_dias: number;
    }>(
      'SELECT max_reservas_semana, max_reservas_dia, anticipacion_dias FROM PARAMETRO_RESERVA WHERE id = 1',
    );
    expect(Number(fila.max_reservas_semana)).toBe(7);
    expect(Number(fila.max_reservas_dia)).toBe(3);
    expect(Number(fila.anticipacion_dias)).toBe(7);

    const [{ n }] = await query<{ n: number }>(
      "SELECT COUNT(*) n FROM BITACORA WHERE accion = 'parametros.actualizar'",
    );
    expect(n).toBe(0);
  });

  it('un cambio valido persiste y deja BITACORA', async () => {
    const admin = await sembrarAdmin();
    await sembrarParametros();

    const res = await request(createApp())
      .post('/admin/parametros')
      .set('Cookie', admin.cookie)
      .type('form')
      .send(
        cuerpoParametros({
          csrf: admin.csrf,
          maxReservasSemana: '14',
          maxReservasDia: '5',
          anticipacionDias: '30',
        }),
      );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/parametros');

    const [fila] = await query<{
      max_reservas_semana: number;
      max_reservas_dia: number;
      anticipacion_dias: number;
    }>(
      'SELECT max_reservas_semana, max_reservas_dia, anticipacion_dias FROM PARAMETRO_RESERVA WHERE id = 1',
    );
    expect(Number(fila.max_reservas_semana)).toBe(14);
    expect(Number(fila.max_reservas_dia)).toBe(5);
    expect(Number(fila.anticipacion_dias)).toBe(30);

    const [bitacora] = await query<{
      accion: string;
      entidad: string;
      usuario_id: string;
    }>(
      "SELECT accion, entidad, usuario_id FROM BITACORA WHERE accion = 'parametros.actualizar'",
    );
    expect(bitacora.entidad).toBe('PARAMETRO_RESERVA');
    expect(bitacora.usuario_id).toBe(admin.usuarioId);

    const [{ n }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM PARAMETRO_RESERVA',
    );
    expect(n).toBe(1);
  });

  it('rechaza valores no enteros o menores que uno con 400', async () => {
    const admin = await sembrarAdmin();
    await sembrarParametros();

    const res = await request(createApp())
      .post('/admin/parametros')
      .set('Cookie', admin.cookie)
      .type('form')
      .send(
        cuerpoParametros({
          csrf: admin.csrf,
          maxReservasSemana: '7',
          maxReservasDia: '0',
          anticipacionDias: '7',
        }),
      );

    expect(res.status).toBe(400);

    const [fila] = await query<{ max_reservas_dia: number }>(
      'SELECT max_reservas_dia FROM PARAMETRO_RESERVA WHERE id = 1',
    );
    expect(Number(fila.max_reservas_dia)).toBe(3);
  });

  it('rechaza valores sobre el tope: 400, conserva la fila y no audita', async () => {
    // Topes de negocio: semana 100, dia 31, anticipacion 365. Sin ellos,
    // un valor >= 2^32 disparaba MySQL 1264 (500) y anticipaciones
    // gigantes persistian y rompian todo POST /reservas (Invalid Date).
    const admin = await sembrarAdmin();
    await sembrarParametros();

    const cuerpos = [
      cuerpoParametros({ csrf: admin.csrf, maxReservasSemana: '101' }),
      cuerpoParametros({ csrf: admin.csrf, maxReservasSemana: '100', maxReservasDia: '32' }),
      cuerpoParametros({ csrf: admin.csrf, anticipacionDias: '366' }),
      cuerpoParametros({ csrf: admin.csrf, anticipacionDias: '200000000' }),
      cuerpoParametros({ csrf: admin.csrf, maxReservasSemana: '4294967296' }),
    ];
    for (const cuerpo of cuerpos) {
      const res = await request(createApp())
        .post('/admin/parametros')
        .set('Cookie', admin.cookie)
        .type('form')
        .send(cuerpo);
      expect(res.status).toBe(400);
    }

    const [fila] = await query<{
      max_reservas_semana: number;
      max_reservas_dia: number;
      anticipacion_dias: number;
    }>(
      'SELECT max_reservas_semana, max_reservas_dia, anticipacion_dias FROM PARAMETRO_RESERVA WHERE id = 1',
    );
    expect(Number(fila.max_reservas_semana)).toBe(7);
    expect(Number(fila.max_reservas_dia)).toBe(3);
    expect(Number(fila.anticipacion_dias)).toBe(7);

    const [{ n }] = await query<{ n: number }>(
      "SELECT COUNT(*) n FROM BITACORA WHERE accion = 'parametros.actualizar'",
    );
    expect(n).toBe(0);
  });

  it('acepta los topes exactos de negocio', async () => {
    const admin = await sembrarAdmin();
    await sembrarParametros();

    const res = await request(createApp())
      .post('/admin/parametros')
      .set('Cookie', admin.cookie)
      .type('form')
      .send(
        cuerpoParametros({
          csrf: admin.csrf,
          maxReservasSemana: '100',
          maxReservasDia: '31',
          anticipacionDias: '365',
        }),
      );

    expect(res.status).toBe(302);

    const [fila] = await query<{
      max_reservas_semana: number;
      max_reservas_dia: number;
      anticipacion_dias: number;
    }>(
      'SELECT max_reservas_semana, max_reservas_dia, anticipacion_dias FROM PARAMETRO_RESERVA WHERE id = 1',
    );
    expect(Number(fila.max_reservas_semana)).toBe(100);
    expect(Number(fila.max_reservas_dia)).toBe(31);
    expect(Number(fila.anticipacion_dias)).toBe(365);
  });

  it('exige rol ADMINISTRADOR', async () => {
    const usuarioId = randomUUID();
    await query(
      `INSERT INTO USUARIO (id, rol, nombre, correo, password_hash, estado, correo_verificado)
       VALUES (?, 'VIGILANTE', 'Vigilante', 'vig@ecc.local', 'x', 'ACTIVA', 1)`,
      [usuarioId],
    );
    const { token } = await crearSesion(usuarioId);

    const res = await request(createApp())
      .get('/admin/parametros')
      .set('Cookie', `sid=${token}`);
    expect(res.status).toBe(403);
  });
});
