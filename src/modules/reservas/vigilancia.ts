import { Router } from 'express';
import { query } from '../../db/pool';
import { ValidationError } from '../../lib/errors';
import { requireRole } from '../../middleware/require-role';

// Vista de vigilancia (RF-30): solo lectura del dia. Muestra quien ocupa o
// ocupara cada zona, con la identificacion del apartamento. No hay rutas de
// escritura montadas aqui: el vigilante consulta y nada mas.

export type ReservaDeVigilancia = {
  apartamento: string;
  zona: string;
  horaInicio: string;
  horaFin: string;
  cupos: number;
};

type Fila = {
  apartamento: string;
  zona: string;
  hora_inicio: string;
  hora_fin: string;
  cupos: number;
};

// Estados incluidos: CONFIRMADA si, y VENCIDA tambien. Una vencida ocurrio:
// el bloque ya paso pero el ocupante puede seguir en la zona, y la spec
// (9.6) dice que cuenta como uso. CANCELADA queda fuera porque nunca ocupo
// nada. Sirve el indice RESERVA(fecha, estado).
export async function reservasDelDia(
  fecha: string,
): Promise<ReservaDeVigilancia[]> {
  const filas = await query<Fila>(
    `SELECT CONCAT(a.torre_interior, ' · ', a.numero) AS apartamento,
            z.nombre AS zona,
            TIME_FORMAT(r.hora_inicio, '%H:%i') AS hora_inicio,
            TIME_FORMAT(r.hora_fin, '%H:%i') AS hora_fin,
            r.cupos
     FROM RESERVA r
     JOIN APARTAMENTO a ON a.id = r.apartamento_id
     JOIN ZONA z ON z.id = r.zona_id
     WHERE r.fecha = ? AND r.estado IN ('CONFIRMADA', 'VENCIDA')
     ORDER BY z.nombre, r.hora_inicio, r.id`,
    [fecha],
  );

  return filas.map((fila) => ({
    apartamento: fila.apartamento,
    zona: fila.zona,
    horaInicio: fila.hora_inicio,
    horaFin: fila.hora_fin,
    cupos: Number(fila.cupos),
  }));
}

// Misma convencion de rutas de reservas y administracion: AAAA-MM-DD con
// validacion de calendario antes de tocar la base.
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function validarFecha(valor: string): string {
  if (!PATRON_FECHA.test(valor)) {
    throw new ValidationError('La fecha debe tener formato AAAA-MM-DD');
  }
  const [anio, mes, dia] = valor.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(anio!, mes ?? 0, 0)).getUTCDate();
  if (
    (mes ?? 0) < 1 ||
    (mes ?? 0) > 12 ||
    (dia ?? 0) < 1 ||
    (!Number.isNaN(ultimoDia) && (dia ?? 0) > ultimoDia)
  ) {
    throw new ValidationError('La fecha no existe en el calendario');
  }
  return valor;
}

function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const vigilanciaRoutes = Router();

vigilanciaRoutes.get('/', requireRole('VIGILANTE', 'ADMINISTRADOR'), async (req, res) => {
  const recibido = typeof req.query.fecha === 'string' ? req.query.fecha.trim() : '';
  const fecha = recibido === '' ? hoyBogota() : validarFecha(recibido);
  const reservas = await reservasDelDia(fecha);
  res.render('vigilancia/hoy', { titulo: 'Vigilancia del día', fecha, reservas });
});
