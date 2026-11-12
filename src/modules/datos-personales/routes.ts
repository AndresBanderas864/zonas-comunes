import { Router } from 'express';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type { TextoLegal } from './service';
import {
  aceptarPolitica,
  actualizarNombre,
  politicaAceptada,
  politicaVigente,
} from './service';

export const datosPersonalesRoutes = Router();

// La vista no es inaccesible porque falte el texto legal sembrado:
// sin POLITICA vigente se renderiza sin la seccion de politica.
async function politicaParaVista(): Promise<TextoLegal | null> {
  try {
    return await politicaVigente();
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

datosPersonalesRoutes.get('/', async (req, res) => {
  const usuario = req.usuario!;
  const politica = await politicaParaVista();
  const aceptada = politica
    ? await politicaAceptada(usuario.id, politica.id)
    : false;

  res.render('cuenta/mi-cuenta', {
    titulo: 'Mi cuenta',
    politica,
    aceptada,
    nombreForm: usuario.nombre,
    error: null,
  });
});

datosPersonalesRoutes.post('/nombre', async (req, res) => {
  const usuario = req.usuario!;
  const nombre = String(req.body?.nombre ?? '');

  try {
    await actualizarNombre(usuario.id, nombre);
  } catch (error) {
    if (error instanceof ValidationError) {
      const politica = await politicaParaVista();
      res.status(400).render('cuenta/mi-cuenta', {
        titulo: 'Mi cuenta',
        politica,
        aceptada: false,
        nombreForm: nombre,
        error: error.message,
      });
      return;
    }
    throw error;
  }

  req.flash('exito', 'Nombre actualizado.');
  res.redirect('/mi-cuenta');
});

datosPersonalesRoutes.post('/politica', async (req, res) => {
  const usuario = req.usuario!;
  const politica = await politicaVigente();
  await aceptarPolitica(usuario.id, politica.id);

  req.flash('exito', 'Política de datos aceptada.');
  res.redirect('/mi-cuenta');
});
