import { describe, expect, it, vi } from 'vitest';
import { query, withTransaction } from '../src/db/pool';
import {
  despachadorConsolaPush,
  despacharPasada,
  iniciarDespachador,
} from '../src/modules/notificaciones/dispatcher';
import { crearNotificacion } from '../src/modules/notificaciones/service';
import { crearUsuarioConApartamento } from './helpers/fixtures';

// El cron en si no se prueba (cadencia = infraestructura): se invoca la
// funcion de despacho periodica directamente, que es lo que el cron ejecuta.

describe('wiring del despachador periodico', () => {
  it('despacharPasada deja ENVIADOS los pendientes de CORREO y PUSH', async () => {
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    await withTransaction((conn) =>
      crearNotificacion(conn, {
        usuarioId: usuario.id,
        tipo: 'CONFIRMACION',
        titulo: 'Alarma cableada',
        mensaje: 'Debe salir por ambos canales.',
      }),
    );

    // El despacho simulado escribe en el log: se silencia para no ensuciar
    // la salida del test (el contenido del log se comprueba en el test 2).
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    let resultado: { enviados: number; fallidos: number };
    try {
      resultado = await despacharPasada();
    } finally {
      spy.mockRestore();
    }
    expect(resultado).toEqual({ enviados: 2, fallidos: 0 });

    const filas = await query<{ canal: string; estado: string; intentos: number }>(
      `SELECT e.canal, e.estado, e.intentos FROM ENVIO_NOTIFICACION e
       JOIN NOTIFICACION n ON n.id = e.notificacion_id
       WHERE n.titulo = 'Alarma cableada'`,
    );
    const porCanal = Object.fromEntries(
      filas.map((f) => [f.canal, { estado: f.estado, intentos: Number(f.intentos) }]),
    );
    expect(porCanal).toEqual({
      CORREO: { estado: 'ENVIADO', intentos: 1 },
      PUSH: { estado: 'ENVIADO', intentos: 1 },
    });
  });

  it('despachadorConsolaPush etiqueta el canal PUSH en el log simulado', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await despachadorConsolaPush.enviar({
      id: 'envio-1',
      notificacionId: 'noti-1',
      canal: 'PUSH',
      intentos: 0,
    });
    const mensaje = String(spy.mock.calls[0]?.[0] ?? '');
    spy.mockRestore();
    expect(mensaje).toContain('por PUSH');
    expect(despachadorConsolaPush.canal).toBe('PUSH');
  });

  it('iniciarDespachador es no-op con NODE_ENV=test', () => {
    expect(iniciarDespachador()).toBeNull();
  });
});
