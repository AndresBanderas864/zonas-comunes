import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { hashPassword, hashToken, verifyPassword } from '../src/lib/crypto';

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

  it('al pedir un nuevo token, el anterior queda invalidado', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await sembrarUsuario();

    await request(createApp()).post('/recuperar').type('form').send({ correo: CORREO });
    await request(createApp()).post('/recuperar').type('form').send({ correo: CORREO });

    const tokens = spy.mock.calls
      .map((args: unknown[]) => String(args[0]))
      .filter((mensaje: string) => mensaje.includes('/restablecer/'))
      .map((mensaje: string) => mensaje.match(/\/restablecer\/([A-Za-z0-9_-]+)/)![1]);
    expect(tokens).toHaveLength(2);
    const [primero, segundo] = tokens;

    const rechazado = await request(createApp())
      .post(`/restablecer/${primero}`)
      .type('form')
      .send({ password: NUEVA });
    expect(rechazado.status).toBe(400);

    const aceptado = await request(createApp())
      .post(`/restablecer/${segundo}`)
      .type('form')
      .send({ password: NUEVA });
    expect(aceptado.status).toBe(302);
  });

  it('restablecer la contrasena revoca sesiones abiertas y limpia el bloqueo', async () => {
    const usuarioId = await sembrarUsuario();
    const tokenSesion = 'sesion-abierta';
    await query(
      'INSERT INTO SESION (id, usuario_id, token_hash) VALUES (?, ?, ?)',
      [randomUUID(), usuarioId, hashToken(tokenSesion)],
    );
    await query(
      `UPDATE USUARIO SET intentos_fallidos = 5,
         bloqueado_hasta = DATE_ADD(NOW(3), INTERVAL 15 MINUTE)
       WHERE id = ?`,
      [usuarioId],
    );
    const token = await sembrarToken(usuarioId);

    const res = await request(createApp())
      .post(`/restablecer/${token}`)
      .type('form')
      .send({ password: NUEVA });
    expect(res.status).toBe(302);

    const [sesion] = await query<{ revocada_en: Date | null }>(
      'SELECT revocada_en FROM SESION WHERE token_hash = ?',
      [hashToken(tokenSesion)],
    );
    expect(sesion.revocada_en).not.toBeNull();

    const [usuario] = await query<{
      bloqueado_hasta: Date | null;
      intentos_fallidos: number;
    }>('SELECT bloqueado_hasta, intentos_fallidos FROM USUARIO WHERE id = ?', [
      usuarioId,
    ]);
    expect(usuario.bloqueado_hasta).toBeNull();
    expect(Number(usuario.intentos_fallidos)).toBe(0);
  });

  it.each(['DESACTIVADA', 'BAJA'])(
    'una cuenta %s no puede restablecer la contrasena',
    async (estado) => {
      const usuarioId = await sembrarUsuario();
      const token = await sembrarToken(usuarioId);
      await query('UPDATE USUARIO SET estado = ? WHERE id = ?', [estado, usuarioId]);

      const getRes = await request(createApp()).get(`/restablecer/${token}`);
      expect(getRes.status).toBe(400);

      const res = await request(createApp())
        .post(`/restablecer/${token}`)
        .type('form')
        .send({ password: NUEVA });
      expect(res.status).toBe(400);

      const [usuario] = await query<{ password_hash: string }>(
        'SELECT password_hash FROM USUARIO WHERE id = ?',
        [usuarioId],
      );
      await expect(verifyPassword(usuario.password_hash, PASSWORD)).resolves.toBe(true);
    },
  );

  it('POST /recuperar con correo malformado responde 400 con mensaje en espanol', async () => {
    await sembrarUsuario();
    const res = await request(createApp())
      .post('/recuperar')
      .type('form')
      .send({ correo: 'no-es-un-correo' });

    expect(res.status).toBe(400);
    expect(res.text).toContain('El correo no es válido');
  });

  it('POST /recuperar con correo bien formado pero desconocido responde el aviso generico', async () => {
    const res = await request(createApp())
      .post('/recuperar')
      .type('form')
      .send({ correo: 'desconocido@ecc.local' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Si el correo está registrado');
  });
});
