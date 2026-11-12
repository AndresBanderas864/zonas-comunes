export type Bloque = {
  horaInicio: string;
  horaFin: string;
};

function aMinutos(hora: string): number {
  const partes = hora.split(':');
  return Number(partes[0]) * 60 + Number(partes[1] ?? 0);
}

function aHora(minutos: number): string {
  const horas = String(Math.floor(minutos / 60)).padStart(2, '0');
  const mins = String(minutos % 60).padStart(2, '0');
  return `${horas}:${mins}`;
}

export function generarBloques(
  apertura: string,
  cierre: string,
  duracionMin: number,
): Bloque[] {
  if (!Number.isInteger(duracionMin) || duracionMin <= 0) return [];

  const fin = aMinutos(cierre);
  const bloques: Bloque[] = [];

  for (let inicio = aMinutos(apertura); inicio + duracionMin <= fin; inicio += duracionMin) {
    bloques.push({ horaInicio: aHora(inicio), horaFin: aHora(inicio + duracionMin) });
  }

  return bloques;
}
