import { describe, expect, it } from 'vitest';
import { pool, query } from '../src/db/pool';
import { runSeed } from '../src/db/seed';

describe('seed', () => {
  it('siembra una vez y no duplica al repetir', async () => {
    await runSeed(pool);
    await runSeed(pool);

    const [{ n }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM APARTAMENTO',
    );
    expect(n).toBe(12);

    const [{ z }] = await query<{ z: number }>('SELECT COUNT(*) z FROM ZONA');
    expect(z).toBe(5);

    const [{ u }] = await query<{ u: number }>('SELECT COUNT(*) u FROM USUARIO');
    expect(u).toBe(10);

    const [{ h }] = await query<{ h: number }>(
      'SELECT COUNT(*) h FROM HORARIO_ZONA',
    );
    expect(h).toBe(35);

    const [{ p }] = await query<{ p: number }>(
      'SELECT COUNT(*) p FROM PARAMETRO_RESERVA',
    );
    expect(p).toBe(1);

    const [{ t }] = await query<{ t: number }>(
      'SELECT COUNT(*) t FROM TEXTO_LEGAL',
    );
    expect(t).toBe(3);
  });
});
