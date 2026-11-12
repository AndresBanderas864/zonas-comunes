import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { pool, query } from '../src/db/pool';
import { derivarCsrf } from '../src/lib/crypto';
import { crearSesion, type UsuarioSesion } from '../src/modules/auth/sessions';
import {
  listarAuditoria,
  registrarAuditoria,
} from '../src/modules/auditoria/service';
import { crearUsuarioConApartamento } from './helpers/fixtures';

const app = createApp();

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

async function cookieDe(usuario: UsuarioSesion): Promise<string> {
  const { token } = await crearSesion(usuario.id);
  return `sid=${token}`;
}

// Split del test de acciones: zona.crear (tarea 10) e invitacion.crear
// (tarea 10b) se ejercitan por su ruta HTTP real, porque reproducen el
// flujo autenticado completo de escritura en BITACORA. Las acciones de las
// tareas 10b (revocar), 11, 14 y 20/20b se siembran con registrarAuditoria
// directo: sus rutas ya tienen prueba propia en invitados/usuarios-admin/
// cancelacion/parametros/cuenta, y repetir esos flujos aqui duplicaria
// contexto sin anadir cobertura sobre la lectura de la bitacora.
async function crearZonaPorRuta(admin: Admin): Promise<void> {
  const res = await request(app)
    .post('/admin/zonas/nueva')
    .set('Cookie', admin.cookie)
    .send({
      _csrf: admin.csrf,
      nombre: 'BBQ',
      aforo: 12,
      duracionBloqueMin: 240,
      maxCuposReserva: 4,
      activa: true,
      horarios: [{ diaSemana: 1, apertura: '10:00', cierre: '22:00' }],
    });
  expect(res.status).toBe(302);
}

async function crearInvitacionPorRuta(admin: Admin): Promise<void> {
  const apartamentoId = randomUUID();
  await query(
    `INSERT INTO APARTAMENTO (id, torre_interior, numero) VALUES (?, 'A', '101')`,
    [apartamentoId],
  );

  // El enlace de invitacion se escribe en console.info; se silencia para
  // que el token no aparezca en la salida de los tests.
  const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const res = await request(app)
      .post('/admin/invitaciones')
      .set('Cookie', admin.cookie)
      .type('form')
      .send({ _csrf: admin.csrf, apartamentoId });
    expect(res.status).toBe(302);
  } finally {
    spy.mockRestore();
  }
}

async function registrarDirecta(
  admin: Admin,
  accion: string,
  entidad: string,
  detalle?: unknown,
): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await registrarAuditoria(conn, {
      usuarioId: admin.usuarioId,
      accion,
      entidad,
      entidadId: randomUUID(),
      detalle,
    });
  } finally {
    conn.release();
  }
}

const ACCIONES_SEMBRADAS = [
  'invitacion.revocar',
  'usuario.desactivar',
  'reserva.cancelar_admin',
  'parametros.actualizar',
  'usuario.rectificar_nombre',
];

async function sembrarTodasLasAcciones(admin: Admin): Promise<void> {
  await crearZonaPorRuta(admin);
  await crearInvitacionPorRuta(admin);
  await Promise.all(
    ACCIONES_SEMBRADAS.map((accion) => registrarDirecta(admin, accion, 'PRUEBA')),
  );
}

