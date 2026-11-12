import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { derivarCsrf } from '../src/lib/crypto';
import { crearSesion } from '../src/modules/auth/sessions';
import type { HorarioZona } from '../src/modules/zonas/service';

type CuerpoZona = {
  csrf: string;
  nombre?: string;
  aforo?: number;
  duracionBloqueMin?: number;
  maxCuposReserva?: number;
  activa?: boolean;
  horarios?: HorarioZona[];
};

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

function cuerpoZona(op: CuerpoZona): Record<string, unknown> {
  return {
    _csrf: op.csrf,
    nombre: op.nombre ?? 'BBQ',
    aforo: op.aforo ?? 12,
    duracionBloqueMin: op.duracionBloqueMin ?? 240,
    maxCuposReserva: op.maxCuposReserva ?? 4,
    activa: op.activa ?? true,
    horarios: op.horarios ?? [{ diaSemana: 1, apertura: '10:00', cierre: '22:00' }],
  };
}

async function sembrarZonaConReserva(): Promise<{ zonaId: string; reservaId: string }> {
  const zonaId = randomUUID();
  await query(
    `INSERT INTO ZONA (id, nombre, aforo, duracion_bloque_min, max_cupos_reserva, activa)
     VALUES (?, 'BBQ', 12, 240, 4, 1)`,
    [zonaId],
  );
  await query(
    `INSERT INTO HORARIO_ZONA (id, zona_id, dia_semana, apertura, cierre)
     VALUES (UUID(), ?, 1, '10:00', '22:00')`,
    [zonaId],
  );

  const reservaId = randomUUID();
  await query(
    `INSERT INTO RESERVA (id, zona_id, fecha, hora_inicio, hora_fin, cupos, estado)
     VALUES (?, ?, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '10:00:00', '14:00:00', 2, 'CONFIRMADA')`,
    [reservaId, zonaId],
  );

  return { zonaId, reservaId };
}

