import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { derivarCsrf } from '../src/lib/crypto';
import { crearSesion } from '../src/modules/auth/sessions';
import type { Rol } from '../src/lib/types';

async function crearUsuarioConSesion(
  rol: Rol,
): Promise<{ token: string; cookie: string }> {
  const usuarioId = randomUUID();
  let apartamentoId: string | null = null;

  if (rol === 'RESIDENTE') {
    apartamentoId = randomUUID();
    await query(
      'INSERT INTO APARTAMENTO (id, torre_interior, numero) VALUES (?, ?, ?)',
      [apartamentoId, 'A', '101'],
    );
  }

  await query(
    `INSERT INTO USUARIO
       (id, rol, apartamento_id, nombre, correo, password_hash, estado, correo_verificado)
     VALUES (?, ?, ?, ?, ?, 'x', 'ACTIVA', 1)`,
    [
      usuarioId,
      rol,
      apartamentoId,
      `Usuario ${rol}`,
      `${rol.toLowerCase()}@ecc.local`,
    ],
  );

  const { token } = await crearSesion(usuarioId);
  return { token, cookie: `sid=${token}` };
}

describe('autenticacion, roles y CSRF', () => {
  it('sin sesion, GET / devuelve 302 a /login', async () => {
    const res = await request(createApp()).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('GET / redirige a cada rol a su inicio', async () => {
    const residente = await crearUsuarioConSesion('RESIDENTE');
    const admin = await crearUsuarioConSesion('ADMINISTRADOR');
    const vigilante = await crearUsuarioConSesion('VIGILANTE');

    const casos = [
      { cookie: residente.cookie, destino: '/reservar' },
      { cookie: admin.cookie, destino: '/admin/zonas' },
      { cookie: vigilante.cookie, destino: '/vigilancia' },
    ];

    for (const caso of casos) {
      const res = await request(createApp())
        .get('/')
        .set('Cookie', caso.cookie);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(caso.destino);
    }
  });

  it('un residente recibe 403 en POST /admin/zonas', async () => {
    const residente = await crearUsuarioConSesion('RESIDENTE');
    const res = await request(createApp())
      .post('/admin/zonas')
      .set('Cookie', residente.cookie)
      .send({});
    expect(res.status).toBe(403);
  });

  it('un POST sin token CSRF se rechaza con 403', async () => {
    const residente = await crearUsuarioConSesion('RESIDENTE');
    const res = await request(createApp())
      .post('/reservas')
      .set('Cookie', residente.cookie)
      .send({});
    expect(res.status).toBe(403);
  });

  it('un POST con token CSRF valido pasa al enrutador', async () => {
    const residente = await crearUsuarioConSesion('RESIDENTE');
    const csrf = derivarCsrf(
      residente.token,
      process.env.SESSION_SECRET as string,
    );
    const res = await request(createApp())
      .post('/reservas')
      .set('Cookie', residente.cookie)
      .send({ _csrf: csrf });
    // Pasa el filtro CSRF y llega al enrutador de reservas, que responde 400
    // por validacion (antes de montar el enrutador el request caia en 404).
    expect(res.status).toBe(400);
  });

  it('con sesion revocada a mitad de un POST responde 401 y redirige a /login', async () => {
    const residente = await crearUsuarioConSesion('RESIDENTE');
    const [sesion] = await query<{ id: string }>(
      'SELECT id FROM SESION WHERE token_hash IS NOT NULL ORDER BY creada_en DESC LIMIT 1',
    );
    await query('UPDATE SESION SET revocada_en = NOW(3) WHERE id = ?', [sesion.id]);

    const res = await request(createApp())
      .post('/reservas')
      .set('Cookie', residente.cookie)
      .send({});
    expect(res.status).toBe(401);
    expect(res.headers.location).toBe('/login');
  });
});
