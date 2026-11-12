import { Router } from 'express';
import type { Request, Response } from 'express';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { requireRole } from '../../middleware/require-role';
import {
  actualizarZona,
  crearZona,
  listarZonas,
  obtenerZona,
  type ZonaInput,
} from './service';

export const zonasRoutes = Router();

const soloAdmin = requireRole('ADMINISTRADOR');

function actorId(req: Request): string {
  return req.usuario!.id;
}

function normalizarHorarios(
  cuerpo: Record<string, unknown>,
): ZonaInput {
  const horarios = Array.isArray(cuerpo.horarios) ? cuerpo.horarios : [];
  return {
    ...cuerpo,
    horarios: horarios.filter((h) => {
      const fila = h as { apertura?: unknown; cierre?: unknown } | null;
      if (!fila) return false;
      return (
        String(fila.apertura ?? '').trim() !== '' ||
        String(fila.cierre ?? '').trim() !== ''
      );
    }),
  } as unknown as ZonaInput;
}

async function manejarEscritura(
  req: Request,
  res: Response,
  accion: () => Promise<unknown>,
  vista: string,
  contexto: Record<string, unknown>,
  exito: string,
): Promise<void> {
  try {
    await accion();
    req.flash('exito', exito);
    res.redirect('/admin/zonas');
  } catch (error) {
    if (error instanceof ValidationError) {
      res
        .status(400)
        .render(vista, { ...contexto, error: error.message, titulo: contexto.titulo });
      return;
    }
    if (error instanceof NotFoundError) {
      res.status(404).render('errors/404', { titulo: 'Zona no encontrada' });
      return;
    }
    if (error instanceof ConflictError) {
      res.status(409).render(vista, {
        ...contexto,
        error: error.message,
        titulo: contexto.titulo,
      });
      return;
    }
    throw error;
  }
}

zonasRoutes.get('/zonas', soloAdmin, async (_req, res) => {
  const zonas = await listarZonas();
  res.render('admin/zonas', { titulo: 'Zonas comunes', zonas });
});

zonasRoutes.get('/zonas/nueva', soloAdmin, (_req, res) => {
  res.render('admin/zona-form', {
    titulo: 'Nueva zona',
    zona: null,
    error: null,
  });
});

zonasRoutes.post('/zonas/nueva', soloAdmin, async (req, res) => {
  await manejarEscritura(
    req,
    res,
    () => crearZona(normalizarHorarios(req.body), actorId(req)),
    'admin/zona-form',
    { titulo: 'Nueva zona', zona: null },
    'Zona creada.',
  );
});

zonasRoutes.get('/zonas/:id', soloAdmin, async (req, res) => {
  const id = String(req.params.id);
  const zona = await obtenerZona(id);
  if (!zona) {
    res.status(404).render('errors/404', { titulo: 'Zona no encontrada' });
    return;
  }
  res.render('admin/zona-form', {
    titulo: `Editar zona: ${zona.nombre}`,
    zona,
    error: null,
  });
});

zonasRoutes.post('/zonas/:id', soloAdmin, async (req, res) => {
  const id = String(req.params.id);
  const zona = await obtenerZona(id);
  await manejarEscritura(
    req,
    res,
    () => actualizarZona(id, normalizarHorarios(req.body), actorId(req)),
    'admin/zona-form',
    { titulo: zona ? `Editar zona: ${zona.nombre}` : 'Editar zona', zona },
    'Zona actualizada.',
  );
});
