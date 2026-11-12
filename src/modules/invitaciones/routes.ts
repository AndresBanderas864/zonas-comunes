import { Router } from 'express';
import type { Request, Response } from 'express';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { requireRole } from '../../middleware/require-role';
import { listarApartamentos } from '../apartamentos/service';
import {
  crearInvitacion,
  listarInvitaciones,
  revocarInvitacion,
} from './service';

export const invitacionesRoutes = Router();

const soloAdmin = requireRole('ADMINISTRADOR');

function actor(req: Request) {
  return req.usuario!;
}

async function renderListado(
  res: Response,
  estado: number,
  error: string | null,
  apartamentoIdSeleccionado: string | null,
): Promise<void> {
  const [invitaciones, apartamentos] = await Promise.all([
    listarInvitaciones(),
    listarApartamentos(),
  ]);
  res.status(estado).render('admin/invitaciones', {
    titulo: 'Invitaciones',
    invitaciones,
    apartamentos,
    seleccionado: apartamentoIdSeleccionado,
    error,
  });
}

invitacionesRoutes.get('/invitaciones', soloAdmin, async (_req, res) => {
  const [invitaciones, apartamentos] = await Promise.all([
    listarInvitaciones(),
    listarApartamentos(),
  ]);
  res.render('admin/invitaciones', {
    titulo: 'Invitaciones',
    invitaciones,
    apartamentos,
    seleccionado: null,
    error: null,
  });
});

invitacionesRoutes.post('/invitaciones', soloAdmin, async (req, res) => {
  const apartamentoId = String(req.body?.apartamentoId ?? '');

  try {
    const { token } = await crearInvitacion(apartamentoId, actor(req));
    req.flash('info', `Enlace de invitacion (valido 7 dias): /registro/${token}`);
    res.redirect('/admin/invitaciones');
  } catch (error) {
    if (error instanceof ValidationError) {
      await renderListado(res, 400, error.message, apartamentoId);
      return;
    }
    throw error;
  }
});

invitacionesRoutes.post(
  '/invitaciones/:id/revocar',
  soloAdmin,
  async (req, res) => {
    const id = String(req.params.id);

    try {
      await revocarInvitacion(id, actor(req));
      req.flash('exito', 'Invitacion revocada.');
      res.redirect('/admin/invitaciones');
    } catch (error) {
      if (error instanceof NotFoundError) {
        await renderListado(res, 404, error.message, null);
        return;
      }
      if (error instanceof ConflictError) {
        await renderListado(res, 409, error.message, null);
        return;
      }
      throw error;
    }
  },
);
