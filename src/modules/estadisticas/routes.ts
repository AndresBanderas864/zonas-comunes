import { Router } from 'express';
import { requireRole } from '../../middleware/require-role';
import { listarZonasParaFiltro } from '../reservas/consultas';
import { validarFecha } from '../reservas/routes';
import {
  cancelacionesPorZona,
  horasPico,
  ocupacionPorBloque,
} from './queries';

export const adminEstadisticasRoutes = Router();

function textoConsulta(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function restarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const epoch = Date.UTC(anio!, mes! - 1, dia!);
  return new Date(epoch - dias * 86_400_000).toISOString().slice(0, 10);
}

// El porcentaje contra el aforo se calcula aqui, no en la vista: las
// vistas no calculan aforo. La etiqueta "contra aforo actual" advierte
// de que el aforo es el vigente, no un snapshot de la fecha pasada.
adminEstadisticasRoutes.get('/estadisticas', requireRole('ADMINISTRADOR'), async (req, res) => {
  const hoy = hoyBogota();
  const filtros = {
    desde: validarFecha(textoConsulta(req.query.desde)) ?? restarDias(hoy, 29),
    hasta: validarFecha(textoConsulta(req.query.hasta)) ?? hoy,
    zonaId: textoConsulta(req.query.zonaId),
  };

  const [ocupacion, picos, cancelaciones, zonas] = await Promise.all([
    ocupacionPorBloque(filtros.desde, filtros.hasta, filtros.zonaId),
    horasPico(filtros.desde, filtros.hasta, filtros.zonaId),
    cancelacionesPorZona(filtros.desde, filtros.hasta, filtros.zonaId),
    listarZonasParaFiltro(),
  ]);

  const ocupacionConPct = ocupacion.map((fila) => ({
    ...fila,
    porcentajeAforo:
      fila.aforo > 0 ? Math.round((fila.cupos * 1000) / fila.aforo) / 10 : 0,
  }));

  res.render('admin/estadisticas', {
    titulo: 'Estadísticas',
    filtros,
    zonas,
    ocupacion: ocupacionConPct,
    picos,
    cancelaciones,
  });
});
