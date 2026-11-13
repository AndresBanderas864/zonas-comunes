import { Router } from 'express';
import { textoConsulta, validarFecha } from '../../lib/fechas';
import { requireRole } from '../../middleware/require-role';
import { listarAuditoria, type FiltrosAuditoria } from './service';

export const auditoriaRoutes = Router();

const soloAdmin = requireRole('ADMINISTRADOR');

// RF-41: bitacora de solo lectura, visible solo para ADMINISTRADOR. El guard
// del montaje de /admin en app.ts ya exige el rol; se repite aqui por defensa
// en profundidad, igual que en los otros modulos de administracion.
auditoriaRoutes.get('/bitacora', soloAdmin, async (req, res) => {
  const desde = textoConsulta(req.query.desde);
  const hasta = textoConsulta(req.query.hasta);
  validarFecha(desde);
  validarFecha(hasta);
  const filtros: FiltrosAuditoria = { desde, hasta };

  const entradas = await listarAuditoria(filtros);

  res.render('admin/bitacora', {
    titulo: 'Bitacora de auditoria',
    entradas,
    filtros,
  });
});
