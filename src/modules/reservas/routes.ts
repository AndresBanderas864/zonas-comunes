import { Router } from 'express';
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

function textoConsulta(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

// Misma convencion de disponibilidad-routes: AAAA-MM-DD. Ademas se rechazan
// fechas inexistentes (2026-13-45), que MariaDB convertiria en warning o
// error 1292 dentro del WHERE.
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function validarFecha(valor: string | undefined): string | undefined {
  if (!valor) {
    return undefined;
  }
  if (!PATRON_FECHA.test(valor)) {
    throw new ValidationError('La fecha debe tener formato AAAA-MM-DD');
  }
  const [anio, mes, dia] = valor.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(anio!, (mes ?? 0) + 1, 0)).getUTCDate();
  if ((mes ?? 0) < 1 || (mes ?? 0) > 12 || (dia ?? 0) < 1 || (dia ?? 0) > ultimoDia) {
    throw new ValidationError('La fecha no existe en el calendario');
  }
  return valor;
}

adminReservasRoutes.get('/reservas', requireRole('ADMINISTRADOR'), async (req, res) => {
  const estado = textoConsulta(req.query.estado);
  if (estado && !ESTADOS_VALIDOS.includes(estado as EstadoReserva)) {
    throw new ValidationError('El estado indicado no es valido');
  }

  const filtros: FiltrosReservas = {
    desde: validarFecha(textoConsulta(req.query.desde)),
    hasta: validarFecha(textoConsulta(req.query.hasta)),
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
