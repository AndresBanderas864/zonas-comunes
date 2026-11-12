import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { hashPassword, hashToken } from '../src/lib/crypto';

const CORREO = 'residente@ecc.local';
const PASSWORD = 'Demo1234!';
const NUEVA = 'Nueva1234!';

async function sembrarUsuario(): Promise<string> {
  const apartamentoId = randomUUID();
  const usuarioId = randomUUID();

  await query(
    'INSERT INTO APARTAMENTO (id, torre_interior, numero) VALUES (?, ?, ?)',
    [apartamentoId, 'A', '101'],
  );
  await query(
    `INSERT INTO USUARIO
       (id, rol, apartamento_id, nombre, correo, password_hash, estado, correo_verificado)
     VALUES (?, 'RESIDENTE', ?, 'Residente', ?, ?, 'ACTIVA', 1)`,
    [usuarioId, apartamentoId, CORREO, await hashPassword(PASSWORD)],
  );

  return usuarioId;
}

async function sembrarToken(
  usuarioId: string,
  opciones: { venceEn?: Date; usadoEn?: Date | null } = {},
): Promise<string> {
  const token = `rec-${randomUUID()}`;
  await query(
    `INSERT INTO TOKEN_VERIFICACION (id, usuario_id, tipo, token_hash, vence_en, usado_en)
     VALUES (?, ?, 'RESTABLECER_PASSWORD', ?, ?, ?)`,
    [
      randomUUID(),
      usuarioId,
      hashToken(token),
      opciones.venceEn ?? new Date(Date.now() + 60 * 60 * 1000),
      opciones.usadoEn ?? null,
    ],
  );
  return token;
}

function enlaceEnLog(spy: { mock: { calls: unknown[][] } }): string | undefined {
  return spy.mock.calls
    .map((args: unknown[]) => String(args[0]))
    .find((mensaje: string) => mensaje.includes('/restablecer/'));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recuperacion de contrasena', () => {
  it('correo inexistente responde igual que uno existente', async () => {
    await sembrarUsuario();
    const existente = await request(createApp())
      .post('/recuperar')
      .type('form')
      .send({ correo: CORREO });
    const inexistente = await request(createApp())
      .post('/recuperar')
      .type('form')
      .send({ correo: 'nadie@ecc.local' });

    expect(existente.status).toBe(200);
    expect(inexistente.status).toBe(200);
    expect(existente.text).toContain('Si el correo está registrado');
    expect(inexistente.text).toBe(existente.text);
  });

  it('la respuesta HTTP nunca incluye el token', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await sembrarUsuario();

    const res = await request(createApp())
      .post('/recuperar')
      .type('form')
      .send({ correo: CORREO });

    const enlace = enlaceEnLog(spy);
    expect(enlace).toBeDefined();
    const token = enlace!.match(/\/restablecer\/([A-Za-z0-9_-]+)/)![1];
    expect(res.text).not.toContain(token);
    expect(res.text).not.toContain('/restablecer/');
  });

  it('token válido cambia el hash y queda usado', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await sembrarUsuario();

    await request(createApp())
      .post('/recuperar')
      .type('form')
      .send({ correo: CORREO });

    const enlace = enlaceEnLog(spy);
    expect(enlace).toBeDefined();
    const token = enlace!.match(/\/restablecer\/([A-Za-z0-9_-]+)/)![1];

    const res = await request(createApp())
      .post(`/restablecer/${token}`)
      .type('form')
      .send({ password: NUEVA });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');

    const nuevo = await request(createApp())
      .post('/login')
      .type('form')
      .send({ correo: CORREO, password: NUEVA });
    expect(nuevo.status).toBe(302);

    const viejo = await request(createApp())
      .post('/login')
      .type('form')
      .send({ correo: CORREO, password: PASSWORD });
    expect(viejo.status).toBe(401);

    const [fila] = await query<{ usado_en: Date | null }>(
      `SELECT usado_en FROM TOKEN_VERIFICACION
       WHERE token_hash = ? AND tipo = 'RESTABLECER_PASSWORD'`,
      [hashToken(token)],
    );
    expect(fila.usado_en).not.toBeNull();
  });

  it('token caducado se rechaza', async () => {
    const usuarioId = await sembrarUsuario();
    const token = await sembrarToken(usuarioId, {
      venceEn: new Date(Date.now() - 60_000),
    });

    const res = await request(createApp())
      .post(`/restablecer/${token}`)
      .type('form')
      .send({ password: NUEVA });
    expect(res.status).toBe(400);

    const login = await request(createApp())
      .post('/login')
      .type('form')
      .send({ correo: CORREO, password: PASSWORD });
    expect(login.status).toBe(302);
  });

  it('token usado se rechaza', async () => {
    const usuarioId = await sembrarUsuario();
    const token = await sembrarToken(usuarioId, { usadoEn: new Date() });

    const res = await request(createApp())
      .post(`/restablecer/${token}`)
      .type('form')
      .send({ password: NUEVA });
    expect(res.status).toBe(400);
  });

  it('un token no puede usarse dos veces', async () => {
    const usuarioId = await sembrarUsuario();
    const token = await sembrarToken(usuarioId);

    const primera = await request(createApp())
      .post(`/restablecer/${token}`)
      .type('form')
      .send({ password: NUEVA });
    expect(primera.status).toBe(302);

    const segunda = await request(createApp())
      .post(`/restablecer/${token}`)
      .type('form')
      .send({ password: 'Otra12345!' });
    expect(segunda.status).toBe(400);
  });

  it('contrasena nueva demasiado corta se rechaza sin consumir el token', async () => {
    const usuarioId = await sembrarUsuario();
    const token = await sembrarToken(usuarioId);

    const corta = await request(createApp())
      .post(`/restablecer/${token}`)
      .type('form')
      .send({ password: 'corta' });
    expect(corta.status).toBe(400);

    const valida = await request(createApp())
      .post(`/restablecer/${token}`)
      .type('form')
      .send({ password: NUEVA });
    expect(valida.status).toBe(302);
  });
});
