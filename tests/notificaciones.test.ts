import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query, withTransaction } from '../src/db/pool';
import { derivarCsrf } from '../src/lib/crypto';
import { crearSesion, type UsuarioSesion } from '../src/modules/auth/sessions';
import {
  bandejaDe,
  crearNotificacion,
  notificarApartamento,
} from '../src/modules/notificaciones/service';
import {
  despachadorConsola,
  despacharPendientes,
  type CanalEnvio,
} from '../src/modules/notificaciones/dispatcher';
import { cancelarReserva } from '../src/modules/reservas/cancelacion';
import { crearReserva } from '../src/modules/reservas/service';
import {
  crearUsuarioConApartamento,
  crearZonaConAforo,
  fijarContextoReserva,
  mananaBogota,
} from './helpers/fixtures';

const app = createApp();
const BLOQUE = '10:00';

// Usuario extra dentro de un apartamento ya creado (fixtures solo crea uno
// por apartamento). estado permite sembrar residentes inactivos.
async function anadirUsuario(
  apartamentoId: string,
  numero: string,
  estado = 'ACTIVA',
): Promise<UsuarioSesion> {
  const usuarioId = randomUUID();
  const correo = `extra-${numero}-${usuarioId.slice(0, 8)}@ecc.local`;
  await query(
    `INSERT INTO USUARIO (id, rol, apartamento_id, nombre, correo, password_hash, estado, correo_verificado)
     VALUES (?, 'RESIDENTE', ?, ?, ?, 'x', ?, 1)`,
    [usuarioId, apartamentoId, `Extra ${numero}`, correo, estado],
  );
  return {
    id: usuarioId,
    rol: 'RESIDENTE',
    apartamentoId,
    nombre: `Extra ${numero}`,
    correo,
    correoVerificado: true,
  };
}

async function credencialesDe(
  usuario: UsuarioSesion,
): Promise<{ cookie: string; csrf: string }> {
  const { token } = await crearSesion(usuario.id);
  return {
    cookie: `sid=${token}`,
    csrf: derivarCsrf(token, process.env.SESSION_SECRET as string),
  };
}

// Notificacion directa (sin reserva) con titulo unico para poder localizarla.
async function nuevaNotificacion(
  usuarioId: string,
  titulo: string,
): Promise<string> {
  await withTransaction((conn) =>
    crearNotificacion(conn, {
      usuarioId,
      tipo: 'RECORDATORIO',
      titulo,
      mensaje: `Mensaje de ${titulo}`,
    }),
  );
  const filas = await query<{ id: string }>(
    'SELECT id FROM NOTIFICACION WHERE titulo = ?',
    [titulo],
  );
  return filas[0].id;
}

async function leerEnvio(
  notificacionId: string,
  canal: string,
): Promise<{ estado: string; intentos: number }> {
  const filas = await query<{ estado: string; intentos: number }>(
    'SELECT estado, intentos FROM ENVIO_NOTIFICACION WHERE notificacion_id = ? AND canal = ?',
    [notificacionId, canal],
  );
  return filas[0];
}

describe('crearNotificacion y notificarApartamento', () => {
  it('notificarApartamento crea una NOTIFICACION por residente activo y un ENVIO por canal', async () => {
    const titular = await crearUsuarioConApartamento('RESIDENTE', '101');
    const segundo = await anadirUsuario(titular.apartamentoId!, '101b');
    await anadirUsuario(titular.apartamentoId!, '101x', 'DESACTIVADA');
    const otraCasa = await crearUsuarioConApartamento('RESIDENTE', '102');

    await withTransaction((conn) =>
      notificarApartamento(conn, titular.apartamentoId!, {
        tipo: 'CONFIRMACION',
        titulo: 'Reserva confirmada',
        mensaje: 'Tu reserva quedo confirmada.',
      }),
    );

    const propias = await query<{ usuario_id: string }>(
      `SELECT n.usuario_id FROM NOTIFICACION n
       JOIN USUARIO u ON u.id = n.usuario_id
       WHERE u.apartamento_id = ? AND n.tipo = 'CONFIRMACION'`,
      [titular.apartamentoId],
    );
    expect(propias.map((f) => f.usuario_id).sort()).toEqual(
      [titular.id, segundo.id].sort(),
    );

    const [ajena] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM NOTIFICACION WHERE usuario_id = ?',
      [otraCasa.id],
    );
    expect(Number(ajena.n)).toBe(0);

    const [envios] = await query<{ total: number; correo: number; push: number; pend: number }>(
      `SELECT COUNT(*) total, SUM(e.canal = 'CORREO') correo, SUM(e.canal = 'PUSH') push,
              SUM(e.estado = 'PENDIENTE') pend
       FROM ENVIO_NOTIFICACION e
       JOIN NOTIFICACION n ON n.id = e.notificacion_id
       JOIN USUARIO u ON u.id = n.usuario_id
       WHERE u.apartamento_id = ?`,
      [titular.apartamentoId],
    );
    expect(Number(envios.total)).toBe(4);
    expect(Number(envios.correo)).toBe(2);
    expect(Number(envios.push)).toBe(2);
    expect(Number(envios.pend)).toBe(4);
  });
});

