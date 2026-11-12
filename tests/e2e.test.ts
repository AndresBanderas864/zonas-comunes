import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Agent } from 'supertest';
import { pool, query } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { runSeed } from '../src/db/seed';
import { createApp } from '../src/app';
import { mananaBogota } from './helpers/fixtures';

const PASSWORD_DEMO = 'Demo1234!';

function csrfDe(html: string): string {
  const m = html.match(/name="csrf-token" content="([0-9a-f]+)"/);
  if (!m) throw new Error('No se encontro el token CSRF en la pagina');
  return m[1];
}

function tokenInvitacionDe(html: string): string {
  const m = html.match(/\/registro\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('No se encontro el enlace de invitacion en la pagina');
  return m[1];
}

describe('e2e: recorrido completo', () => {
  it(
    'migrar -> seed -> admin crea invitacion -> residente se registra y verifica -> ' +
      'reserva -> notificacion en bandeja -> cancela -> admin ve estadisticas y bitacora',
    async () => {
      // migrar: las migraciones ya las aplico el global setup de la suite;
      // ejecutarlas de nuevo debe ser un no-op idempotente.
      const conn = await pool.getConnection();
      try {
        expect(await runMigrations(conn)).toBe(0);
      } finally {
        conn.release();
      }

      // seed
      await runSeed(pool);

      const app = createApp();

      // login admin
      const admin: Agent = request.agent(app);
      const loginAdmin = await admin.post('/login').type('form').send({
        correo: 'admin@ecc.local',
        password: PASSWORD_DEMO,
      });
      expect(loginAdmin.status).toBe(302);

      // crear invitacion para un apartamento sin residente (C-101)
      const [apartamento] = await query<{ id: string }>(
        "SELECT id FROM APARTAMENTO WHERE torre_interior = 'C' AND numero = '101'",
      );
      expect(apartamento).toBeDefined();

      const paginaInvitaciones = await admin.get('/admin/invitaciones');
      expect(paginaInvitaciones.status).toBe(200);
      const csrfAdmin = csrfDe(paginaInvitaciones.text);

      const crearInvitacion = await admin
        .post('/admin/invitaciones')
        .send({ apartamentoId: apartamento.id, _csrf: csrfAdmin });
      expect(crearInvitacion.status).toBe(302);

      // el enlace de invitacion llega por flash en la pagina siguiente
      const paginaFlash = await admin.get('/admin/invitaciones');
      expect(paginaFlash.status).toBe(200);
      const token = tokenInvitacionDe(paginaFlash.text);

      // registro del residente
      const residente: Agent = request.agent(app);
      const formRegistro = await residente.get(`/registro/${token}`);
      expect(formRegistro.status).toBe(200);

      const correoNuevo = 'e2e@ecc.local';
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      let enlaceVerificacion: string | undefined;
      try {
        const POSTRegistro = await residente
          .post(`/registro/${token}`)
          .type('form')
          .send({ nombre: 'Residente E2E', correo: correoNuevo, password: PASSWORD_DEMO });
        expect(POSTRegistro.status).toBe(302);

        enlaceVerificacion = spy.mock.calls
          .map((args) => String(args[0]))
          .find((mensaje) => mensaje.includes('/verificar/'))
          ?.match(/\/verificar\/([A-Za-z0-9_-]+)/)?.[1];
      } finally {
        spy.mockRestore();
      }
      expect(enlaceVerificacion).toBeDefined();
      expect(enlaceVerificacion).toMatch(/^[A-Za-z0-9_-]+$/);

      const verificar = await residente.get(`/verificar/${enlaceVerificacion}`);
      expect(verificar.status).toBe(302);
      const [usuarioVerificado] = await query<{ correo_verificado: number }>(
        'SELECT correo_verificado FROM USUARIO WHERE correo = ?',
        [correoNuevo],
      );
      expect(Number(usuarioVerificado.correo_verificado)).toBe(1);

      // login residente
      const loginResidente = await residente
        .post('/login')
        .type('form')
        .send({ correo: correoNuevo, password: PASSWORD_DEMO });
      expect(loginResidente.status).toBe(302);

      // ver disponibilidad
      const elegirZona = await residente.get('/reservar');
      expect(elegirZona.status).toBe(200);
      expect(elegirZona.text).toContain('PISCINA');
      const csrfResidente = csrfDe(elegirZona.text);

      const [zona] = await query<{ id: string }>(
        "SELECT id FROM ZONA WHERE nombre = 'PISCINA'",
      );
      expect(zona).toBeDefined();

      const fecha = mananaBogota();
      const disponibilidad = await residente.get(`/reservar/${zona.id}/${fecha}`);
      expect(disponibilidad.status).toBe(200);
      expect(disponibilidad.text).toContain('08:00');

      // reservar (un bloque de 120 min, 2 cupos)
      const reservar = await residente
        .post('/reservas')
        .set('Accept', 'application/json')
        .send({
          zonaId: zona.id,
          fecha,
          horaInicio: '08:00',
          cupos: 2,
          confirmar: '1',
          _csrf: csrfResidente,
        });
      expect(reservar.status).toBe(201);
      const reservaId = String(reservar.body.reserva.id);
      expect(reservar.body.reserva.estado).toBe('CONFIRMADA');

      // notificacion en bandeja
      const bandeja = await residente.get('/notificaciones');
      expect(bandeja.status).toBe(200);
      expect(bandeja.text).toContain('Reserva confirmada');

      // cancelar
      const cancelar = await residente
        .post(`/reservas/${reservaId}/cancelar`)
        .set('Accept', 'application/json')
        .send({ motivo: 'prueba e2e', _csrf: csrfResidente });
      expect(cancelar.status).toBe(204);

      const bandejaTrasCancelar = await residente.get('/notificaciones');
      expect(bandejaTrasCancelar.status).toBe(200);
      expect(bandejaTrasCancelar.text).toContain('Reserva cancelada');

      // administracion: las rutas residentes quedan fuera de alcance
      const residenteEnAdmin = await residente.get('/admin/estadisticas');
      expect(residenteEnAdmin.status).toBe(403);

      // admin ve estadisticas
      const estadisticas = await admin.get('/admin/estadisticas');
      expect(estadisticas.status).toBe(200);
      expect(estadisticas.text).toContain('Estadísticas');

      // admin ve bitacora
      const bitacora = await admin.get('/admin/bitacora');
      expect(bitacora.status).toBe(200);
      expect(bitacora.text).toContain('invitacion.crear');
    },
    60_000,
  );
});
