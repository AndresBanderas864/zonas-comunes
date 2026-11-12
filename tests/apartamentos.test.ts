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

async function sembrarApartamento(
  torreInterior: string,
  numero: string,
): Promise<string> {
  const id = randomUUID();
  await query(
    'INSERT INTO APARTAMENTO (id, torre_interior, numero) VALUES (?, ?, ?)',
    [id, torreInterior, numero],
  );
  return id;
}

async function sembrarResidenteEn(apartamentoId: string): Promise<string> {
  const usuarioId = randomUUID();
  await query(
    `INSERT INTO USUARIO (id, rol, apartamento_id, nombre, correo, password_hash, estado, correo_verificado)
     VALUES (?, 'RESIDENTE', ?, 'Residente', 'res@ecc.local', 'x', 'ACTIVA', 1)`,
    [usuarioId, apartamentoId],
  );
  return usuarioId;
}

async function sembrarReservaEn(apartamentoId: string): Promise<string> {
  const zonaId = randomUUID();
  await query(
    `INSERT INTO ZONA (id, nombre, aforo, duracion_bloque_min, max_cupos_reserva, activa)
     VALUES (?, 'BBQ', 12, 240, 4, 1)`,
    [zonaId],
  );
  const reservaId = randomUUID();
  await query(
    `INSERT INTO RESERVA (id, apartamento_id, zona_id, fecha, hora_inicio, hora_fin, cupos, estado)
     VALUES (?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '10:00:00', '14:00:00', 2, 'CONFIRMADA')`,
    [reservaId, apartamentoId, zonaId],
  );
  return reservaId;
}

describe('administracion de apartamentos', () => {
  it('crea un apartamento y rechaza torre+numero duplicado', async () => {
    const admin = await sembrarAdmin();

    const creado = await request(createApp())
      .post('/admin/apartamentos')
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf, torreInterior: 'A', numero: '101' });

    expect(creado.status).toBe(302);
    expect(creado.headers.location).toBe('/admin/apartamentos');

    const [fila] = await query<{ id: string }>(
      'SELECT id FROM APARTAMENTO WHERE torre_interior = ? AND numero = ?',
      ['A', '101'],
    );
    expect(fila).toBeDefined();

    const duplicado = await request(createApp())
      .post('/admin/apartamentos')
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf, torreInterior: 'A', numero: '101' });

    expect(duplicado.status).toBe(409);

    const [{ n }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM APARTAMENTO WHERE torre_interior = ? AND numero = ?',
      ['A', '101'],
    );
    expect(n).toBe(1);

    const [bitacora] = await query<{ accion: string; entidad: string; entidad_id: string }>(
      "SELECT accion, entidad, entidad_id FROM BITACORA WHERE entidad = 'APARTAMENTO'",
    );
    expect(bitacora.accion).toBe('apartamento.crear');
    expect(bitacora.entidad_id).toBe(fila.id);
  });

  it('rechaza torre o numero vacios y conserva la entrada', async () => {
    const admin = await sembrarAdmin();

    const res = await request(createApp())
      .post('/admin/apartamentos')
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf, torreInterior: '', numero: '101' });

    expect(res.status).toBe(400);

    const [{ n }] = await query<{ n: number }>('SELECT COUNT(*) n FROM APARTAMENTO');
    expect(n).toBe(0);
  });

  it('actualiza un apartamento y rechaza el duplicado en PUT-style', async () => {
    const admin = await sembrarAdmin();
    const primero = await sembrarApartamento('A', '101');
    const segundo = await sembrarApartamento('B', '202');

    const ok = await request(createApp())
      .post(`/admin/apartamentos/${primero}`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf, torreInterior: 'A', numero: '105' });
    expect(ok.status).toBe(302);

    const [fila] = await query<{ numero: string }>(
      'SELECT numero FROM APARTAMENTO WHERE id = ?',
      [primero],
    );
    expect(fila.numero).toBe('105');

    const conflicto = await request(createApp())
      .post(`/admin/apartamentos/${primero}`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf, torreInterior: 'B', numero: '202' });
    expect(conflicto.status).toBe(409);

    const inexistente = await request(createApp())
      .post(`/admin/apartamentos/${randomUUID()}`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf, torreInterior: 'Z', numero: '999' });
    expect(inexistente.status).toBe(404);
  });

  it('no elimina un apartamento con usuarios o reservas', async () => {
    const admin = await sembrarAdmin();

    const conUsuario = await sembrarApartamento('A', '101');
    await sembrarResidenteEn(conUsuario);

    const resUsuario = await request(createApp())
      .post(`/admin/apartamentos/${conUsuario}/eliminar`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf });
    expect(resUsuario.status).toBe(409);

    const [{ n: nUsuario }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM APARTAMENTO WHERE id = ?',
      [conUsuario],
    );
    expect(nUsuario).toBe(1);

    const conReserva = await sembrarApartamento('C', '303');
    await sembrarReservaEn(conReserva);

    const resReserva = await request(createApp())
      .post(`/admin/apartamentos/${conReserva}/eliminar`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf });
    expect(resReserva.status).toBe(409);

    const [{ n: nReserva }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM APARTAMENTO WHERE id = ?',
      [conReserva],
    );
    expect(nReserva).toBe(1);
  });

  it('elimina un apartamento sin dependencias y deja BITACORA', async () => {
    const admin = await sembrarAdmin();
    const apartamentoId = await sembrarApartamento('A', '101');

    const res = await request(createApp())
      .post(`/admin/apartamentos/${apartamentoId}/eliminar`)
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf });
    expect(res.status).toBe(302);

    const [{ n }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM APARTAMENTO WHERE id = ?',
      [apartamentoId],
    );
    expect(n).toBe(0);

    const [bitacora] = await query<{ accion: string }>(
      "SELECT accion FROM BITACORA WHERE accion = 'apartamento.eliminar'",
    );
    expect(bitacora).toBeDefined();
  });

  it('renderiza listado y formulario para el administrador', async () => {
    const admin = await sembrarAdmin();
    await sembrarApartamento('A', '101');

    const listado = await request(createApp())
      .get('/admin/apartamentos')
      .set('Cookie', admin.cookie);
    expect(listado.status).toBe(200);
    expect(listado.text).toContain('101');
    expect(listado.text).toContain('name="torreInterior"');
    expect(listado.text).toContain('name="_csrf"');

    const apartamentoId = (
      await query<{ id: string }>(
        'SELECT id FROM APARTAMENTO WHERE torre_interior = ? AND numero = ?',
        ['A', '101'],
      )
    )[0].id;

    const edicion = await request(createApp())
      .get(`/admin/apartamentos/${apartamentoId}`)
      .set('Cookie', admin.cookie);
    expect(edicion.status).toBe(200);
    expect(edicion.text).toContain(`action="/admin/apartamentos/${apartamentoId}"`);
    expect(edicion.text).toContain('value="101"');
  });
});
