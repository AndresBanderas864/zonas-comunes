import { Router } from 'express';
import { requireRole } from '../../middleware/require-role';
import { validarFecha } from '../reservas/routes';
import { listarAuditoria, type FiltrosAuditoria } from './service';

export const auditoriaRoutes = Router();

const soloAdmin = requireRole('ADMINISTRADOR');

function textoConsulta(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

// RF-41: bitacora de solo lectura, visible solo para ADMINISTRADOR. El guard
// del montaje de /admin en app.ts ya exige el rol; se repite aqui por defensa
// en profundidad, igual que en los otros modulos de administracion.
auditoriaRoutes.get('/bitacora', soloAdmin, async (req, res) => {
  const filtros: FiltrosAuditoria = {
    desde: validarFecha(textoConsulta(req.query.desde)),
    hasta: validarFecha(textoConsulta(req.query.hasta)),
  };

  const entradas = await listarAuditoria(filtros);

  res.render('admin/bitacora', {
    titulo: 'Bitacora de auditoria',
    entradas,
    filtros,
  });
});
