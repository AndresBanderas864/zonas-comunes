import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (
      req.accepts(['json', 'html']) === 'html' &&
      (err.status === 403 || err.status === 404)
    ) {
      const vista = err.status === 403 ? 'errors/403' : 'errors/404';
      res.status(err.status).render(vista, { titulo: err.message });
      return;
    }

    res.status(err.status).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error(err);
  }

  if (req.accepts(['json', 'html']) === 'html') {
    res.status(500).render('errors/500', { titulo: 'Error inesperado' });
    return;
  }

  res.status(500).json({
    error: { code: 'ERROR_INTERNO', message: 'Ocurrio un error inesperado' },
  });
}