describe('configuracion de zonas y horarios', () => {
  it('renderiza listado, formulario y acepta el envío urlencoded real', async () => {
    const admin = await sembrarAdmin();
    await query(
      `INSERT INTO ZONA (id, nombre, aforo, duracion_bloque_min, max_cupos_reserva, activa)
       VALUES (?, 'Piscina', 20, 120, 4, 1)`,
      [randomUUID()],
    );

    const listado = await request(createApp())
      .get('/admin/zonas')
      .set('Cookie', admin.cookie);
    expect(listado.status).toBe(200);
    expect(listado.text).toContain('Piscina');

    const formulario = await request(createApp())
      .get('/admin/zonas/nueva')
      .set('Cookie', admin.cookie);
    expect(formulario.status).toBe(200);
    expect(formulario.text).toContain('name="nombre"');
    expect(formulario.text).toContain('name="_csrf"');

    const creado = await request(createApp())
      .post('/admin/zonas/nueva')
      .set('Cookie', admin.cookie)
      .type('form')
      .send({
        _csrf: admin.csrf,
        nombre: 'Salon',
        aforo: '15',
        duracionBloqueMin: '60',
        maxCuposReserva: '3',
        'horarios[0][diaSemana]': '2',
        'horarios[0][apertura]': '09:00',
        'horarios[0][cierre]': '13:00',
        'horarios[1][diaSemana]': '3',
        'horarios[1][apertura]': '',
        'horarios[1][cierre]': '',
      });
    expect(creado.status).toBe(302);

    const [zona] = await query<{ id: string; activa: number }>(
      'SELECT id, activa FROM ZONA WHERE nombre = ?',
      ['Salon'],
    );
    expect(zona).toBeDefined();
    expect(Number(zona.activa)).toBe(0);

    const [horario] = await query<{ dia_semana: number }>(
      'SELECT dia_semana FROM HORARIO_ZONA WHERE zona_id = ?',
      [zona.id],
    );
    expect(Number(horario.dia_semana)).toBe(2);

    const [{ n }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM HORARIO_ZONA WHERE zona_id = ?',
      [zona.id],
    );
    expect(n).toBe(1);
  });

  it('rechaza cierre que no es multiplo de la duracion', async () => {
    const admin = await sembrarAdmin();
    const res = await request(createApp())
      .post('/admin/zonas/nueva')
      .set('Cookie', admin.cookie)
      .send(
        cuerpoZona({
          csrf: admin.csrf,
          duracionBloqueMin: 240,
          horarios: [{ diaSemana: 1, apertura: '10:00', cierre: '17:00' }],
        }),
      );

    expect(res.status).toBe(400);

    const [{ n }] = await query<{ n: number }>(
      "SELECT COUNT(*) n FROM ZONA WHERE nombre = 'BBQ'",
    );
    expect(n).toBe(0);
  });

  it('crea zona y escribe BITACORA', async () => {
    const admin = await sembrarAdmin();
    const res = await request(createApp())
      .post('/admin/zonas/nueva')
      .set('Cookie', admin.cookie)
      .send(cuerpoZona({ csrf: admin.csrf }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/zonas');

    const [zona] = await query<{ id: string; aforo: number; duracion_bloque_min: number }>(
      'SELECT id, aforo, duracion_bloque_min FROM ZONA WHERE nombre = ?',
      ['BBQ'],
    );
    expect(zona).toBeDefined();
    expect(Number(zona.aforo)).toBe(12);

    const [horario] = await query<{ dia_semana: number }>(
      'SELECT dia_semana FROM HORARIO_ZONA WHERE zona_id = ?',
      [zona.id],
    );
    expect(Number(horario.dia_semana)).toBe(1);

    const [bitacora] = await query<{ accion: string; entidad: string; usuario_id: string }>(
      'SELECT accion, entidad, usuario_id FROM BITACORA WHERE entidad = ?',
      ['ZONA'],
    );
    expect(bitacora.accion).toBe('zona.crear');
    expect(bitacora.usuario_id).toBe(admin.usuarioId);
  });

  it('desactivar zona no borra sus reservas', async () => {
    const admin = await sembrarAdmin();
    const { zonaId } = await sembrarZonaConReserva();

    const res = await request(createApp())
      .post(`/admin/zonas/${zonaId}`)
      .set('Cookie', admin.cookie)
      .send(
        cuerpoZona({
          csrf: admin.csrf,
          nombre: 'BBQ',
          activa: false,
          duracionBloqueMin: 240,
          horarios: [{ diaSemana: 1, apertura: '10:00', cierre: '22:00' }],
        }),
      );

    expect(res.status).toBe(302);

    const [zona] = await query<{ activa: number }>(
      'SELECT activa FROM ZONA WHERE id = ?',
      [zonaId],
    );
    expect(Number(zona.activa)).toBe(0);

    const [reservas] = await query<{ n: number; estado: string | null }>(
      'SELECT COUNT(*) n, MAX(estado) estado FROM RESERVA WHERE zona_id = ?',
      [zonaId],
    );
    expect(reservas.n).toBe(1);
    expect(reservas.estado).toBe('CONFIRMADA');
  });

  it('cambiar la duracion del bloque no reescribe reservas existentes', async () => {
    const admin = await sembrarAdmin();
    const { zonaId, reservaId } = await sembrarZonaConReserva();

    const res = await request(createApp())
      .post(`/admin/zonas/${zonaId}`)
      .set('Cookie', admin.cookie)
      .send(
        cuerpoZona({
          csrf: admin.csrf,
          nombre: 'BBQ',
          duracionBloqueMin: 120,
          horarios: [{ diaSemana: 1, apertura: '10:00', cierre: '22:00' }],
        }),
      );

    expect(res.status).toBe(302);

    const [zona] = await query<{ duracion_bloque_min: number }>(
      'SELECT duracion_bloque_min FROM ZONA WHERE id = ?',
      [zonaId],
    );
    expect(Number(zona.duracion_bloque_min)).toBe(120);

    const [reserva] = await query<{ hora_fin: string }>(
      'SELECT hora_fin FROM RESERVA WHERE id = ?',
      [reservaId],
    );
    expect(String(reserva.hora_fin)).toBe('14:00:00');
  });

  it('rechaza una zona sin horarios', async () => {
    const admin = await sembrarAdmin();
    const res = await request(createApp())
      .post('/admin/zonas/nueva')
      .set('Cookie', admin.cookie)
      .send(cuerpoZona({ csrf: admin.csrf, horarios: [] }));

    expect(res.status).toBe(400);
    expect(res.text).toContain('al menos un horario');

    const [{ n }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM ZONA WHERE nombre = ?',
      ['BBQ'],
    );
    expect(n).toBe(0);
  });

  it('un update invalido conserva la entrada y apunta al id correcto', async () => {
    const admin = await sembrarAdmin();
    const { zonaId } = await sembrarZonaConReserva();

    const res = await request(createApp())
      .post(`/admin/zonas/${zonaId}`)
      .set('Cookie', admin.cookie)
      .send(
        cuerpoZona({
          csrf: admin.csrf,
          nombre: 'Salon Edit',
          duracionBloqueMin: 70,
          horarios: [{ diaSemana: 1, apertura: '10:00', cierre: '22:00' }],
        }),
      );

    expect(res.status).toBe(400);
    expect(res.text).toContain('value="Salon Edit"');
    expect(res.text).toContain(`action="/admin/zonas/${zonaId}"`);

    const [zona] = await query<{ nombre: string; duracion_bloque_min: number }>(
      'SELECT nombre, duracion_bloque_min FROM ZONA WHERE id = ?',
      [zonaId],
    );
    expect(zona.nombre).toBe('BBQ');
    expect(Number(zona.duracion_bloque_min)).toBe(240);
  });

  it('un update invalido a un id inexistente devuelve 404 sin exponer el formulario de nueva', async () => {
    const admin = await sembrarAdmin();
    const inexistente = randomUUID();

    const res = await request(createApp())
      .post(`/admin/zonas/${inexistente}`)
      .set('Cookie', admin.cookie)
      .send(
        cuerpoZona({
          csrf: admin.csrf,
          nombre: 'Fantasma',
          duracionBloqueMin: 70,
          horarios: [{ diaSemana: 1, apertura: '10:00', cierre: '22:00' }],
        }),
      );

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('action="/admin/zonas/nueva"');

    const [{ n }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM ZONA WHERE nombre = ?',
      ['Fantasma'],
    );
    expect(n).toBe(0);
  });
});
