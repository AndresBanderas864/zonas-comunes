import { Router } from 'express';
import { NotFoundError, ValidationError } from '../../lib/errors';
import {
  listarBloquesDisponibles,
  listarZonasActivas,
  obtenerZonaActiva,
} from './disponibilidad';

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const disponibilidadRoutes = Router();

disponibilidadRoutes.get('/', async (req, res) => {
  const zonas = await listarZonasActivas();

  const zona = typeof req.query.zona === 'string' ? req.query.zona : '';
  const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
  if (zona && fecha) {
    if (!PATRON_FECHA.test(fecha)) {
      throw new ValidationError('La fecha debe tener formato AAAA-MM-DD');
    }
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

  if (!PATRON_FECHA.test(fecha)) {
    throw new ValidationError('La fecha debe tener formato AAAA-MM-DD');
  }

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
