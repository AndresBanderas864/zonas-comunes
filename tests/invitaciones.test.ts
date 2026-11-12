import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { derivarCsrf, hashToken } from '../src/lib/crypto';
import { crearSesion } from '../src/modules/auth/sessions';

type Admin = { cookie: string; csrf: string; usuarioId: string };

async function sembrarAdmin(): Promise<Admin> {
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

async function sembrarApartamento(torre: string, numero: string): Promise<string> {
  const id = randomUUID();
  await query(
    'INSERT INTO APARTAMENTO (id, torre_interior, numero) VALUES (?, ?, ?)',
    [id, torre, numero],
  );
  return id;
}

async function crearInvitacionPorRuta(
  admin: Admin,
  apartamentoId: string,
): Promise<{ token: string; res: request.Response }> {
  const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const res = await request(createApp())
      .post('/admin/invitaciones')
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf, apartamentoId });

    const llamada = spy.mock.calls
      .map((args) => String(args[0]))
      .find((mensaje) => mensaje.includes('/registro/'));
    expect(llamada, 'el enlace de invitacion se escribe en console.info').toBeDefined();
    const token = llamada!.match(/\/registro\/([A-Za-z0-9_-]+)/)![1]!;
    return { token, res };
  } finally {
    spy.mockRestore();
  }
}

function extraerFlash(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  const cookie = cookies.find((c) => c.startsWith('flash='));
  if (!cookie) return '';
  const valor = cookie.split(';')[0]!.slice('flash='.length);
  const mensajes = JSON.parse(decodeURIComponent(valor)) as { mensaje: string }[];
  return mensajes.map((m) => m.mensaje).join(' ');
}

const DIAS_7_MS = 7 * 24 * 60 * 60 * 1000;

