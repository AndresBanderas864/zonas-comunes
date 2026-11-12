import { Router } from 'express';
import { ConflictError, ValidationError } from '../../lib/errors';
import { requireRole } from '../../middleware/require-role';
import { crearReserva, type CrearReservaInput } from './service';
import { cancelarReserva } from './cancelacion';
import { listarReservasNoCanceladas } from './repository';

export const reservasRoutes = Router();

// Los roles se exigen por ruta: reservar es solo de RESIDENTE, pero cancelar
// (la propia, o la ajena como ADMINISTRADOR) y mis-reservas admiten ambos.

const CAMPOS_OBLIGATORIOS = ['zonaId', 'fecha', 'horaInicio', 'cupos'] as const;

function valoresRecibidos(cuerpo: Record<string, unknown>): Record<string, string> {
  return {
    zonaId: String(cuerpo.zonaId ?? ''),
    fecha: String(cuerpo.fecha ?? ''),
    horaInicio: String(cuerpo.horaInicio ?? ''),
    cupos: String(cuerpo.cupos ?? ''),
  };
}

reservasRoutes.post('/', requireRole('RESIDENTE'), async (req, res) => {
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

// El spec situa el historial en GET /mis-reservas; el router se monta en
// /reservas, asi que la ruta completa es /reservas/mis-reservas (enlace de
// destino del PRG de cancelacion).
reservasRoutes.get('/mis-reservas', requireRole('RESIDENTE', 'ADMINISTRADOR'), async (req, res) => {
  const reservas = req.usuario!.apartamentoId
    ? await listarReservasNoCanceladas(req.usuario!.apartamentoId)
    : [];
  res.render('reservas/mis-reservas', { titulo: 'Mis reservas', reservas });
});

reservasRoutes.post(
  '/:id/cancelar',
  requireRole('RESIDENTE', 'ADMINISTRADOR'),
  async (req, res) => {
    const cuerpo = (req.body ?? {}) as Record<string, unknown>;
    const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo : undefined;
    const esNavegador = req.accepts(['json', 'html']) === 'html';

    try {
      await cancelarReserva(req.usuario!, String(req.params.id), motivo);

      if (esNavegador) {
        req.flash('exito', 'Reserva cancelada.');
        res.redirect('/reservas/mis-reservas');
        return;
      }

      res.status(204).end();
    } catch (error) {
      if (esNavegador && error instanceof ConflictError) {
        req.flash('error', error.message);
        res.redirect('/reservas/mis-reservas');
        return;
      }
      throw error;
    }
  },
);
