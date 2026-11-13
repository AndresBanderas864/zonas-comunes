import { Router } from 'express';
import { NotFoundError } from '../../lib/errors';
import { validarFecha } from '../../lib/fechas';
import {
  listarBloquesDisponibles,
  listarZonasActivas,
  obtenerZonaActiva,
} from './disponibilidad';

export const disponibilidadRoutes = Router();

disponibilidadRoutes.get('/', async (req, res) => {
  const zonas = await listarZonasActivas();

  const zona = typeof req.query.zona === 'string' ? req.query.zona : '';
  const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
  if (zona && fecha) {
    validarFecha(fecha);
    res.redirect(`/reservar/${encodeURIComponent(zona)}/${fecha}`);
    return;
  }

  res.render('reservas/elegir-zona', {
    titulo: 'Reservar zona comun',
    zonas,
  });
});

disponibilidadRoutes.get('/:zonaId/:fecha', async (req, res) => {
  const { zonaId, fecha } = req.params;

  // Formato AAAA-MM-DD y calendario real antes de pintar: un dia inexistente
  // (2026-11-31) rodaba a otro dia de la semana y mostraba una disponibilidad
  // fantasma en lugar de un 400.
  validarFecha(fecha);

  const zona = await obtenerZonaActiva(zonaId);
  if (!zona) {
    throw new NotFoundError('La zona no existe o no esta activa');
  }

  const bloques = await listarBloquesDisponibles(zona.id, fecha);

  res.render('reservas/disponibilidad', {
    titulo: `Disponibilidad de ${zona.nombre}`,
    zona,
    fecha,
    bloques,
  });
});
