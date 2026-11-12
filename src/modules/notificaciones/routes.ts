import { Router } from 'express';
import { NotFoundError } from '../../lib/errors';
import { bandejaDe, marcarLeida } from './service';

export const notificacionesRoutes = Router();

notificacionesRoutes.get('/', async (req, res) => {
  const notificaciones = await bandejaDe(req.usuario!.id);
  res.render('notificaciones/bandeja', {
    titulo: 'Notificaciones',
    notificaciones,
  });
});

notificacionesRoutes.post('/:id/leida', async (req, res) => {
  const encontro = await marcarLeida(req.usuario!.id, String(req.params.id));
  if (!encontro) {
    throw new NotFoundError('La notificación no existe');
  }

  const esNavegador = req.accepts(['json', 'html']) === 'html';
  if (esNavegador) {
    req.flash('exito', 'Notificación marcada como leída.');
    res.redirect('/notificaciones');
    return;
  }

  res.status(204).end();
});
