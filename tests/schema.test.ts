import { describe, expect, it } from 'vitest';
import { query } from '../src/db/pool';

describe('esquema', () => {
  it('crea las 17 tablas y las restricciones clave', async () => {
    const tablas = await query<{ TABLE_NAME: string }>(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
    );
    const nombres = tablas.map((t) => t.TABLE_NAME);
    expect(nombres).toEqual(
      expect.arrayContaining([
        'APARTAMENTO',
        'USUARIO',
        'INVITACION',
        'TOKEN_VERIFICACION',
        'SESION',
        'DISPOSITIVO_PUSH',
        'TEXTO_LEGAL',
        'AUTORIZACION_DATOS',
        'ZONA',
        'HORARIO_ZONA',
        'PARAMETRO_RESERVA',
        'RESERVA',
        'NOTIFICACION',
        'ENVIO_NOTIFICACION',
        'SOLICITUD_DATOS',
        'BITACORA',
        'OCUPACION_BLOQUE',
      ]),
    );

    await expect(
      query(
        "INSERT INTO ZONA (id,nombre,aforo,duracion_bloque_min,max_cupos_reserva,activa) VALUES (UUID(),'X',-1,120,2,1)",
      ),
    ).rejects.toThrow();

    await expect(
      query(
        'INSERT INTO PARAMETRO_RESERVA (id,max_reservas_semana,max_reservas_dia,anticipacion_dias) VALUES (2,7,3,7)',
      ),
    ).rejects.toThrow();
  });
});
