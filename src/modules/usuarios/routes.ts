import { Router } from 'express';
import type { Request, Response } from 'express';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { requireRole } from '../../middleware/require-role';
import { desactivarUsuario, listarUsuarios } from './service';

export const usuariosRoutes = Router();

const soloAdmin = requireRole('ADMINISTRADOR');

function actor(req: Request) {
  return req.usuario!;
}

async function renderListado(
  res: Response,
  estado: number,
  error: string | null,
): Promise<void> {
  const usuarios = await listarUsuarios();
  res.status(estado).render('admin/usuarios', {
    titulo: 'Usuarios',
    usuarios,
    error,
  });
}

usuariosRoutes.get('/usuarios', soloAdmin, async (_req, res) => {
  const usuarios = await listarUsuarios();
  res.render('admin/usuarios', {
    titulo: 'Usuarios',
    usuarios,
    error: null,
  });
});

usuariosRoutes.post(
  '/usuarios/:id/desactivar',
  soloAdmin,
  async (req, res) => {
    const id = String(req.params.id);

    try {
      await desactivarUsuario(id, actor(req));
      req.flash('exito', 'Usuario desactivado.');
      res.redirect('/admin/usuarios');
    } catch (error) {
      if (error instanceof ValidationError) {
        await renderListado(res, 400, error.message);
        return;
      }
      if (error instanceof NotFoundError) {
        res.status(404).render('errors/404', { titulo: 'Usuario no encontrado' });
        return;
      }
      if (error instanceof ConflictError) {
        await renderListado(res, 409, error.message);
        return;
      }
      throw error;
    }
  },
);
