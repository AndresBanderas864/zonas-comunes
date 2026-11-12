import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { hashPassword, hashToken } from '../src/lib/crypto';
import { validarSesion } from '../src/modules/auth/sessions';

const CORREO = 'residente@ecc.local';
const PASSWORD = 'Demo1234!';

async function sembrarUsuario(estado = 'ACTIVA'): Promise<string> {
  const apartamentoId = randomUUID();
  const usuarioId = randomUUID();

  await query(
    'INSERT INTO APARTAMENTO (id, torre_interior, numero) VALUES (?, ?, ?)',
    [apartamentoId, 'A', '101'],
  );
  await query(
    `INSERT INTO USUARIO
       (id, rol, apartamento_id, nombre, correo, password_hash, estado, correo_verificado)
     VALUES (?, 'RESIDENTE', ?, 'Residente', ?, ?, ?, 1)`,
    [usuarioId, apartamentoId, CORREO, await hashPassword(PASSWORD), estado],
  );

  return usuarioId;
}

function tokenDeCookie(res: request.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[];
  const sid = cookies.find((cookie) => cookie.startsWith('sid='));
  if (!sid) throw new Error('No se encontro la cookie sid');
  return sid.split(';')[0].slice('sid='.length);
}

describe('login y sesiones', () => {
  it('login correcto crea SESION y cookie httpOnly', async () => {
    await sembrarUsuario();
    const res = await request(createApp())
      .post('/login')
      .type('form')
      .send({ correo: CORREO, password: PASSWORD });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const sid = cookies.find((cookie) => cookie.startsWith('sid='));
    expect(sid).toBeDefined();
    expect(sid).toContain('HttpOnly');
    expect(sid).toContain('SameSite=Lax');
    expect(sid).toContain('Path=/');
    expect(sid).toContain('Max-Age=2592000');

    const [{ n }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM SESION WHERE revocada_en IS NULL',
    );
    expect(n).toBe(1);
  });

  it('login incorrecto no revela si el correo existe', async () => {
    await sembrarUsuario();

    const existente = await request(createApp())
      .post('/login')
      .type('form')
      .send({ correo: CORREO, password: 'incorrecta' });
    const inexistente = await request(createApp())
      .post('/login')
      .type('form')
      .send({ correo: 'nadie@ecc.local', password: 'incorrecta' });

    expect(existente.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(existente.text).toContain('Correo o contraseña incorrectos');
    expect(inexistente.text).toContain('Correo o contraseña incorrectos');
  });

  it('cinco fallos bloquean la cuenta 15 minutos', async () => {
    await sembrarUsuario();

    for (let intento = 0; intento < 5; intento++) {
      const res = await request(createApp())
        .post('/login')
        .type('form')
        .send({ correo: CORREO, password: 'incorrecta' });
      expect(res.status).toBe(401);
    }

    const bloqueado = await request(createApp())
      .post('/login')
      .type('form')
      .send({ correo: CORREO, password: PASSWORD });

    expect(bloqueado.status).toBe(429);
    expect(bloqueado.text).toContain('bloqueada');

    const [usuario] = await query<{ bloqueado_hasta: Date | null }>(
      'SELECT bloqueado_hasta FROM USUARIO WHERE correo = ?',
      [CORREO],
    );
    expect(usuario.bloqueado_hasta).not.toBeNull();
  });

  it('logout revoca la sesion y la cookie ya no sirve', async () => {
    await sembrarUsuario();
    const login = await request(createApp())
      .post('/login')
      .type('form')
      .send({ correo: CORREO, password: PASSWORD });
    const token = tokenDeCookie(login);

    const logout = await request(createApp())
      .post('/logout')
      .set('Cookie', `sid=${token}`);
    expect(logout.status).toBe(302);
    expect(logout.headers.location).toBe('/login');

    await expect(validarSesion(token)).resolves.toBeNull();
  });

  it('una sesion con mas de 30 dias sin uso no vale', async () => {
    const usuarioId = await sembrarUsuario();
    const token = 'token-sesion-vieja';
    // El lector (validarSesion) compara ultimo_uso contra UTC_TIMESTAMP(3):
    // el seed escribe en la misma convencion UTC, no NOW(3) (hora local de
    // Bogota en el contenedor).
    await query(
      `INSERT INTO SESION (id, usuario_id, token_hash, ultimo_uso)
       VALUES (?, ?, ?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 31 DAY))`,
      [randomUUID(), usuarioId, hashToken(token)],
    );

    await expect(validarSesion(token)).resolves.toBeNull();
  });

  it('una cuenta desactivada no puede iniciar sesion', async () => {
    await sembrarUsuario('DESACTIVADA');
    const res = await request(createApp())
      .post('/login')
      .type('form')
      .send({ correo: CORREO, password: PASSWORD });
    expect(res.status).toBe(403);
  });
});
