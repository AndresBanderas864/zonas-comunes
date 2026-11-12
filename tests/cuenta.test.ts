import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { derivarCsrf } from '../src/lib/crypto';
import { crearSesion, type UsuarioSesion } from '../src/modules/auth/sessions';
import { politicaVigente } from '../src/modules/datos-personales/service';
import { crearUsuarioConApartamento } from './helpers/fixtures';

const app = createApp();

async function credencialesDe(
  usuario: UsuarioSesion,
): Promise<{ cookie: string; csrf: string }> {
  const { token } = await crearSesion(usuario.id);
  return {
    cookie: `sid=${token}`,
    csrf: derivarCsrf(token, process.env.SESSION_SECRET as string),
  };
}

// vigencia 'futuro' deja el texto fuera de politicaVigente sin depender de
// la hora local del proceso Node (DATE_ADD sobre UTC_TIMESTAMP(3) en MariaDB).
async function sembrarTextoLegal(
  tipo: 'AUTORIZACION' | 'POLITICA' | 'AVISO_PRIVACIDAD',
  version: number,
  contenido: string,
  vigencia: 'ahora' | 'futuro' = 'ahora',
): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO TEXTO_LEGAL (id, tipo, version, contenido, vigente_desde)
     VALUES (?, ?, ?, ?, ${
       vigencia === 'futuro'
         ? "DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY)"
         : 'UTC_TIMESTAMP(3)'
     })`,
    [id, tipo, version, contenido],
  );
  return id;
}

async function contarAutorizaciones(
  usuarioId: string,
  textoLegalId: string,
): Promise<number> {
  const [fila] = await query<{ n: number }>(
    'SELECT COUNT(*) n FROM AUTORIZACION_DATOS WHERE usuario_id = ? AND texto_legal_id = ?',
    [usuarioId, textoLegalId],
  );
  return Number(fila!.n);
}

describe('actualizarNombre', () => {
  it('rectificar el nombre persiste y deja registro en BITACORA', async () => {
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    const credenciales = await credencialesDe(usuario);

    const res = await request(app)
      .post('/mi-cuenta/nombre')
      .set('Cookie', credenciales.cookie)
      .send({ nombre: 'María Pérez', _csrf: credenciales.csrf });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/mi-cuenta');

    const filas = await query<{ nombre: string }>(
      'SELECT nombre FROM USUARIO WHERE id = ?',
      [usuario.id],
    );
    expect(filas[0]!.nombre).toBe('María Pérez');

    const bitacora = await query<{ accion: string; entidad: string }>(
      `SELECT accion, entidad FROM BITACORA
       WHERE usuario_id = ? AND entidad = 'USUARIO' AND entidad_id = ?`,
      [usuario.id, usuario.id],
    );
    expect(bitacora.map((f) => f.accion)).toContain('usuario.rectificar_nombre');
  });

  it('un nombre inválido responde 400 y no persiste', async () => {
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    const credenciales = await credencialesDe(usuario);

    const res = await request(app)
      .post('/mi-cuenta/nombre')
      .set('Cookie', credenciales.cookie)
      .send({ nombre: 'M', _csrf: credenciales.csrf });

    expect(res.status).toBe(400);
    expect(res.text).toContain('al menos 2 caracteres');

    const filas = await query<{ nombre: string }>(
      'SELECT nombre FROM USUARIO WHERE id = ?',
      [usuario.id],
    );
    expect(filas[0]!.nombre).toBe(usuario.nombre);

    const [bitacora] = await query<{ n: number }>(
      'SELECT COUNT(*) n FROM BITACORA WHERE usuario_id = ?',
      [usuario.id],
    );
    expect(Number(bitacora!.n)).toBe(0);
  });

  it('sin sesión el POST del nombre responde 401 y no modifica nada', async () => {
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');

    const res = await request(app)
      .post('/mi-cuenta/nombre')
      .send({ nombre: 'Otro Nombre' });

    expect(res.status).toBe(401);

    const filas = await query<{ nombre: string }>(
      'SELECT nombre FROM USUARIO WHERE id = ?',
      [usuario.id],
    );
    expect(filas[0]!.nombre).toBe(usuario.nombre);
  });
});

describe('vista /mi-cuenta', () => {
  it('sin sesión redirige a login', async () => {
    const res = await request(app)
      .get('/mi-cuenta')
      .set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('muestra datos, formulario de nombre y la política vigente, sin formulario de correo', async () => {
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    const politicaId = await sembrarTextoLegal(
      'POLITICA',
      1,
      'Politica de tratamiento de datos personales del conjunto.',
    );
    const credenciales = await credencialesDe(usuario);

    const res = await request(app)
      .get('/mi-cuenta')
      .set('Cookie', credenciales.cookie)
      .set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.text).toContain(usuario.nombre);
    expect(res.text).toContain(usuario.correo);
    expect(res.text).toContain('name="nombre"');
    expect(res.text).toContain('Politica de tratamiento de datos personales del conjunto.');
    expect(res.text).toContain('name="_csrf"');
    // RF-08 fuera de alcance: no existe formulario para rectificar el correo.
    expect(res.text).not.toContain('name="correo"');

    // El escape evita inyeccion de HTML desde la base.
    await query('UPDATE TEXTO_LEGAL SET contenido = ? WHERE id = ?', [
      '<script>alert(1)</script>',
      politicaId,
    ]);
    const xss = await request(app)
      .get('/mi-cuenta')
      .set('Cookie', credenciales.cookie)
      .set('Accept', 'text/html');
    expect(xss.text).toContain('&lt;script&gt;');
  });
});

describe('aceptarPolitica', () => {
  it('aceptar la misma version dos veces crea una sola AUTORIZACION_DATOS', async () => {
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    const politicaId = await sembrarTextoLegal('POLITICA', 1, 'Politica v1.');
    const credenciales = await credencialesDe(usuario);

    const primera = await request(app)
      .post('/mi-cuenta/politica')
      .set('Cookie', credenciales.cookie)
      .send({ _csrf: credenciales.csrf });
    expect(primera.status).toBe(302);

    const segunda = await request(app)
      .post('/mi-cuenta/politica')
      .set('Cookie', credenciales.cookie)
      .send({ _csrf: credenciales.csrf });
    expect(segunda.status).toBe(302);

    expect(await contarAutorizaciones(usuario.id, politicaId)).toBe(1);
  });

  it('una version nueva exige una aceptacion nueva', async () => {
    const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
    const v1 = await sembrarTextoLegal('POLITICA', 1, 'Politica v1.');
    const credenciales = await credencialesDe(usuario);

    await request(app)
      .post('/mi-cuenta/politica')
      .set('Cookie', credenciales.cookie)
      .send({ _csrf: credenciales.csrf });

    const v2 = await sembrarTextoLegal('POLITICA', 2, 'Politica v2.');
    await request(app)
      .post('/mi-cuenta/politica')
      .set('Cookie', credenciales.cookie)
      .send({ _csrf: credenciales.csrf });

    expect(await contarAutorizaciones(usuario.id, v1)).toBe(1);
    expect(await contarAutorizaciones(usuario.id, v2)).toBe(1);
  });
});

describe('politicaVigente', () => {
  it('devuelve la version maxima ya vigente, ignorando versiones futuras', async () => {
    await sembrarTextoLegal('POLITICA', 1, 'Politica v1.');
    await sembrarTextoLegal('POLITICA', 2, 'Politica v2.');
    await sembrarTextoLegal('POLITICA', 3, 'Politica v3 futura', 'futuro');
    await sembrarTextoLegal('AUTORIZACION', 9, 'No es politica.');

    const politica = await politicaVigente();
    expect(politica.tipo).toBe('POLITICA');
    expect(politica.version).toBe(2);
    expect(politica.contenido).toBe('Politica v2.');
    expect(politica.vigenteDesde).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
