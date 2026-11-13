import { Router } from 'express';
import { textoConsulta, validarFecha } from '../../lib/fechas';
import { ConflictError, ValidationError } from '../../lib/errors';
import { requireRole } from '../../middleware/require-role';
import { crearReserva, type CrearReservaInput, type EstadoReserva } from './service';
import { cancelarReserva } from './cancelacion';
import {
  dividirHistorial,
  historialDe,
  listarReservas,
  listarZonasParaFiltro,
  type FiltrosReservas,
} from './consultas';

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

// Historial del residente en la ruta del spec (/mis-reservas, enlazada por
// el nav). Va en su propio router porque reservasRoutes se monta en /reservas.
export const misReservasRoutes = Router();

misReservasRoutes.get('/', requireRole('RESIDENTE', 'ADMINISTRADOR'), async (req, res) => {
  const historial = req.usuario!.apartamentoId
    ? await historialDe(req.usuario!.apartamentoId)
    : [];
  const { proximas, pasadas } = dividirHistorial(historial);
  res.render('reservas/historial', { titulo: 'Mis reservas', proximas, pasadas });
});

export const adminReservasRoutes = Router();

const ESTADOS_VALIDOS: EstadoReserva[] = ['CONFIRMADA', 'CANCELADA', 'VENCIDA'];

adminReservasRoutes.get('/reservas', requireRole('ADMINISTRADOR'), async (req, res) => {
  const estado = textoConsulta(req.query.estado);
  if (estado && !ESTADOS_VALIDOS.includes(estado as EstadoReserva)) {
    throw new ValidationError('El estado indicado no es valido');
  }

  const desde = textoConsulta(req.query.desde);
  const hasta = textoConsulta(req.query.hasta);
  validarFecha(desde);
  validarFecha(hasta);

  const filtros: FiltrosReservas = {
    desde,
    hasta,
    zonaId: textoConsulta(req.query.zonaId),
    estado: estado as EstadoReserva | undefined,
  };

  const [reservas, zonas] = await Promise.all([
    listarReservas(filtros),
    listarZonasParaFiltro(),
  ]);

  res.render('admin/reservas', {
    titulo: 'Supervisión de reservas',
    reservas,
    zonas,
    filtros,
  });
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
        res.redirect('/mis-reservas');
        return;
      }

      res.status(204).end();
    } catch (error) {
      if (esNavegador && error instanceof ConflictError) {
        req.flash('error', error.message);
        res.redirect('/mis-reservas');
        return;
      }
      throw error;
    }
  },
);
