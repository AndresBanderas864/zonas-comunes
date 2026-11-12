import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/pool';
import { hashToken } from '../src/lib/crypto';
import { NotFoundError } from '../src/lib/errors';
import { textoVigente } from '../src/modules/datos-personales/service';

const app = createApp();

type TipoTexto = 'AUTORIZACION' | 'POLITICA' | 'AVISO_PRIVACIDAD';

// vigencia 'futuro' deja el texto fuera de textoVigente sin depender de la
// hora local del proceso Node (DATE_ADD sobre UTC_TIMESTAMP(3) en MariaDB).
async function sembrarTextoLegal(
  tipo: TipoTexto,
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

async function sembrarInvitacionVigente(): Promise<string> {
  const apartamentoId = randomUUID();
  const adminId = randomUUID();

  await query(
    'INSERT INTO APARTAMENTO (id, torre_interior, numero) VALUES (?, ?, ?)',
    [apartamentoId, 'A', '101'],
  );
  await query(
    `INSERT INTO USUARIO (id, rol, nombre, correo, password_hash, estado)
     VALUES (?, 'ADMINISTRADOR', 'Admin', 'admin@ecc.local', 'x', 'ACTIVA')`,
    [adminId],
  );

  const token = `inv-${randomUUID()}`;
  await query(
    `INSERT INTO INVITACION (id, apartamento_id, creada_por, token_hash, estado, vence_en)
     VALUES (?, ?, ?, ?, 'VIGENTE', ?)`,
    [randomUUID(), apartamentoId, adminId, hashToken(token), new Date(Date.now() + 86_400_000)],
  );
  return token;
}

describe('textoVigente', () => {
  it('devuelve la version maxima vigente del tipo pedido, ignorando futuras y otros tipos', async () => {
    await sembrarTextoLegal('AVISO_PRIVACIDAD', 1, 'Aviso v1.');
    await sembrarTextoLegal('AVISO_PRIVACIDAD', 2, 'Aviso v2.');
    await sembrarTextoLegal('AVISO_PRIVACIDAD', 3, 'Aviso v3 futuro', 'futuro');
    await sembrarTextoLegal('POLITICA', 9, 'No es aviso.');

    const aviso = await textoVigente('AVISO_PRIVACIDAD');
    expect(aviso.tipo).toBe('AVISO_PRIVACIDAD');
    expect(aviso.version).toBe(2);
    expect(aviso.contenido).toBe('Aviso v2.');
  });

  it('lanza NotFoundError cuando no hay ninguna version vigente del tipo', async () => {
    await sembrarTextoLegal('POLITICA', 1, 'Politica v1.');
    await expect(textoVigente('AVISO_PRIVACIDAD')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('GET /politica y GET /aviso-privacidad (RF-39)', () => {
  it('la politica vigente es publica: 200 sin sesion, sin revelar la version futura', async () => {
    await sembrarTextoLegal('POLITICA', 1, 'Politica v1 publica.');
    await sembrarTextoLegal('POLITICA', 2, 'Politica v2 publica.');
    await sembrarTextoLegal('POLITICA', 3, 'Politica v3 futura no visible', 'futuro');

    const res = await request(app).get('/politica').set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Politica v2 publica.');
    expect(res.text).not.toContain('v3 futura');
  });

  it('el aviso de privacidad vigente es publico: 200 sin sesion', async () => {
    await sembrarTextoLegal('AVISO_PRIVACIDAD', 1, 'Aviso de privacidad vigente.');

    const res = await request(app).get('/aviso-privacidad').set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Aviso de privacidad vigente.');
  });

  it('el texto inyectado sale escapado, nunca como HTML', async () => {
    await sembrarTextoLegal('POLITICA', 1, '<script>alert(1)</script>');

    const res = await request(app).get('/politica').set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('&lt;script&gt;');
    expect(res.text).not.toContain('<script>alert(1)');
  });

  it('los parrafos se preservan: salto doble en <p> y salto simple en <br />', async () => {
    await sembrarTextoLegal(
      'AVISO_PRIVACIDAD',
      1,
      'Primero.\n\nSegundo parrafo.\ncon dos lineas.',
    );

    const res = await request(app).get('/aviso-privacidad').set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<p>Primero.</p>');
    expect(res.text).toContain('<p>Segundo parrafo.<br />con dos lineas.</p>');
  });

  it('sin POLITICA vigente responde 404 con copy claro en espanol', async () => {
    await sembrarTextoLegal('POLITICA', 2, 'Politica futura', 'futuro');

    const res = await request(app).get('/politica').set('Accept', 'text/html');

    expect(res.status).toBe(404);
    expect(res.text).toContain('Aún no hay una política de datos publicada.');
  });

  it('sin AVISO_PRIVACIDAD vigente responde 404 con copy claro en espanol', async () => {
    const res = await request(app)
      .get('/aviso-privacidad')
      .set('Accept', 'text/html');

    expect(res.status).toBe(404);
    expect(res.text).toContain('Aún no hay un aviso de privacidad publicado.');
  });
});

describe('enlaces desde el registro y el menu (RF-39)', () => {
  it('el formulario de registro enlaza la politica y el aviso de privacidad', async () => {
    const token = await sembrarInvitacionVigente();

    const res = await request(app).get(`/registro/${token}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/politica"');
    expect(res.text).toContain('href="/aviso-privacidad"');
  });

  it('el menu enlaza ambos textos con sesion iniciada', async () => {
    const res = await request(app).get('/_test/layout?rol=RESIDENTE');

    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/politica"');
    expect(res.text).toContain('href="/aviso-privacidad"');
  });

  it('el menu sin sesion tambien los enlaza: son publicos', async () => {
    const res = await request(app).get('/login');

    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/politica"');
    expect(res.text).toContain('href="/aviso-privacidad"');
  });
});
