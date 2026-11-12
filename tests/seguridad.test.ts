import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { parseEnv } from '../src/config/env';
import { query } from '../src/db/pool';
import { hashPassword } from '../src/lib/crypto';

const CORREO = 'residente@ecc.local';
const PASSWORD = 'Demo1234!';

async function sembrarUsuario(): Promise<void> {
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
}

function baseEnv(extras: Record<string, string>): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'mysql://root:root@localhost:3306/ecc',
    NODE_ENV: 'test',
    ...extras,
  };
}

describe('endurecimiento (RNF-08..14)', () => {
  it('helmet: cabeceras de seguridad presentes en las respuestas', async () => {
    const res = await request(createApp()).get('/login');

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();

    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('el intento 11 de login en 15 minutos devuelve 429', async () => {
    const app = createApp();

    for (let intento = 0; intento < 10; intento++) {
      const res = await request(app)
        .post('/login')
        .type('form')
        .send({ correo: 'nadie@ecc.local', password: 'incorrecta' });
      expect(res.status).toBe(401);
    }

    const undecimo = await request(app)
      .post('/login')
      .type('form')
      .send({ correo: 'nadie@ecc.local', password: 'incorrecta' });

    expect(undecimo.status).toBe(429);
    expect(undecimo.body.error.code).toBe('RATE_LIMIT');
  });

  it('POST /recuperar esta limitado por IP: el 6to intento en 15 min devuelve 429', async () => {
    const app = createApp();

    for (let intento = 0; intento < 5; intento++) {
      const res = await request(app)
        .post('/recuperar')
        .type('form')
        .send({ correo: 'desconocido@ecc.local' });
      expect(res.status).toBe(200);
    }

    const sexto = await request(app)
      .post('/recuperar')
      .type('form')
      .send({ correo: 'desconocido@ecc.local' });

    expect(sexto.status).toBe(429);
    expect(sexto.body.error.code).toBe('RATE_LIMIT');
  });

  it('SESSION_SECRET de menos de 32 caracteres impide arrancar', () => {
    expect(() => parseEnv(baseEnv({ SESSION_SECRET: 'corto' }))).toThrow(
      /SESSION_SECRET/,
    );
    expect(() =>
      parseEnv(baseEnv({ SESSION_SECRET: 'x'.repeat(31) })),
    ).toThrow(/SESSION_SECRET/);

    expect(() =>
      parseEnv(baseEnv({ SESSION_SECRET: 'x'.repeat(32) })),
    ).not.toThrow();
  });

  it('la cookie sid incluye Secure en produccion y no en test', async () => {
    await sembrarUsuario();

    const enTest = await request(createApp())
      .post('/login')
      .type('form')
      .send({ correo: CORREO, password: PASSWORD });
    expect(enTest.status).toBe(302);
    const cookieTest = (enTest.headers['set-cookie'] as unknown as string[]).find(
      (cookie) => cookie.startsWith('sid='),
    );
    expect(cookieTest).toBeDefined();
    expect(cookieTest).not.toContain('Secure');

    const previo = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const enProduccion = await request(createApp())
        .post('/login')
        .type('form')
        .send({ correo: CORREO, password: PASSWORD });
      expect(enProduccion.status).toBe(302);
      const cookieProd = (
        enProduccion.headers['set-cookie'] as unknown as string[]
      ).find((cookie) => cookie.startsWith('sid='));
      expect(cookieProd).toContain('Secure');
      expect(cookieProd).toContain('HttpOnly');
      expect(cookieProd).toContain('SameSite=Lax');
    } finally {
      process.env.NODE_ENV = previo;
    }
  });
});
