import type { RowDataPacket } from 'mysql2/promise';
import { query, withTransaction } from '../db/pool';
import { notificarApartamento } from '../modules/notificaciones/service';
import { fechaHoraBogota } from './vencidas';

// RF-28/DV-07: recordatorio de la reserva que empieza en ~1 hora. La ventana
// 55-65 minutos (cruce inclusive) con pasada cada 5 min garantiza que todo
// inicio de reserva cae al menos en una ejecucion.
// Anti-duplicado: NOT EXISTS sobre NOTIFICACION(tipo='RECORDATORIO',
// reserva_id). Se elige NOT EXISTS en lugar de un UNIQUE(reserva_id, tipo):
// reserva_id es NULL en notificaciones sin reserva y compartida con
// CONFIRMACION/CANCELACION, y anadir una migracion 002 solo por esto pesa mas
// que el riesgo real (cron de instancia unica, sin concurrencia).
type FilaRecordatable = {
  id: string;
  apartamento_id: string;
  zona_nombre: string;
  fecha: string;
  hora_inicio: string;
};

export async function crearRecordatorios(
  ahora: Date = new Date(),
): Promise<number> {
  const pared = fechaHoraBogota(ahora);
  const reservas = await query<FilaRecordatable>(
    `SELECT r.id, r.apartamento_id, z.nombre AS zona_nombre,
            DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha,
            TIME_FORMAT(r.hora_inicio, '%H:%i') AS hora_inicio
     FROM RESERVA r
     JOIN ZONA z ON z.id = r.zona_id
     WHERE r.estado = 'CONFIRMADA'
       AND r.apartamento_id IS NOT NULL
       AND TIMESTAMP(r.fecha, r.hora_inicio)
           BETWEEN DATE_ADD(?, INTERVAL 55 MINUTE)
               AND DATE_ADD(?, INTERVAL 65 MINUTE)
       AND NOT EXISTS (
         SELECT 1 FROM NOTIFICACION n
         WHERE n.reserva_id = r.id AND n.tipo = 'RECORDATORIO'
       )
     ORDER BY r.id`,
    [pared, pared],
  );

  for (const reserva of reservas) {
    await withTransaction(async (conn) => {
      await notificarApartamento(conn, reserva.apartamento_id, {
        reservaId: reserva.id,
        tipo: 'RECORDATORIO',
        titulo: 'Recordatorio de reserva',
        mensaje: `Tu reserva de ${reserva.zona_nombre} es hoy a las ${reserva.hora_inicio}.`,
      });
    });
  }

  return reservas.length;
}
