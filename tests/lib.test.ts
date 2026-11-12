import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { parseEnv } from '../src/config/env';
import {
  derivarCsrf,
  generarToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../src/lib/crypto';

describe('configuracion', () => {
  it('rechaza un env sin DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow();
  });

  it('acepta un env completo y aplica valores por defecto', () => {
    const env = parseEnv({
      DATABASE_URL: 'mysql://ecc:ecc@localhost:3306/ecc',
      SESSION_SECRET: 'un-secreto-suficientemente-largo',
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
  });
});

describe('criptografia', () => {
  it('hashToken es determinista y no reversible en el valor', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toContain('abc');
    expect(hashToken('abc')).toHaveLength(64);
  });

  it('generarToken produce valores distintos', () => {
    expect(generarToken()).not.toBe(generarToken());
  });

  it('hashPassword y verifyPassword se corresponden', async () => {
    const hash = await hashPassword('Demo1234!');
    expect(hash).not.toContain('Demo1234!');
    await expect(verifyPassword(hash, 'Demo1234!')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'otra')).resolves.toBe(false);
  });

  it('derivarCsrf es deterministico y depende del secreto', () => {
    expect(derivarCsrf('token', 'secreto')).toBe(derivarCsrf('token', 'secreto'));
    expect(derivarCsrf('token', 'secreto')).not.toBe(
      derivarCsrf('token', 'otro-secreto'),
    );
  });
});

describe('manejador de errores', () => {
  it('AppError 409 se serializa como conflicto', async () => {
    const res = await request(createApp()).get('/_test/conflict');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICTO');
  });
});
