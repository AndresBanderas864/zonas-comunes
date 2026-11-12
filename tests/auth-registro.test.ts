import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { hashToken } from '../src/lib/crypto';

type OpcionesInvitacion = {
  estado?: 'VIGENTE' | 'USADA' | 'REVOCADA' | 'VENCIDA';
  venceEn?: Date;
  correoExistente?: string;
};

async function sembrarInvitacion(opciones: OpcionesInvitacion = {}) {
  const apartamentoId = randomUUID();
  const adminId = randomUUID();

  await query(
    'INSERT INTO APARTAMENTO (id, torre_interior, numero) VALUES (?, ?, ?)',
    [apartamentoId, 'A', '101'],
  );
  await query(
    `INSERT INTO USUARIO (id, rol, nombre, correo, password_hash, estado)
     VALUES (?, 'ADMINISTRADOR', 'Admin', 'admin@ecc.local', 'x', 'ACTIVA')`,
    [adminId],
  );
  await query(
    `INSERT INTO TEXTO_LEGAL (id, tipo, version, contenido, vigente_desde)
     VALUES (?, 'AUTORIZACION', 1, 'Autorizo el tratamiento de mis datos.', NOW(3))`,
    [randomUUID()],
  );

  if (opciones.correoExistente) {
    await query(
      `INSERT INTO USUARIO (id, rol, apartamento_id, nombre, correo, password_hash, estado)
       VALUES (?, 'RESIDENTE', ?, 'Existente', ?, 'x', 'ACTIVA')`,
      [randomUUID(), apartamentoId, opciones.correoExistente],
    );
  }

  const token = `inv-${randomUUID()}`;
  await query(
    `INSERT INTO INVITACION (id, apartamento_id, creada_por, token_hash, estado, vence_en)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      apartamentoId,
      adminId,
      hashToken(token),
      opciones.estado ?? 'VIGENTE',
      opciones.venceEn ?? new Date(Date.now() + 86_400_000),
    ],
  );

  return { token, apartamentoId };
}

function datosRegistro(correo = 'nuevo@ecc.local') {
  return { nombre: 'Nuevo Residente', correo, password: 'Demo1234!' };
}

describe('registro con invitacion', () => {
  it('muestra el formulario con una invitacion vigente', async () => {
    const { token } = await sembrarInvitacion();
    const res = await request(createApp()).get(`/registro/${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="nombre"');
    expect(res.text).toContain('name="correo"');
    expect(res.text).toContain('name="password"');
  });

  it('registra con invitacion vigente y la marca usada', async () => {
    const { token, apartamentoId } = await sembrarInvitacion();
    const res = await request(createApp())
      .post(`/registro/${token}`)
      .type('form')
      .send(datosRegistro());

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');

    const [usuario] = await query<{
      id: string;
      estado: string;
      correo_verificado: number;
      apartamento_id: string;
    }>('SELECT id, estado, correo_verificado, apartamento_id FROM USUARIO WHERE correo = ?', [
      'nuevo@ecc.local',
    ]);
    expect(usuario.estado).toBe('ACTIVA');
    expect(Number(usuario.correo_verificado)).toBe(0);
    expect(usuario.apartamento_id).toBe(apartamentoId);

    const [invitacion] = await query<{ estado: string; usuario_id: string | null }>(
      'SELECT estado, usuario_id FROM INVITACION WHERE token_hash = ?',
      [hashToken(token)],
    );
    expect(invitacion.estado).toBe('USADA');
    expect(invitacion.usuario_id).toBe(usuario.id);

    const [{ n }] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM AUTORIZACION_DATOS WHERE usuario_id = ?',
      [usuario.id],
    );
    expect(n).toBe(1);
  });

  it('rechaza una invitacion vencida', async () => {
    const { token } = await sembrarInvitacion({
      venceEn: new Date(Date.now() - 60_000),
    });
    const res = await request(createApp())
      .post(`/registro/${token}`)
      .type('form')
      .send(datosRegistro());
    expect(res.status).toBe(400);
    expect(res.text).toContain('venció');
    const [{ n }] = await query<{ n: number }>(
      "SELECT COUNT(*) n FROM USUARIO WHERE correo = 'nuevo@ecc.local'",
    );
    expect(n).toBe(0);
  });

  it('rechaza una invitacion ya usada', async () => {
    const { token } = await sembrarInvitacion({ estado: 'USADA' });
    const res = await request(createApp())
      .post(`/registro/${token}`)
      .type('form')
      .send(datosRegistro());
    expect(res.status).toBe(400);
  });

  it('rechaza un correo duplicado', async () => {
    const { token } = await sembrarInvitacion({
      correoExistente: 'nuevo@ecc.local',
    });
    const res = await request(createApp())
      .post(`/registro/${token}`)
      .type('form')
      .send(datosRegistro());
    expect(res.status).toBe(400);
    expect(res.text).toContain('correo ya está registrado');
  });

  it('rechaza una contrasena de menos de 8 caracteres', async () => {
    const { token } = await sembrarInvitacion();
    const res = await request(createApp())
      .post(`/registro/${token}`)
      .type('form')
      .send({ ...datosRegistro(), password: 'corta' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('al menos 8 caracteres');
  });

  it('crea TOKEN_VERIFICACION y GET /verificar/:token marca el correo', async () => {
    const { token } = await sembrarInvitacion();
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      await request(createApp())
        .post(`/registro/${token}`)
        .type('form')
        .send(datosRegistro());

      const llamada = spy.mock.calls
        .map((args) => String(args[0]))
        .find((mensaje) => mensaje.includes('/verificar/'));
      expect(llamada).toBeDefined();

      const tokenVerificacion = llamada!.match(/\/verificar\/([A-Za-z0-9_-]+)/)![1];
      const [{ n }] = await query<{ n: number }>(
        `SELECT COUNT(*) n FROM TOKEN_VERIFICACION WHERE tipo = 'VERIFICAR_CORREO'`,
      );
      expect(n).toBe(1);

      const res = await request(createApp()).get(`/verificar/${tokenVerificacion}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');

      const [usuario] = await query<{ correo_verificado: number }>(
        "SELECT correo_verificado FROM USUARIO WHERE correo = 'nuevo@ecc.local'",
      );
      expect(Number(usuario.correo_verificado)).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
