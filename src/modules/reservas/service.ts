import { randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { withTransaction } from '../../db/pool';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { notificarApartamento } from '../notificaciones/service';
import type { UsuarioSesion } from '../auth/sessions';
import { obtenerParametros } from '../zonas/parametros';
import { obtenerZonaActiva } from './repository';
import { generarBloques } from './bloques';
import { diaSemanaDeFecha } from './disponibilidad';

export type EstadoReserva = 'CONFIRMADA' | 'CANCELADA' | 'VENCIDA';

export type Reserva = {
  id: string;
  apartamentoId: string;
  zonaId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupos: number;
  estado: EstadoReserva;
  creadaEn: string;
};

export type CrearReservaInput = {
  zonaId: string;
  fecha: string;
  horaInicio: string;
  cupos: number;
};

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const esquemaCrear = z.object({
  zonaId: z.string().trim().min(1, 'La zona es obligatoria'),
  fecha: z.string().trim().regex(PATRON_FECHA, 'La fecha debe tener formato AAAA-MM-DD'),
  horaInicio: z.string().trim().regex(PATRON_HORA, 'La hora de inicio debe tener formato HH:MM'),
  cupos: z.coerce
    .number()
    .int('Los cupos deben ser un numero entero')
    .min(1, 'Los cupos deben ser al menos 1'),
});

function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function sumarDias(fecha: string, dias: number): string {
  const partes = fecha.split('-').map(Number);
  return new Date(
    Date.UTC(partes[0]!, partes[1]! - 1, partes[2]!) + dias * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

// 1213 (deadlock) y 1020 (ER_CHECKREAD, "Record has changed since last
// read... try restarting transaction") abortan la transaccion en MariaDB
// cuando dos POST apuntan a la misma fila de OCUPACION_BLOQUE. Ambos se
// reintentan una vez; si vuelve a fallar, responde 409.
function esErrorReintentable(error: unknown): boolean {
  const e = error as { code?: string; errno?: number };
  return (
    e.code === 'ER_LOCK_DEADLOCK' ||
    e.errno === 1213 ||
    e.code === 'ER_CHECKREAD' ||
    e.errno === 1020
  );
}

export async function conReintento<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  try {
    return await withTransaction(fn);
  } catch (error) {
    if (!esErrorReintentable(error)) throw error;
    try {
      return await withTransaction(fn);
    } catch (segundoError) {
      if (esErrorReintentable(segundoError)) {
        throw new ConflictError('El sistema esta congestionado, intente de nuevo');
      }
      throw segundoError;
    }
  }
}

type FilaZona = {
  aforo: number;
  duracion_bloque_min: number;
  max_cupos_reserva: number;
};

type FilaHorario = { apertura: string; cierre: string };

type FilaReserva = {
  id: string;
  apartamento_id: string;
  zona_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  cupos: number;
  estado: EstadoReserva;
  creada_en: string;
};

async function contarNoCanceladas(
  conn: PoolConnection,
  apartamentoId: string,
  condicion: string,
  params: unknown[],
): Promise<number> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) n FROM RESERVA
     WHERE apartamento_id = ? AND estado <> 'CANCELADA' AND ${condicion}`,
    [apartamentoId, ...params],
  );
  return Number((filas[0] as { n: number }).n);
}

// Diseno 9.2. Orden obligatorio de sentencias:
//  1. Lock exclusivo de la fila del apartamento (lectura bloqueante, corriente).
//  2. INSERT ODKU de la fila del bloque.
//  3. Las lecturas planas (ZONA, HORARIO, conteos) abri Aqui el snapshot de
//     REPEATABLE READ, ya con ambos locks tomados.
// Cualquier lectura plana antes del ODKU abriria el snapshot antes de tocar la
// fila del bloque y MariaDB responderia 1020 (ER_CHECKREAD); por eso las
// sentencias 1 y 2 son bloqueantes. El lock del apartamento (1) es la clave de
// la correccion TOCTOU de los limites dia/semana (3): un perdedor de la
// carrera espera el commit del ganador en (1) y su snapshot, abierto despues,
// ya incluye las reservas comprometidas del apartamento, por lo que el conteo
// (3) es real y no una foto anterior. Sin este lock, dos POST del MISMO
// apartamento en bloques distintos ni siquiera se ven entre si (filas de
// OCUPACION_BLOQUE distintas, sin contencion). Apartamentos distintos bloquean
// filas distintas: la concurrencia entre usuarios sigue siendo paralela.
async function transaccionReserva(
  conn: PoolConnection,
  usuarioId: string,
  apartamentoId: string,
  datos: z.infer<typeof esquemaCrear>,
  maxReservasDia: number,
  maxReservasSemana: number,
): Promise<Reserva> {
  // (1) Serializa por apartamento ANTES de contar los limites dia/semana.
  await conn.query(`SELECT id FROM APARTAMENTO WHERE id = ? FOR UPDATE`, [
    apartamentoId,
  ]);

  // (2) Asegura la fila del bloque sin bloquear de mas (no-op si ya existe) y
  // toma su lock: aqui se serializan los POST concurrentes del mismo bloque.
  await conn.query(
    `INSERT INTO OCUPACION_BLOQUE (zona_id, fecha, hora_inicio, cupos_ocupados)
     VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE zona_id = zona_id`,
    [datos.zonaId, datos.fecha, datos.horaInicio],
  );

  // Revalidacion de la configuracion vigente dentro de la transaccion: aforo,
  // duracion y maximo por reserva pueden haber cambiado entre el GET y el POST.
  const [zonas] = await conn.query<RowDataPacket[]>(
    `SELECT aforo, duracion_bloque_min, max_cupos_reserva
     FROM ZONA WHERE id = ? AND activa = 1`,
    [datos.zonaId],
  );
  const zona = zonas[0] as FilaZona | undefined;
  if (!zona) {
    throw new NotFoundError('La zona no existe o no esta activa');
  }

  if (datos.cupos > Number(zona.max_cupos_reserva)) {
    throw new ValidationError('Los cupos superan el maximo por reserva');
  }

  const dia = diaSemanaDeFecha(datos.fecha);
  const [horarios] = await conn.query<RowDataPacket[]>(
    `SELECT apertura, cierre FROM HORARIO_ZONA
     WHERE zona_id = ? AND dia_semana = ?`,
    [datos.zonaId, dia],
  );
  const horario = horarios[0] as FilaHorario | undefined;
  if (!horario) {
    throw new ValidationError('La zona no tiene horario ese dia');
  }

  const bloques = generarBloques(
    String(horario.apertura).slice(0, 5),
    String(horario.cierre).slice(0, 5),
    Number(zona.duracion_bloque_min),
  );
  const bloque = bloques.find((b) => b.horaInicio === datos.horaInicio);
  if (!bloque) {
    throw new ValidationError('El bloque no esta en el horario de la zona');
  }

  // (3) Limites del apartamento (9.3): lectura de snapshot, segura porque el
  // lock del apartamento en (1) la abre despues del ultimo commit propio.
  const enDia = await contarNoCanceladas(conn, apartamentoId, 'fecha = ?', [
    datos.fecha,
  ]);
  if (enDia >= maxReservasDia) {
    throw new ConflictError('El apartamento ya tiene el maximo de reservas para ese dia');
  }

  const enSemana = await contarNoCanceladas(
    conn,
    apartamentoId,
    `fecha BETWEEN DATE_SUB(?, INTERVAL WEEKDAY(?) DAY)
       AND DATE_ADD(?, INTERVAL 6 - WEEKDAY(?) DAY)`,
    [datos.fecha, datos.fecha, datos.fecha, datos.fecha],
  );
  if (enSemana >= maxReservasSemana) {
    throw new ConflictError('El apartamento ya tiene el maximo de reservas para esa semana');
  }

  // Incremento atomico: la fila solo se actualiza si el bloque cabe contra el
  // aforo vigente. affectedRows = 0 significa sin cupo (o zona inactiva).
  const [actualizacion] = await conn.query<ResultSetHeader>(
    `UPDATE OCUPACION_BLOQUE
     SET cupos_ocupados = cupos_ocupados + ?
     WHERE zona_id = ? AND fecha = ? AND hora_inicio = ?
       AND cupos_ocupados + ? <= (SELECT aforo FROM ZONA WHERE id = ? AND activa = 1)`,
    [
      datos.cupos,
      datos.zonaId,
      datos.fecha,
      datos.horaInicio,
      datos.cupos,
      datos.zonaId,
    ],
  );
  if (actualizacion.affectedRows === 0) {
    throw new ConflictError('No hay cupo suficiente en ese bloque');
  }

  // Con el lock de la fila del bloque ya tomado, lectura bloqueante del
  // ultimo estado comprometido: el doble submit del mismo apartamento se
  // serializa aqui y el ROLLBACK revierte el incremento del contador.
  const [duplicadas] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM RESERVA
     WHERE apartamento_id = ? AND zona_id = ? AND fecha = ? AND hora_inicio = ?
       AND estado <> 'CANCELADA'
     FOR UPDATE`,
    [apartamentoId, datos.zonaId, datos.fecha, datos.horaInicio],
  );
  if (duplicadas.length > 0) {
    throw new ConflictError('El apartamento ya tiene una reserva en ese bloque');
  }

  const id = randomUUID();
  await conn.query(
    `INSERT INTO RESERVA (id, apartamento_id, zona_id, fecha, hora_inicio, hora_fin, cupos, estado, creada_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMADA', UTC_TIMESTAMP(3))`,
    [
      id,
      apartamentoId,
      datos.zonaId,
      datos.fecha,
      datos.horaInicio,
      bloque.horaFin,
      datos.cupos,
    ],
  );

  // Notificacion in-app a los residentes activos, en la MISMA transaccion:
  // si la reserva se revierte, la notificacion tambien. Va despues de los
  // locks APARTAMENTO -> OCUPACION_BLOQUE -> RESERVA; el INSERT solo anade
  // locks compartidos (FK) sobre USUARIO y la propia RESERVA, sin ciclo nuevo.
  await notificarApartamento(conn, apartamentoId, {
    reservaId: id,
    tipo: 'CONFIRMACION',
    titulo: 'Reserva confirmada',
    mensaje: `Tu reserva del ${datos.fecha} de ${datos.horaInicio} a ${bloque.horaFin} por ${datos.cupos} cupo(s) quedó confirmada.`,
  });

  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT id, apartamento_id, zona_id, DATE_FORMAT(fecha, '%Y-%m-%d') fecha,
            hora_inicio, hora_fin, cupos, estado,
            CONCAT(DATE_FORMAT(creada_en, '%Y-%m-%dT%H:%i:%s.%f'), 'Z') creada_en
     FROM RESERVA WHERE id = ?`,
    [id],
  );
  const fila = filas[0] as FilaReserva;

  return {
    id: fila.id,
    apartamentoId: fila.apartamento_id,
    zonaId: fila.zona_id,
    fecha: fila.fecha,
    horaInicio: String(fila.hora_inicio).slice(0, 5),
    horaFin: String(fila.hora_fin).slice(0, 5),
    cupos: Number(fila.cupos),
    estado: fila.estado,
    creadaEn: fila.creada_en,
  };
}

export async function crearReserva(
  usuario: UsuarioSesion,
  input: CrearReservaInput,
): Promise<Reserva> {
  if (!usuario.apartamentoId) {
    throw new ForbiddenError('El usuario no tiene apartamento');
  }

  const resultado = esquemaCrear.safeParse(input);
  if (!resultado.success) {
    throw new ValidationError(resultado.error.issues[0].message);
  }
  const datos = resultado.data;

  const zona = await obtenerZonaActiva(datos.zonaId);
  if (!zona) {
    throw new NotFoundError('La zona no existe o no esta activa');
  }

  const parametros = await obtenerParametros();
  const hoy = hoyBogota();
  if (datos.fecha < hoy || datos.fecha > sumarDias(hoy, parametros.anticipacionDias)) {
    throw new ValidationError('La fecha esta fuera del rango de anticipacion');
  }

  return conReintento((conn) =>
    transaccionReserva(
      conn,
      usuario.id,
      usuario.apartamentoId!,
      datos,
      parametros.maxReservasDia,
      parametros.maxReservasSemana,
    ),
  );
}
