export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Datos invalidos') {
    super(400, 'VALIDACION', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Debes iniciar sesion') {
    super(401, 'NO_AUTENTICADO', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tienes permiso para esta accion') {
    super(403, 'SIN_PERMISO', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') {
    super(404, 'NO_ENCONTRADO', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'La operacion entra en conflicto con el estado actual') {
    super(409, 'CONFLICTO', message);
  }
}
