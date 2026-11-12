import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Response } from 'supertest';
import { createApp } from '../../src/app';
import { query } from '../../src/db/pool';
import { derivarCsrf } from '../../src/lib/crypto';
import type { Rol } from '../../src/lib/types';
import { crearSesion, type UsuarioSesion } from '../../src/modules/auth/sessions';

export type Zona = {
  id: string;
  nombre: string;
  aforo: number;
  duracionBloqueMin: number;
  maxCuposReserva: number;
};

type Credenciales = { cookie: string; csrf: string };

const credencialesPorUsuario = new Map<string, Credenciales>();

let app: ReturnType<typeof createApp> | null = null;
function obtenerApp() {
  if (!app) app = createApp();
  return app;
}

export function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function sumarDiasBogota(fecha: string, dias: number): string {
  const partes = fecha.split('-').map(Number);
  const epoch = Date.UTC(partes[0]!, partes[1]! - 1, partes[2]!);
  return new Date(epoch + dias * 86_400_000).toISOString().slice(0, 10);
}

export function mananaBogota(): string {
  return sumarDiasBogota(hoyBogota(), 1);
}

export async function crearUsuarioConApartamento(
  rol: Rol,
  numero: string,
): Promise<UsuarioSesion> {
  const usuarioId = randomUUID();
  const apartamentoId = rol === 'RESIDENTE' ? randomUUID() : null;
  const correo = `usuario-${numero}-${usuarioId.slice(0, 8)}@ecc.local`;

  if (apartamentoId) {
    await query(
      `INSERT INTO APARTAMENTO (id, torre_interior, numero) VALUES (?, 'A', ?)`,
      [apartamentoId, numero],
    );
  }

  await query(
    `INSERT INTO USUARIO (id, rol, apartamento_id, nombre, correo, password_hash, estado, correo_verificado)
     VALUES (?, ?, ?, ?, ?, 'x', 'ACTIVA', 1)`,
    [usuarioId, rol, apartamentoId, `Usuario ${numero}`, correo],
  );

  const { token } = await crearSesion(usuarioId);
  credencialesPorUsuario.set(usuarioId, {
    cookie: `sid=${token}`,
    csrf: derivarCsrf(token, process.env.SESSION_SECRET as string),
  });

  return {
    id: usuarioId,
    rol,
    apartamentoId,
    nombre: `Usuario ${numero}`,
    correo,
    correoVerificado: true,
  };
}

// Horario todos los dias de 08:00 hasta el multiplo exacto de duracionMin
// mas cercano a 20:00, para que cualquier manana sea reservable.
export async function crearZonaConAforo(
  aforo: number,
  duracionMin: number,
): Promise<Zona> {
  const id = randomUUID();
  const nombre = `Zona ${id.slice(0, 8)}`;
  const maxCuposReserva = Math.min(4, aforo);

  await query(
    `INSERT INTO ZONA (id, nombre, aforo, duracion_bloque_min, max_cupos_reserva, activa)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [id, nombre, aforo, duracionMin, maxCuposReserva],
  );

  const cierreMin = 480 + Math.floor(720 / duracionMin) * duracionMin;
  const cierre = `${String(Math.floor(cierreMin / 60)).padStart(2, '0')}:${String(cierreMin % 60).padStart(2, '0')}`;

  for (let dia = 1; dia <= 7; dia++) {
    await query(
      `INSERT INTO HORARIO_ZONA (id, zona_id, dia_semana, apertura, cierre)
       VALUES (UUID(), ?, ?, '08:00', ?)`,
      [id, dia, cierre],
    );
  }

  return { id, nombre, aforo, duracionBloqueMin: duracionMin, maxCuposReserva };
}

export type ContextoReserva = {
  zonaId: string;
  fecha: string;
  horaInicio: string;
};

let contexto: ContextoReserva | null = null;

export function fijarContextoReserva(nuevo: ContextoReserva): void {
  contexto = nuevo;
}

// postReserva: supertest con cookie de sesion. zonaId, fecha y horaInicio se
// completan con el contexto fijado por el test si no vienen en el body.
export async function postReserva(
  usuario: UsuarioSesion,
  body: Record<string, unknown>,
): Promise<Response> {
  const credenciales = credencialesPorUsuario.get(usuario.id);
  if (!credenciales) {
    throw new Error('El usuario no tiene credenciales de prueba');
  }

  const cuerpo: Record<string, unknown> = {
    confirmar: '1',
    ...(contexto ?? {}),
    ...body,
  };

  return request(obtenerApp())
    .post('/reservas')
    .set('Cookie', credenciales.cookie)
    .send({ ...cuerpo, _csrf: credenciales.csrf });
}
