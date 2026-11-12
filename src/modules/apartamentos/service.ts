import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withTransaction } from '../../db/pool';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { registrarAuditoria } from '../auditoria/service';
import {
  actualizarApartamentoFila,
  contarDependientes,
  eliminarApartamentoFila,
  insertarApartamento,
  listarApartamentosFilas,
  obtenerApartamentoFila,
  type ApartamentoFila,
} from './repository';

export type Apartamento = {
  id: string;
  torreInterior: string;
  numero: string;
  creadoEn: string;
};

export type ApartamentoInput = {
  torreInterior: string;
  numero: string;
};

const esquemaApartamento = z.object({
  torreInterior: z
    .string()
    .trim()
    .min(1, 'La torre es obligatoria')
    .max(20, 'La torre no puede superar 20 caracteres'),
  numero: z
    .string()
    .trim()
    .min(1, 'El numero es obligatorio')
    .max(20, 'El numero no puede superar 20 caracteres'),
});

function esDuplicado(error: unknown): boolean {
  return (error as { code?: string }).code === 'ER_DUP_ENTRY';
}

function validarEntrada(entrada: unknown): ApartamentoInput {
  const resultado = esquemaApartamento.safeParse(entrada);
  if (!resultado.success) {
    throw new ValidationError(resultado.error.issues[0].message);
  }
  return resultado.data;
}

function aApartamento(fila: ApartamentoFila): Apartamento {
  return {
    id: fila.id,
    torreInterior: fila.torre_interior,
    numero: fila.numero,
    creadoEn: new Date(fila.creado_en).toISOString(),
  };
}

export async function listarApartamentos(): Promise<Apartamento[]> {
  const filas = await listarApartamentosFilas();
  return filas.map(aApartamento);
}

export async function obtenerApartamento(id: string): Promise<Apartamento | null> {
  const filas = await listarApartamentosFilas();
  const fila = filas.find((f) => f.id === id);
  return fila ? aApartamento(fila) : null;
}

export async function crearApartamento(
  input: unknown,
  actorId: string,
): Promise<Apartamento> {
  const datos = validarEntrada(input);
  const id = randomUUID();

  await withTransaction(async (conn) => {
    try {
      await insertarApartamento(conn, {
        id,
        torreInterior: datos.torreInterior,
        numero: datos.numero,
      });
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictError(
          'Ya existe un apartamento con esa torre y numero',
        );
      }
      throw error;
    }

    await registrarAuditoria(conn, {
      usuarioId: actorId,
      accion: 'apartamento.crear',
      entidad: 'APARTAMENTO',
      entidadId: id,
      detalle: { torreInterior: datos.torreInterior, numero: datos.numero },
    });
  });

  return { ...datos, id, creadoEn: new Date().toISOString() };
}

export async function actualizarApartamento(
  id: string,
  input: unknown,
  actorId: string,
): Promise<Apartamento> {
  const datos = validarEntrada(input);

  await withTransaction(async (conn) => {
    const existente = await obtenerApartamentoFila(conn, id);
    if (!existente) {
      throw new NotFoundError('El apartamento no existe');
    }

    try {
      await actualizarApartamentoFila(conn, {
        id,
        torreInterior: datos.torreInterior,
        numero: datos.numero,
      });
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictError(
          'Ya existe un apartamento con esa torre y numero',
        );
      }
      throw error;
    }

    await registrarAuditoria(conn, {
      usuarioId: actorId,
      accion: 'apartamento.actualizar',
      entidad: 'APARTAMENTO',
      entidadId: id,
      detalle: { torreInterior: datos.torreInterior, numero: datos.numero },
    });
  });

  return { ...datos, id, creadoEn: new Date().toISOString() };
}

export async function eliminarApartamento(
  id: string,
  actorId: string,
): Promise<void> {
  await withTransaction(async (conn) => {
    const existente = await obtenerApartamentoFila(conn, id);
    if (!existente) {
      throw new NotFoundError('El apartamento no existe');
    }

    const dependientes = await contarDependientes(conn, id);
    if (dependientes > 0) {
      throw new ConflictError(
        'El apartamento tiene usuarios, reservas o invitaciones asociadas',
      );
    }

    await eliminarApartamentoFila(conn, id);

    await registrarAuditoria(conn, {
      usuarioId: actorId,
      accion: 'apartamento.eliminar',
      entidad: 'APARTAMENTO',
      entidadId: id,
      detalle: {
        torreInterior: existente.torre_interior,
        numero: existente.numero,
      },
    });
  });
}
