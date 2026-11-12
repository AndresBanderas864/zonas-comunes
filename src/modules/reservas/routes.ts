import { Router } from 'express';
import { ConflictError, ValidationError } from '../../lib/errors';
import { requireRole } from '../../middleware/require-role';
import { crearReserva, type CrearReservaInput } from './service';

export const reservasRoutes = Router();

reservasRoutes.use(requireRole('RESIDENTE'));

const CAMPOS_OBLIGATORIOS = ['zonaId', 'fecha', 'horaInicio', 'cupos'] as const;

function valoresRecibidos(cuerpo: Record<string, unknown>): Record<string, string> {
  return {
    zonaId: String(cuerpo.zonaId ?? ''),
    fecha: String(cuerpo.fecha ?? ''),
    horaInicio: String(cuerpo.horaInicio ?? ''),
    cupos: String(cuerpo.cupos ?? ''),
  };
}

reservasRoutes.post('/', async (req, res) => {
  const cuerpo = (req.body ?? {}) as Record<string, unknown>;
  const valores = valoresRecibidos(cuerpo);
  const confirmar = String(cuerpo.confirmar ?? '') === '1';

  if (!confirmar) {
    if (CAMPOS_OBLIGATORIOS.some((campo) => valores[campo] === '')) {
      throw new ValidationError('Faltan datos de la reserva');
    }
    res.render('reservas/confirmar', {
      titulo: 'Confirmar reserva',
      valores,
      error: null,
    });
    return;
  }

  const esNavegador = req.accepts(['json', 'html']) === 'html';

  try {
    const reserva = await crearReserva(req.usuario!, valores as unknown as CrearReservaInput);

    if (esNavegador) {
      req.flash('exito', 'Reserva confirmada.');
      res.redirect('/reservar');
      return;
    }

    res.status(201).json({ reserva });
  } catch (error) {
    if (esNavegador && error instanceof ValidationError) {
      res.status(400).render('reservas/confirmar', {
        titulo: 'Confirmar reserva',
        valores,
        error: error.message,
      });
      return;
    }
    if (esNavegador && error instanceof ConflictError) {
      req.flash('error', error.message);
      res.redirect('/reservar');
      return;
    }
    throw error;
  }
});