describe('integracion con reservas', () => {
  it('confirmar una reserva notifica a los residentes activos del apartamento', async () => {
    const zona = await crearZonaConAforo(10, 120);
    const fecha = mananaBogota();
    fijarContextoReserva({ zonaId: zona.id, fecha, horaInicio: BLOQUE });

    const titular = await crearUsuarioConApartamento('RESIDENTE', '101');
    const segundo = await anadirUsuario(titular.apartamentoId!, '101b');

    const reserva = await crearReserva(titular, {
      zonaId: zona.id,
      fecha,
      horaInicio: BLOQUE,
      cupos: 2,
    });

    const filas = await query<{ usuario_id: string }>(
      `SELECT usuario_id FROM NOTIFICACION WHERE reserva_id = ? AND tipo = 'CONFIRMACION'`,
      [reserva.id],
    );
    expect(filas.map((f) => f.usuario_id).sort()).toEqual(
      [titular.id, segundo.id].sort(),
    );

    const [envios] = await query<{ total: number; correo: number; push: number }>(
      `SELECT COUNT(*) total, SUM(canal = 'CORREO') correo, SUM(canal = 'PUSH') push
       FROM ENVIO_NOTIFICACION WHERE notificacion_id IN
         (SELECT id FROM NOTIFICACION WHERE reserva_id = ?)`,
      [reserva.id],
    );
    expect(Number(envios.total)).toBe(4);
    expect(Number(envios.correo)).toBe(2);
    expect(Number(envios.push)).toBe(2);
  });

  it('cancelar una reserva crea NOTIFICACION tipo CANCELACION con sus envios', async () => {
    const zona = await crearZonaConAforo(10, 120);
    const fecha = mananaBogota();
    fijarContextoReserva({ zonaId: zona.id, fecha, horaInicio: BLOQUE });

    const titular = await crearUsuarioConApartamento('RESIDENTE', '101');
    const reserva = await crearReserva(titular, {
      zonaId: zona.id,
      fecha,
      horaInicio: BLOQUE,
      cupos: 1,
    });

    await cancelarReserva(titular, reserva.id, 'Clima adverso');

    const filas = await query<{ tipo: string; mensaje: string }>(
      `SELECT tipo, mensaje FROM NOTIFICACION WHERE reserva_id = ? AND usuario_id = ?`,
      [reserva.id, titular.id],
    );
    expect(filas.map((f) => f.tipo).sort()).toEqual(['CANCELACION', 'CONFIRMACION']);
    expect(filas.find((f) => f.tipo === 'CANCELACION')?.mensaje).toContain('Clima adverso');

    const [envios] = await query<{ n: number }>(
      `SELECT COUNT(*) n FROM ENVIO_NOTIFICACION WHERE notificacion_id IN
         (SELECT id FROM NOTIFICACION WHERE reserva_id = ? AND tipo = 'CANCELACION')`,
      [reserva.id],
    );
    expect(Number(envios.n)).toBe(2);
  });
});

