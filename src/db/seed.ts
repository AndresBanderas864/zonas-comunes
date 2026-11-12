import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

type Conexion = Pool | PoolConnection;

const PASSWORD_DEMO = 'Demo1234!';

const APARTAMENTOS = ['A', 'B', 'C'].flatMap((torre) =>
  ['101', '102', '103', '104'].map((numero) => ({
    torreInterior: torre,
    numero,
  })),
);

const ZONAS = [
  { nombre: 'BBQ', aforo: 12, duracionBloqueMin: 240, apertura: '10:00', cierre: '22:00' },
  { nombre: 'PISCINA', aforo: 20, duracionBloqueMin: 120, apertura: '08:00', cierre: '20:00' },
  { nombre: 'GIMNASIO', aforo: 10, duracionBloqueMin: 120, apertura: '08:00', cierre: '20:00' },
  { nombre: 'CANCHA', aforo: 16, duracionBloqueMin: 120, apertura: '08:00', cierre: '20:00' },
  { nombre: 'JUEGOS', aforo: 8, duracionBloqueMin: 120, apertura: '08:00', cierre: '20:00' },
];

const TEXTOS_LEGALES = [
  { tipo: 'AUTORIZACION', contenido: 'Autorizo el tratamiento de mis datos personales para la gestion de zonas comunes.' },
  { tipo: 'POLITICA', contenido: 'Politica de tratamiento de datos personales del conjunto residencial.' },
  { tipo: 'AVISO_PRIVACIDAD', contenido: 'Aviso de privacidad: los datos se usan solo para la operacion del sistema.' },
];

async function idDeApartamento(
  conn: Conexion,
  torreInterior: string,
  numero: string,
): Promise<string> {
  const [filas] = await conn.query<RowDataPacket[]>(
    'SELECT id FROM APARTAMENTO WHERE torre_interior = ? AND numero = ?',
    [torreInterior, numero],
  );
  return String(filas[0].id);
}

async function idDeZona(conn: Conexion, nombre: string): Promise<string> {
  const [filas] = await conn.query<RowDataPacket[]>(
    'SELECT id FROM ZONA WHERE nombre = ?',
    [nombre],
  );
  return String(filas[0].id);
}

export async function runSeed(conn: Conexion): Promise<void> {
  for (const apartamento of APARTAMENTOS) {
    await conn.query(
      `INSERT INTO APARTAMENTO (id, torre_interior, numero)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE numero = VALUES(numero)`,
      [randomUUID(), apartamento.torreInterior, apartamento.numero],
    );
  }

  for (const zona of ZONAS) {
    const zonaId = randomUUID();
    await conn.query(
      `INSERT INTO ZONA (id, nombre, aforo, duracion_bloque_min, max_cupos_reserva, activa)
       VALUES (?, ?, ?, ?, 4, 1)
       ON DUPLICATE KEY UPDATE aforo = VALUES(aforo),
         duracion_bloque_min = VALUES(duracion_bloque_min),
         max_cupos_reserva = VALUES(max_cupos_reserva)`,
      [zonaId, zona.nombre, zona.aforo, zona.duracionBloqueMin],
    );

    const idZona = await idDeZona(conn, zona.nombre);
    for (let dia = 1; dia <= 7; dia++) {
      await conn.query(
        `INSERT INTO HORARIO_ZONA (id, zona_id, dia_semana, apertura, cierre)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE apertura = VALUES(apertura), cierre = VALUES(cierre)`,
        [randomUUID(), idZona, dia, zona.apertura, zona.cierre],
      );
    }
  }

  const passwordHash = await argon2.hash(PASSWORD_DEMO);

  const usuarios = [
    { nombre: 'Administrador Demo', correo: 'admin@ecc.local', rol: 'ADMINISTRADOR', apartamento: null },
    { nombre: 'Vigilante Demo', correo: 'vigilante@ecc.local', rol: 'VIGILANTE', apartamento: null },
    ...APARTAMENTOS.slice(0, 8).map((apartamento, indice) => ({
      nombre: `Residente Demo ${indice + 1}`,
      correo: `residente${indice + 1}@ecc.local`,
      rol: 'RESIDENTE',
      apartamento,
    })),
  ];

  for (const usuario of usuarios) {
    const apartamentoId = usuario.apartamento
      ? await idDeApartamento(conn, usuario.apartamento.torreInterior, usuario.apartamento.numero)
      : null;

    await conn.query(
      `INSERT INTO USUARIO (id, rol, apartamento_id, nombre, correo, password_hash, estado, correo_verificado)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVA', 1)
       ON DUPLICATE KEY UPDATE nombre = VALUES(nombre),
         apartamento_id = VALUES(apartamento_id)`,
      [randomUUID(), usuario.rol, apartamentoId, usuario.nombre, usuario.correo, passwordHash],
    );
  }

  await conn.query(
    `INSERT INTO PARAMETRO_RESERVA (id, max_reservas_semana, max_reservas_dia, anticipacion_dias)
     VALUES (1, 7, 3, 7)
     ON DUPLICATE KEY UPDATE max_reservas_semana = VALUES(max_reservas_semana),
       max_reservas_dia = VALUES(max_reservas_dia),
       anticipacion_dias = VALUES(anticipacion_dias)`,
  );

  for (const texto of TEXTOS_LEGALES) {
    await conn.query(
      `INSERT INTO TEXTO_LEGAL (id, tipo, version, contenido, vigente_desde)
       VALUES (?, ?, 1, ?, NOW(3))
       ON DUPLICATE KEY UPDATE contenido = VALUES(contenido)`,
      [randomUUID(), texto.tipo, texto.contenido],
    );
  }
}
