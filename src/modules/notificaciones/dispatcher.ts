import { withTransaction } from '../../db/pool';
import {
  registrarIntento,
  seleccionarPendientes,
  type EnvioPendiente,
} from './repository';

export type Canal = 'CORREO' | 'PUSH';

export type Envio = {
  id: string;
  notificacionId: string;
  canal: Canal;
  intentos: number;
};

export interface CanalEnvio {
  canal: Canal;
  enviar(envio: Envio): Promise<void>;
}

const MAX_INTENTOS = 3;
const LIMITE_POR_PASADA = 50;

// Una sola transaccion abierta para toda la pasada: la seleccion FOR UPDATE
// SKIP LOCKED toma y CONSERVA los locks de los envios elegidos hasta el
// commit final, asi que un segundo despachador concurrente jamas ve esas
// filas y nunca se ejecuta enviar() dos veces para el mismo envio. (La
// alternativa de reclamar con un estado 'ENVIANDO' queda descartada: el
// CHECK chk_envio_estado de 001_init.sql solo admite PENDIENTE, ENVIADO y
// FALLIDO.)
// Costo honesto del diseno: si la transaccion aborta a mitad de la pasada
// (caidas del proceso o de la base entre envios), el bookkeeping de los
// envios YA enviados en esta pasada se revierte y la siguiente pasada los
// vuelve a enviar. Semantica at-least-once: el canal debe tolerar entregas
// duplicadas o ser idempotente. Un fallo de enviar() NO aborta la pasada:
// se captura y se registra como intento fallido dentro de la misma tx.
export async function despacharPendientes(
  canal: CanalEnvio,
  limite = LIMITE_POR_PASADA,
): Promise<{ enviados: number; fallidos: number }> {
  return withTransaction(async (conn) => {
    const pendientes: EnvioPendiente[] = await seleccionarPendientes(
      conn,
      canal.canal,
      limite,
    );

    let enviados = 0;
    let fallidos = 0;

    for (const pendiente of pendientes) {
      const envio: Envio = {
        id: pendiente.id,
        notificacionId: pendiente.notificacionId,
        canal: canal.canal,
        intentos: pendiente.intentos,
      };

      let ok = true;
      try {
        await canal.enviar(envio);
      } catch {
        ok = false;
      }

      // El lock de la fila ya se tiene desde la seleccion: registrarIntento
      // en la MISMA conn no bloquea ni puede ver otro estado.
      const resultado = await registrarIntento(conn, envio.id, ok);

      if (resultado === 'NADA') {
        continue;
      }
      if (ok) {
        enviados++;
      } else {
        fallidos++;
      }
    }

    return { enviados, fallidos };
  });
}

// Implementacion simulada exigida por la spec (seccion 12): escribe en el
// log y marca ENVIADO. Los adaptadores reales de correo y push quedan como
// interfaz CanalEnvio sin implementacion.
export const despachadorConsola: CanalEnvio = {
  canal: 'CORREO',
  async enviar(envio: Envio): Promise<void> {
    console.info(
      `[notificaciones] envio ${envio.id} (notificacion ${envio.notificacionId}) por ${envio.canal}, intento ${envio.intentos + 1} de ${MAX_INTENTOS}`,
    );
  },
};
