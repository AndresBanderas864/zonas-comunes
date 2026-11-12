import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { derivarCsrf } from '../src/lib/crypto';
import { ConflictError } from '../src/lib/errors';
import { crearSesion } from '../src/modules/auth/sessions';
import type { UsuarioSesion } from '../src/modules/auth/sessions';
import { desactivarUsuario } from '../src/modules/usuarios/service';

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

async function sembrarResidente(): Promise<{
  usuarioId: string;
  cookie: string;
  apartamentoId: string;
}> {
  const apartamentoId = randomUUID();
  await query(
    'INSERT INTO APARTAMENTO (id, torre_interior, numero) VALUES (?, ?, ?)',
    [apartamentoId, 'A', '101'],
  );

  const usuarioId = randomUUID();
  await query(
    `INSERT INTO USUARIO (id, rol, apartamento_id, nombre, correo, password_hash, estado, correo_verificado)
     VALUES (?, 'RESIDENTE', ?, 'Residente Uno', 'res1@ecc.local', 'x', 'ACTIVA', 1)`,
    [usuarioId, apartamentoId],
  );

  const { token } = await crearSesion(usuarioId);
  return { usuarioId, cookie: `sid=${token}`, apartamentoId };
}

describe('administracion de usuarios', () => {
  it('desactivar un usuario revoca sus sesiones y deja BITACORA', async () => {
    const admin = await sembrarAdmin();
    const residente = await sembrarResidente();

    const res = await request(createApp())
      .post(`/admin/usuarios/${residente.usuarioId}/desactivar`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/usuarios');

    const [usuario] = await query<{ estado: string }>(
      'SELECT estado FROM USUARIO WHERE id = ?',
      [residente.usuarioId],
    );
    expect(usuario.estado).toBe('DESACTIVADA');

    const [{ n }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM SESION WHERE usuario_id = ? AND revocada_en IS NOT NULL',
      [residente.usuarioId],
    );
    expect(n).toBe(1);

    const conCookieVieja = await request(createApp())
      .get('/admin/usuarios')
      .set('Cookie', residente.cookie);
    expect(conCookieVieja.status).toBe(302);
    expect(conCookieVieja.headers.location).toBe('/login');

    const [bitacora] = await query<{
      accion: string;
      entidad: string;
      entidad_id: string;
      usuario_id: string;
    }>(
      "SELECT accion, entidad, entidad_id, usuario_id FROM BITACORA WHERE accion = 'usuario.desactivar'",
    );
    expect(bitacora.entidad).toBe('USUARIO');
    expect(bitacora.entidad_id).toBe(residente.usuarioId);
    expect(bitacora.usuario_id).toBe(admin.usuarioId);
  });

  it('no permite desactivarse a si mismo', async () => {
    const admin = await sembrarAdmin();

    const res = await request(createApp())
      .post(`/admin/usuarios/${admin.usuarioId}/desactivar`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf });

    expect(res.status).toBe(409);

    const [usuario] = await query<{ estado: string }>(
      'SELECT estado FROM USUARIO WHERE id = ?',
      [admin.usuarioId],
    );
    expect(usuario.estado).toBe('ACTIVA');
  });

  it('no deja el sistema sin administradores activos', async () => {
    const admin = await sembrarAdmin();

    const vigilanteId = randomUUID();
    await query(
      `INSERT INTO USUARIO (id, rol, nombre, correo, password_hash, estado, correo_verificado)
       VALUES (?, 'VIGILANTE', 'Vigilante', 'vig@ecc.local', 'x', 'ACTIVA', 1)`,
      [vigilanteId],
    );

    const actor: UsuarioSesion = {
      id: vigilanteId,
      rol: 'VIGILANTE',
      apartamentoId: null,
      nombre: 'Vigilante',
      correo: 'vig@ecc.local',
      correoVerificado: true,
    };

    await expect(desactivarUsuario(admin.usuarioId, actor)).rejects.toBeInstanceOf(
      ConflictError,
    );

    const [usuario] = await query<{ estado: string }>(
      'SELECT estado FROM USUARIO WHERE id = ?',
      [admin.usuarioId],
    );
    expect(usuario.estado).toBe('ACTIVA');
  });

  it('un residente recibe 403 en /admin/usuarios y /admin/invitaciones', async () => {
    const residente = await sembrarResidente();

    const usuarios = await request(createApp())
      .get('/admin/usuarios')
      .set('Cookie', residente.cookie);
    expect(usuarios.status).toBe(403);

    const invitaciones = await request(createApp())
      .get('/admin/invitaciones')
      .set('Cookie', residente.cookie);
    expect(invitaciones.status).toBe(403);
  });

  it('lista usuarios y rechaza desactivar un id inexistente', async () => {
    const admin = await sembrarAdmin();
    await sembrarResidente();

    const listado = await request(createApp())
      .get('/admin/usuarios')
      .set('Cookie', admin.cookie);
    expect(listado.status).toBe(200);
    expect(listado.text).toContain('admin@ecc.local');
    expect(listado.text).toContain('res1@ecc.local');
    expect(listado.text).toContain('ADMINISTRADOR');

    const res = await request(createApp())
      .post(`/admin/usuarios/${randomUUID()}/desactivar`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf });
    expect(res.status).toBe(404);

    const [{ n }] = await query<{ n: number }>(
      "SELECT COUNT(*) n FROM BITACORA WHERE accion = 'usuario.desactivar'",
    );
    expect(n).toBe(0);
  });
});
