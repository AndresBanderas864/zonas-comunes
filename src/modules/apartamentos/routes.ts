import { Router } from 'express';
import type { Request, Response } from 'express';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { requireRole } from '../../middleware/require-role';
import {
  actualizarApartamento,
  crearApartamento,
  eliminarApartamento,
  listarApartamentos,
  obtenerApartamento,
  type Apartamento,
} from './service';

export const apartamentosRoutes = Router();

const soloAdmin = requireRole('ADMINISTRADOR');

function actorId(req: Request): string {
  return req.usuario!.id;
}

function valoresRecibidos(req: Request): Record<string, unknown> {
  return {
    torreInterior: String(req.body?.torreInterior ?? ''),
    numero: String(req.body?.numero ?? ''),
  };
}

type ContextoFormulario = {
  apartamento: Apartamento | null;
  valores: Record<string, unknown> | null;
  error: string | null;
};

async function renderListado(
  res: Response,
  estado: number,
  contexto: ContextoFormulario,
): Promise<void> {
  const apartamentos = await listarApartamentos();
  res.status(estado).render('admin/apartamentos', {
    titulo: 'Apartamentos',
    apartamentos,
    editando: contexto.apartamento,
    valores: contexto.valores,
    error: contexto.error,
  });
}

apartamentosRoutes.get('/apartamentos', soloAdmin, async (_req, res) => {
  const apartamentos = await listarApartamentos();
  res.render('admin/apartamentos', {
    titulo: 'Apartamentos',
    apartamentos,
    editando: null,
    valores: null,
    error: null,
  });
});

apartamentosRoutes.post('/apartamentos', soloAdmin, async (req, res) => {
  const valores = valoresRecibidos(req);

  try {
    await crearApartamento(req.body, actorId(req));
    req.flash('exito', 'Apartamento creado.');
    res.redirect('/admin/apartamentos');
  } catch (error) {
    if (error instanceof ValidationError) {
      await renderListado(res, 400, { apartamento: null, valores, error: error.message });
      return;
    }
    if (error instanceof ConflictError) {
      await renderListado(res, 409, { apartamento: null, valores, error: error.message });
      return;
    }
    throw error;
  }
});

apartamentosRoutes.get('/apartamentos/:id', soloAdmin, async (req, res) => {
  const apartamento = await obtenerApartamento(String(req.params.id));
  if (!apartamento) {
    res.status(404).render('errors/404', { titulo: 'Apartamento no encontrado' });
    return;
  }
  const apartamentos = await listarApartamentos();
  res.render('admin/apartamentos', {
    titulo: 'Apartamentos',
    apartamentos,
    editando: apartamento,
    valores: apartamento,
    error: null,
  });
});

apartamentosRoutes.post('/apartamentos/:id', soloAdmin, async (req, res) => {
  const id = String(req.params.id);
  const existente = await obtenerApartamento(id);
  if (!existente) {
    res.status(404).render('errors/404', { titulo: 'Apartamento no encontrado' });
    return;
  }

  const valores = valoresRecibidos(req);

  try {
    await actualizarApartamento(id, req.body, actorId(req));
    req.flash('exito', 'Apartamento actualizado.');
    res.redirect('/admin/apartamentos');
  } catch (error) {
    if (error instanceof ValidationError) {
      await renderListado(res, 400, { apartamento: existente, valores, error: error.message });
      return;
    }
    if (error instanceof ConflictError) {
      await renderListado(res, 409, { apartamento: existente, valores, error: error.message });
      return;
    }
    throw error;
  }
});

apartamentosRoutes.post(
  '/apartamentos/:id/eliminar',
  soloAdmin,
  async (req, res) => {
    const id = String(req.params.id);

    try {
      await eliminarApartamento(id, actorId(req));
      req.flash('exito', 'Apartamento eliminado.');
      res.redirect('/admin/apartamentos');
    } catch (error) {
      if (error instanceof NotFoundError) {
        await renderListado(res, 404, { apartamento: null, valores: null, error: error.message });
        return;
      }
      if (error instanceof ConflictError) {
        await renderListado(res, 409, { apartamento: null, valores: null, error: error.message });
        return;
      }
      throw error;
    }
  },
);
