import { ValidationError } from './errors';

// Unico patron de fecha AAAA-MM-DD de la aplicacion: lo exigen el alta de
// reserva, los filtros de administracion, vigilancia y las rutas de
// disponibilidad.
export const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Valida formato y calendario (2026-06-31, 2026-02-29 en año no bisiesto...),
// antes de que el valor toque una consulta: MariaDB responderia 1292 (500) a
// un INSERT con dia inexistente. undefined o vacio se ignoran: los filtros
// los tratan como "sin valor" y las rutas obligatorias exigen contenido antes
// de llamar. nombre personaliza el mensaje cuando una pantalla valida varias
// fechas.
export function validarFecha(
  fecha: string | undefined,
  nombre = 'La fecha',
): void {
  if (!fecha) {
    return;
  }
  if (!PATRON_FECHA.test(fecha)) {
    throw new ValidationError(`${nombre} debe tener formato AAAA-MM-DD`);
  }
  const [anio, mes, dia] = fecha.split('-').map(Number);
  // Dia 0 del mes siguiente en Date.UTC (mes es 1-based aqui, 0-based alla)
  // es el ultimo dia del mes pedido. Si el calculo desborda y sale NaN
  // (anos extremos), se omite la comprobacion: el formato ya se valido.
  const ultimoDia = new Date(Date.UTC(anio!, mes ?? 0, 0)).getUTCDate();
  if (
    (mes ?? 0) < 1 ||
    (mes ?? 0) > 12 ||
    (dia ?? 0) < 1 ||
    (!Number.isNaN(ultimoDia) && (dia ?? 0) > ultimoDia)
  ) {
    throw new ValidationError(`${nombre} no existe en el calendario`);
  }
}

// Texto de un query param: solo cadenas con contenido, recortadas; el resto
// (ausente, vacio, solo espacios, repetido) cuenta como no enviado.
export function textoConsulta(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}