describe('administracion de invitaciones', () => {
  it('crea una invitacion y devuelve el token una sola vez', async () => {
    const admin = await sembrarAdmin();
    const apartamentoId = await sembrarApartamento('A', '101');

    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    let token = '';
    let res: request.Response;
    try {
      res = await request(createApp())
        .post('/admin/invitaciones')
        .set('Cookie', admin.cookie)
        .type('form')
        .send({ _csrf: admin.csrf, apartamentoId });

      const llamada = spy.mock.calls
        .map((args) => String(args[0]))
        .find((m) => m.includes('/registro/'));
      expect(llamada).toBeDefined();
      token = llamada!.match(/\/registro\/([A-Za-z0-9_-]+)/)![1]!;
    } finally {
      spy.mockRestore();
    }

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/invitaciones');

    const [invitacion] = await query<{
      token_hash: string;
      estado: string;
      creada_por: string;
      vence_en: Date;
    }>(
      'SELECT token_hash, estado, creada_por, vence_en FROM INVITACION WHERE apartamento_id = ?',
      [apartamentoId],
    );
    expect(invitacion).toBeDefined();
    expect(invitacion.token_hash).not.toBe(token);
    expect(invitacion.token_hash).toBe(hashToken(token));
    expect(invitacion.estado).toBe('VIGENTE');
    expect(invitacion.creada_por).toBe(admin.usuarioId);

    const vigencia = new Date(invitacion.vence_en).getTime() - Date.now();
    expect(vigencia).toBeGreaterThan(DIAS_7_MS - 60_000);
    expect(vigencia).toBeLessThanOrEqual(DIAS_7_MS + 60_000);

    const registro = await request(createApp()).get(`/registro/${token}`);
    expect(registro.status).toBe(200);

    const flash = extraerFlash(res.headers['set-cookie']);
    expect(flash).toContain(`/registro/${token}`);

    const listado = await request(createApp())
      .get('/admin/invitaciones')
      .set('Cookie', admin.cookie);
    expect(listado.status).toBe(200);
    expect(listado.text).not.toContain(token);
    expect(listado.text).not.toContain(hashToken(token));
  });

  it('una invitacion revocada no permite registrarse', async () => {
    const admin = await sembrarAdmin();
    const apartamentoId = await sembrarApartamento('A', '101');
    const { token, res } = await crearInvitacionPorRuta(admin, apartamentoId);
    expect(res.status).toBe(302);

    const [invitacion] = await query<{ id: string }>(
      'SELECT id FROM INVITACION WHERE apartamento_id = ?',
      [apartamentoId],
    );

    const revocada = await request(createApp())
      .post(`/admin/invitaciones/${invitacion.id}/revocar`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf });
    expect(revocada.status).toBe(302);

    const [despues] = await query<{ estado: string }>(
      'SELECT estado FROM INVITACION WHERE id = ?',
      [invitacion.id],
    );
    expect(despues.estado).toBe('REVOCADA');

    const getRegistro = await request(createApp()).get(`/registro/${token}`);
    expect(getRegistro.status).toBe(400);

    const postRegistro = await request(createApp())
      .post(`/registro/${token}`)
      .type('form')
      .send({ nombre: 'Nuevo', correo: 'nuevo@ecc.local', password: 'Demo1234!' });
    expect(postRegistro.status).toBe(400);

    const [bitacora] = await query<{ accion: string; entidad: string }>(
      "SELECT accion, entidad FROM BITACORA WHERE accion = 'invitacion.revocar'",
    );
    expect(bitacora).toBeDefined();
  });

  it('la lista muestra solo estado y vencimiento, nunca el token', async () => {
    const admin = await sembrarAdmin();
    const apto1 = await sembrarApartamento('A', '101');
    const apto2 = await sembrarApartamento('B', '202');

    const { token: token1 } = await crearInvitacionPorRuta(admin, apto1);
    const { token: token2 } = await crearInvitacionPorRuta(admin, apto2);

    const [inv1] = await query<{ id: string }>(
      'SELECT id FROM INVITACION WHERE apartamento_id = ?',
      [apto1],
    );

    await request(createApp())
      .post(`/admin/invitaciones/${inv1.id}/revocar`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf });

    const listado = await request(createApp())
      .get('/admin/invitaciones')
      .set('Cookie', admin.cookie);

    expect(listado.status).toBe(200);
    expect(listado.text).toContain('name="apartamentoId"');
    expect(listado.text).toContain('REVOCADA');
    expect(listado.text).toContain('VIGENTE');
    expect(listado.text).not.toContain(token1);
    expect(listado.text).not.toContain(token2);
    expect(listado.text).not.toContain(hashToken(token1));
  });

  it('rechaza crear invitaciones invalidas sin escribir filas', async () => {
    const admin = await sembrarAdmin();

    const vacio = await request(createApp())
      .post('/admin/invitaciones')
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf, apartamentoId: '' });
    expect(vacio.status).toBe(400);

    const inexistente = await request(createApp())
      .post('/admin/invitaciones')
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf, apartamentoId: randomUUID() });
    expect(inexistente.status).toBe(404);

    const [{ n }] = await query<{ n: number }>('SELECT COUNT(*) n FROM INVITACION');
    expect(n).toBe(0);
  });

  it('no permite revocar dos veces ni invitaciones inexistentes', async () => {
    const admin = await sembrarAdmin();
    const apartamentoId = await sembrarApartamento('A', '101');
    const { res } = await crearInvitacionPorRuta(admin, apartamentoId);
    expect(res.status).toBe(302);

    const [invitacion] = await query<{ id: string }>(
      'SELECT id FROM INVITACION WHERE apartamento_id = ?',
      [apartamentoId],
    );

    await request(createApp())
      .post(`/admin/invitaciones/${invitacion.id}/revocar`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf });

    const doble = await request(createApp())
      .post(`/admin/invitaciones/${invitacion.id}/revocar`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf });
    expect(doble.status).toBe(409);

    const inexistente = await request(createApp())
      .post(`/admin/invitaciones/${randomUUID()}/revocar`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf });
    expect(inexistente.status).toBe(404);
  });
});
