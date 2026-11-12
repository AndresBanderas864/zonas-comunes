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

// Cada envio se procesa en su propia micro-transaccion: un fallo de red en
// el canal no revierte los envios ya despachados en la pasada. La seleccion
// usa FOR UPDATE SKIP LOCKED para que dos despachadores concurrentes jams
// pisen el mismo registro.
export async function despacharPendientes(
  canal: CanalEnvio,
  limite = LIMITE_POR_PASADA,
): Promise<{ enviados: number; fallidos: number }> {
  const pendientes: EnvioPendiente[] = await withTransaction((conn) =>
    seleccionarPendientes(conn, canal.canal, limite),
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

    const resultado = await withTransaction((conn) =>
      registrarIntento(conn, envio.id, ok),
    );

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