describe('despachador', () => {
  it('despacharPendientes marca ENVIADO solo el canal atendido', async () => {
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    const notificacionId = await nuevaNotificacion(usuario.id, 'Despacho consola');

    const resultado = await despacharPendientes(despachadorConsola);
    expect(resultado).toEqual({ enviados: 1, fallidos: 0 });

    expect(await leerEnvio(notificacionId, 'CORREO')).toMatchObject({
      estado: 'ENVIADO',
      intentos: 1,
    });
    expect(await leerEnvio(notificacionId, 'PUSH')).toMatchObject({
      estado: 'PENDIENTE',
      intentos: 0,
    });

    const push: CanalEnvio = { canal: 'PUSH', enviar: async () => {} };
    expect(await despacharPendientes(push)).toEqual({ enviados: 1, fallidos: 0 });
    expect(await leerEnvio(notificacionId, 'PUSH')).toMatchObject({
      estado: 'ENVIADO',
      intentos: 1,
    });
  });

  it('un canal que falla deja PENDIENTE con intentos y a la tercera FALLIDO con intentos = 3', async () => {
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    const notificacionId = await nuevaNotificacion(usuario.id, 'Canal terco');

    const fallo: CanalEnvio = {
      canal: 'CORREO',
      enviar: async () => {
        throw new Error('proveedor caido');
      },
    };

    expect(await despacharPendientes(fallo)).toEqual({ enviados: 0, fallidos: 1 });
    expect(await leerEnvio(notificacionId, 'CORREO')).toMatchObject({
      estado: 'PENDIENTE',
      intentos: 1,
    });

    expect(await despacharPendientes(fallo)).toEqual({ enviados: 0, fallidos: 1 });
    expect(await leerEnvio(notificacionId, 'CORREO')).toMatchObject({
      estado: 'PENDIENTE',
      intentos: 2,
    });

    expect(await despacharPendientes(fallo)).toEqual({ enviados: 0, fallidos: 1 });
    expect(await leerEnvio(notificacionId, 'CORREO')).toMatchObject({
      estado: 'FALLIDO',
      intentos: 3,
    });

    // Cuarta pasada: ya no hay pendientes, no se vuelve a intentar.
    expect(await despacharPendientes(fallo)).toEqual({ enviados: 0, fallidos: 0 });
    expect(await leerEnvio(notificacionId, 'CORREO')).toMatchObject({
      estado: 'FALLIDO',
      intentos: 3,
    });
  });

  it('dos despachadores concurrentes nunca ejecutan enviar() sobre el mismo envio', async () => {
    // El claim es la transaccion unica de la pasada: la seleccion FOR UPDATE
    // SKIP LOCKED conserva los locks hasta el commit, asi que el perdedor ni
    // siquiera ve las filas del ganador.
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    for (let i = 0; i < 4; i++) {
      await nuevaNotificacion(usuario.id, `Concurren ${i}`);
    }

    const enviosVistos = new Map<string, number>();
    const lento: CanalEnvio = {
      canal: 'CORREO',
      async enviar(envio) {
        enviosVistos.set(envio.id, (enviosVistos.get(envio.id) ?? 0) + 1);
        await new Promise((resolver) => setTimeout(resolver, 25));
      },
    };

    const [primera, segunda] = await Promise.all([
      despacharPendientes(lento),
      despacharPendientes(lento),
    ]);

    expect(primera.enviados + segunda.enviados).toBe(4);
    expect(enviosVistos.size).toBe(4);
    expect([...enviosVistos.values()].every((veces) => veces === 1)).toBe(true);

    const [estado] = await query<{ enviado: number; pendiente: number }>(
      `SELECT SUM(e.estado = 'ENVIADO') enviado, SUM(e.estado = 'PENDIENTE') pendiente
       FROM ENVIO_NOTIFICACION e
       JOIN NOTIFICACION n ON n.id = e.notificacion_id
       WHERE n.titulo LIKE 'Concurren %' AND e.canal = 'CORREO'`,
    );
    expect(Number(estado.enviado)).toBe(4);
    expect(Number(estado.pendiente)).toBe(0);
  });

  it('el limite acota cuantos envios se procesan por pasada', async () => {
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    for (let i = 0; i < 3; i++) {
      await nuevaNotificacion(usuario.id, `Limite ${i}`);
    }

    const ok: CanalEnvio = { canal: 'CORREO', enviar: async () => {} };
    expect(await despacharPendientes(ok, 2)).toEqual({ enviados: 2, fallidos: 0 });

    const [estado] = await query<{ enviado: number; pendiente: number }>(
      `SELECT SUM(e.estado = 'ENVIADO') enviado, SUM(e.estado = 'PENDIENTE') pendiente
       FROM ENVIO_NOTIFICACION e
       JOIN NOTIFICACION n ON n.id = e.notificacion_id
       WHERE n.titulo LIKE 'Limite %' AND e.canal = 'CORREO'`,
    );
    expect(Number(estado.enviado)).toBe(2);
    expect(Number(estado.pendiente)).toBe(1);
  });
});

describe('bandeja', () => {
  it('GET /notificaciones muestra solo las notificaciones del usuario', async () => {
    const uno = await crearUsuarioConApartamento('RESIDENTE', '101');
    const otro = await crearUsuarioConApartamento('RESIDENTE', '102');
    await nuevaNotificacion(uno.id, 'Asunto de uno');
    await nuevaNotificacion(otro.id, 'Asunto de otro');

    const credenciales = await credencialesDe(uno);
    const res = await request(app)
      .get('/notificaciones')
      .set('Cookie', credenciales.cookie)
      .set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Asunto de uno');
    expect(res.text).not.toContain('Asunto de otro');
    // El nav ya enlaza la bandeja para residentes.
    expect(res.text).toContain('name="_csrf"');
  });

  it('POST /notificaciones/:id/leida marca leida y 404 si es de otro usuario', async () => {
    const uno = await crearUsuarioConApartamento('RESIDENTE', '101');
    const otro = await crearUsuarioConApartamento('RESIDENTE', '102');
    const idPropia = await nuevaNotificacion(uno.id, 'Leible');
    const idAjena = await nuevaNotificacion(otro.id, 'No leible');

    const credenciales = await credencialesDe(uno);

    const propia = await request(app)
      .post(`/notificaciones/${idPropia}/leida`)
      .set('Cookie', credenciales.cookie)
      .send({ _csrf: credenciales.csrf });
    expect(propia.status).toBe(204);

    const [fila] = await query<{ leida: number }>(
      'SELECT leida FROM NOTIFICACION WHERE id = ?',
      [idPropia],
    );
    expect(Number(fila.leida)).toBe(1);

    const ajena = await request(app)
      .post(`/notificaciones/${idAjena}/leida`)
      .set('Cookie', credenciales.cookie)
      .send({ _csrf: credenciales.csrf });
    expect(ajena.status).toBe(404);

    const bandeja = await bandejaDe(otro.id);
    expect(bandeja[0]).toMatchObject({ id: idAjena, leida: false });
  });

  it('sin sesion la bandeja redirige a login', async () => {
    const res = await request(app)
      .get('/notificaciones')
      .set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});
