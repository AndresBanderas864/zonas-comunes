import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('layout base', () => {
  it('el layout no muestra /admin a un residente', async () => {
    const res = await request(createApp()).get('/_test/layout?rol=RESIDENTE');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('/admin/zonas');
    expect(res.text).toContain('/mis-reservas');
    expect(res.text).toContain('lang="es"');
    expect(res.text).toContain('name="viewport"');
    expect(res.text).toContain('Saltar al contenido');
  });

  it('muestra los enlaces administrativos al administrador', async () => {
    const res = await request(createApp()).get('/_test/layout?rol=ADMINISTRADOR');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/admin/zonas');
    expect(res.text).not.toContain('/mis-reservas');
  });

  it('muestra la vista de vigilancia al vigilante', async () => {
    const res = await request(createApp()).get('/_test/layout?rol=VIGILANTE');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/vigilancia');
    expect(res.text).not.toContain('/admin/zonas');
  });

  it('avisa cuando el correo no esta verificado', async () => {
    const res = await request(createApp()).get(
      '/_test/layout?rol=RESIDENTE&verificado=0',
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain('Tu correo no está verificado');
  });
});
