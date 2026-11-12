import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../lib/errors';
import type { Rol } from '../lib/types';

export function requireRole(...roles: Rol[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const usuario = res.locals.usuario as { rol?: Rol } | null;

    if (!usuario) {
      if (req.method === 'GET') {
        res.redirect('/login');
        return;
      }
      res.status(401).set('Location', '/login').json({
        error: { code: 'NO_AUTENTICADO', message: 'Debes iniciar sesión' },
      });
      return;
    }

    if (!usuario.rol || !roles.includes(usuario.rol)) {
      next(new ForbiddenError());
      return;
    }

    next();
  };
}