describe('vista de bitacora', () => {
  it('listarAuditoria devuelve las acciones de las tareas 10-20 con el usuario', async () => {
    const admin = await sembrarAdmin();
    await sembrarTodasLasAcciones(admin);

    const entradas = await listarAuditoria({});
    const acciones = new Set(entradas.map((e) => e.accion));
    for (const accion of ['zona.crear', 'invitacion.crear', ...ACCIONES_SEMBRADAS]) {
      expect(acciones.has(accion), `falta ${accion}`).toBe(true);
    }

    const creaZona = entradas.find((e) => e.accion === 'zona.crear')!;
    expect(creaZona.usuario).toBe('Admin');
    expect(creaZona.entidad).toBe('ZONA');
    expect(creaZona.entidadId).toMatch(/^[0-9a-f-]{36}$/);
    // Marca UTC con formato ISO (misma convencion que creada_en en reservas).
    expect(creaZona.creadaEn).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/);
  });

  it('el detalle nunca contiene password_hash ni tokens', async () => {
    const admin = await sembrarAdmin();
    await sembrarTodasLasAcciones(admin);

    const filas = await query<{ detalle: unknown }>('SELECT detalle FROM BITACORA');
    expect(filas.length).toBeGreaterThan(0);
    for (const fila of filas) {
      const texto =
        typeof fila.detalle === 'string'
          ? fila.detalle
          : JSON.stringify(fila.detalle ?? '');
      expect(texto.toLowerCase()).not.toMatch(/password|token|hash/);
    }

    const pagina = await request(app)
      .get('/admin/bitacora')
      .set('Cookie', admin.cookie)
      .set('Accept', 'text/html');
    expect(pagina.status).toBe(200);
    expect(pagina.text).not.toContain('password_hash');
  });

  it('filtra por rango de fechas (UTC), ordena descendente y respeta bordes', async () => {
    const admin = await sembrarAdmin();
    const insert = (creadaEn: string) =>
      query(
        `INSERT INTO BITACORA (id, usuario_id, accion, entidad, entidad_id, creada_en)
         VALUES (?, ?, 'zona.crear', 'ZONA', ?, ?)`,
        [randomUUID(), admin.usuarioId, randomUUID(), creadaEn],
      );
    await insert('2026-01-05 12:00:00.000');
    await insert('2026-01-10 08:30:00.000');
    await insert('2026-02-01 00:00:00.000');

    const rango = await listarAuditoria({ desde: '2026-01-05', hasta: '2026-01-10' });
    expect(rango).toHaveLength(2);
    expect(rango[0]!.creadaEn.startsWith('2026-01-10')).toBe(true);
    expect(rango[1]!.creadaEn.startsWith('2026-01-05')).toBe(true);

    const despues = await listarAuditoria({ desde: '2026-02-01' });
    expect(despues).toHaveLength(1);

    const vacio = await listarAuditoria({ desde: '2030-01-01' });
    expect(vacio).toEqual([]);
  });

  it('la vista muestra acciones y escapa el detalle', async () => {
    const admin = await sembrarAdmin();
    await crearZonaPorRuta(admin);
    await registrarDirecta(admin, 'prueba.escapar', 'PRUEBA', {
      nota: '<script>alert("x")</script>',
    });

    const res = await request(app)
      .get('/admin/bitacora')
      .set('Cookie', admin.cookie)
      .set('Accept', 'text/html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('zona.crear');
    expect(res.text).toContain('Admin');
    expect(res.text).toContain('name="desde"');
    expect(res.text).toContain('name="hasta"');
    // El detalle JSON se renderiza escapado dentro de <code>.
    expect(res.text).toContain('<code>');
    expect(res.text).toContain('&lt;script&gt;');
    expect(res.text).not.toContain('<script>alert');
  });

  it('solo ADMINISTRADOR ve la bitacora: residente y vigilante reciben 403', async () => {
    const residente = await crearUsuarioConApartamento('RESIDENTE', '101');
    const vigilante = await crearUsuarioConApartamento('VIGILANTE', '900');

    for (const usuario of [residente, vigilante]) {
      const res = await request(app)
        .get('/admin/bitacora')
        .set('Cookie', await cookieDe(usuario))
        .set('Accept', 'text/html');
      expect(res.status).toBe(403);
    }
  });

  it('rechaza fechas fuera de formato o inexistentes con 400', async () => {
    const admin = await sembrarAdmin();

    const basura = await request(app)
      .get('/admin/bitacora')
      .query({ desde: 'basura' })
      .set('Cookie', admin.cookie)
      .set('Accept', 'text/html');
    expect(basura.status).toBe(400);
    expect(basura.body.error.code).toBe('VALIDACION');

    const imposible = await request(app)
      .get('/admin/bitacora')
      .query({ hasta: '2026-02-29' })
      .set('Cookie', admin.cookie)
      .set('Accept', 'text/html');
    expect(imposible.status).toBe(400);
    expect(imposible.body.error.code).toBe('VALIDACION');

    const limpio = await request(app)
      .get('/admin/bitacora')
      .set('Cookie', admin.cookie)
      .set('Accept', 'text/html');
    expect(limpio.status).toBe(200);
  });
});
