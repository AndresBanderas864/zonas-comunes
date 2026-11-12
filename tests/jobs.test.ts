import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { query } from '../src/db/pool';
import { limpiarBitacoraAntigua, limpiarSesionesExpiradas } from '../src/jobs/limpieza';
import { crearRecordatorios } from '../src/jobs/recordatorios';
import { marcarVencidas } from '../src/jobs/vencidas';

// Reloj inyectado fijo: 2026-11-12 10:00 hora de Bogota (15:00 UTC).
// Toda fecha del test se deriva de aqui; nada depende del reloj real.
const AHORA = new Date('2026-11-12T15:00:00.000Z');
const HOY_BOGOTA = '2026-11-12';

async function crearZona(duracionMin: number): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO ZONA (id, nombre, aforo, duracion_bloque_min, max_cupos_reserva, activa)
     VALUES (?, ?, 10, ?, 4, 1)`,
    [id, `Zona job ${id.slice(0, 8)}`, duracionMin],
  );
  return id;
}

async function crearResidente(): Promise<string> {
  const apartamentoId = randomUUID();
  const usuarioId = randomUUID();
  await query(
    `INSERT INTO APARTAMENTO (id, torre_interior, numero) VALUES (?, 'A', ?)`,
    [apartamentoId, apartamentoId.slice(0, 8)],
  );
  await query(
    `INSERT INTO USUARIO (id, rol, apartamento_id, nombre, correo, password_hash, estado, correo_verificado)
     VALUES (?, 'RESIDENTE', ?, 'Residente job', ?, 'x', 'ACTIVA', 1)`,
    [usuarioId, apartamentoId, `job-${usuarioId.slice(0, 8)}@ecc.local`],
  );
  return usuarioId;
}

async function insertarReserva(fila: {
  apartamentoId: string | null;
  zonaId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estado?: string;
  cupos?: number;
}): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO RESERVA (id, apartamento_id, zona_id, fecha, hora_inicio, hora_fin, cupos, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fila.apartamentoId,
      fila.zonaId,
      fila.fecha,
      fila.horaInicio,
      fila.horaFin,
      fila.cupos ?? 2,
      fila.estado ?? 'CONFIRMADA',
    ],
  );
  return id;
}

it('marcarVencidas pasa a VENCIDA las CONFIRMADAS cuyo bloque ya termino', async () => {
  const usuarioId = await crearResidente();
  const apartamento = (
    await query<{ apartamento_id: string }>(
      `SELECT apartamento_id FROM USUARIO WHERE id = ?`,
      [usuarioId],
    )
  )[0].apartamento_id;
  const zonaId = await crearZona(60);

  // Bloque de ayer 11:00-12:00: ya termino.
  const vencible = await insertarReserva({
    apartamentoId: apartamento,
    zonaId,
    fecha: '2026-11-11',
    horaInicio: '11:00:00',
    horaFin: '12:00:00',
  });
  // Bloque futuro: debe quedar CONFIRMADA.
  const vigente = await insertarReserva({
    apartamentoId: apartamento,
    zonaId,
    fecha: '2026-11-13',
    horaInicio: '14:00:00',
    horaFin: '15:00:00',
  });

  // Contador del bloque vencido: el job NO debe tocarlo.
  await query(
    `INSERT INTO OCUPACION_BLOQUE (zona_id, fecha, hora_inicio, cupos_ocupados)
     VALUES (?, '2026-11-11', '11:00:00', 2)`,
    [zonaId],
  );

  const marcadas = await marcarVencidas(AHORA);
  expect(marcadas).toBe(1);

  const estados = await query<{ id: string; estado: string }>(
    `SELECT id, estado FROM RESERVA WHERE id IN (?, ?)`,
    [vencible, vigente],
  );
  expect(
    estados.find((e) => e.id === vencible)?.estado,
  ).toBe('VENCIDA');
  expect(
    estados.find((e) => e.id === vigente)?.estado,
  ).toBe('CONFIRMADA');

  const contador = await query<{ cupos_ocupados: number }>(
    `SELECT cupos_ocupados FROM OCUPACION_BLOQUE
     WHERE zona_id = ? AND fecha = '2026-11-11' AND hora_inicio = '11:00:00'`,
    [zonaId],
  );
  expect(Number(contador[0].cupos_ocupados)).toBe(2);

  // Idempotencia: segunda pasada no marca nada.
  expect(await marcarVencidas(AHORA)).toBe(0);
});

it('crearRecordatorios notifica reservas que empiezan en ~1 hora y es idempotente', async () => {
  const usuarioId = await crearResidente();
  const apartamento = (
    await query<{ apartamento_id: string }>(
      `SELECT apartamento_id FROM USUARIO WHERE id = ?`,
      [usuarioId],
    )
  )[0].apartamento_id;
  const zonaId = await crearZona(60);

  // Empieza hoy 11:00 Bogota = 60 minutos despues de AHORA: dentro de la
  // ventana 55-65.
  const dentro = await insertarReserva({
    apartamentoId: apartamento,
    zonaId,
    fecha: HOY_BOGOTA,
    horaInicio: '11:00:00',
    horaFin: '12:00:00',
  });
  // Empieza 75 minutos despues: por fuera de la ventana.
  const fuera = await insertarReserva({
    apartamentoId: apartamento,
    zonaId,
    fecha: HOY_BOGOTA,
    horaInicio: '12:15:00',
    horaFin: '13:15:00',
  });

  const creados = await crearRecordatorios(AHORA);
  expect(creados).toBe(1);

  const notificaciones = await query<{ tipo: string; reserva_id: string }>(
    `SELECT tipo, reserva_id FROM NOTIFICACION WHERE tipo = 'RECORDATORIO'`,
  );
  expect(notificaciones).toHaveLength(1);
  expect(notificaciones[0].reserva_id).toBe(dentro);

  const envios = await query<{ canal: string; estado: string }>(
    `SELECT e.canal, e.estado FROM ENVIO_NOTIFICACION e
     JOIN NOTIFICACION n ON n.id = e.notificacion_id
     WHERE n.reserva_id = ?`,
    [dentro],
  );
  expect(envios.map((e) => e.canal).sort()).toEqual(['CORREO', 'PUSH']);
  expect(envios.every((e) => e.estado === 'PENDIENTE')).toBe(true);

  // Idempotencia: segunda pasada en la misma ventana no duplica.
  expect(await crearRecordatorios(AHORA)).toBe(0);
  const duplicados = await query<{ n: number }>(
    `SELECT COUNT(*) n FROM NOTIFICACION WHERE reserva_id = ?`,
    [dentro],
  );
  expect(Number(duplicados[0].n)).toBe(1);

  const sinRecordatorio = await query<{ id: string }>(
    `SELECT n.id FROM NOTIFICACION n JOIN RESERVA r ON r.id = n.reserva_id
     WHERE r.id = ? AND n.tipo = 'RECORDATORIO'`,
    [fuera],
  );
  expect(sinRecordatorio).toHaveLength(0);
});

it('limpiarSesionesExpiradas borra sesiones sin uso hace mas de 31 dias', async () => {
  const usuarioId = await crearResidente();

  const vieja = randomUUID();
  await query(
    `INSERT INTO SESION (id, usuario_id, token_hash, ultimo_uso) VALUES (?, ?, ?, ?)`,
    [vieja, usuarioId, randomUUID(), '2026-10-11 15:00:00.000'],
  );
  const reciente = randomUUID();
  await query(
    `INSERT INTO SESION (id, usuario_id, token_hash, ultimo_uso) VALUES (?, ?, ?, ?)`,
    [reciente, usuarioId, randomUUID(), '2026-11-05 15:00:00.000'],
  );

  const borradas = await limpiarSesionesExpiradas(AHORA);
  expect(borradas).toBe(1);

  const restantes = await query<{ id: string }>(
    `SELECT id FROM SESION WHERE id IN (?, ?)`,
    [vieja, reciente],
  );
  expect(restantes.map((r) => r.id)).toEqual([reciente]);

  expect(await limpiarSesionesExpiradas(AHORA)).toBe(0);
});

it('limpiarBitacoraAntigua borra registros de mas de 12 meses', async () => {
  const usuarioId = await crearResidente();

  const vieja = randomUUID();
  await query(
    `INSERT INTO BITACORA (id, usuario_id, accion, entidad, entidad_id, creada_en)
     VALUES (?, ?, 'job.test', 'RESERVA', ?, '2025-10-01 12:00:00.000')`,
    [vieja, usuarioId, randomUUID()],
  );
  const reciente = randomUUID();
  await query(
    `INSERT INTO BITACORA (id, usuario_id, accion, entidad, entidad_id, creada_en)
     VALUES (?, ?, 'job.test', 'RESERVA', ?, '2026-01-01 12:00:00.000')`,
    [reciente, usuarioId, randomUUID()],
  );

  const borradas = await limpiarBitacoraAntigua(AHORA);
  expect(borradas).toBe(1);

  const restantes = await query<{ id: string }>(
    `SELECT id FROM BITACORA WHERE id IN (?, ?)`,
    [vieja, reciente],
  );
  expect(restantes.map((r) => r.id)).toEqual([reciente]);
});
