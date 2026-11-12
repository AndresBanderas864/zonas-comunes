import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../lib/errors';
import {
  leerCookieSid,
  validarSesion,
  type UsuarioSesion,
} from '../modules/auth/sessions';

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioSesion | null;
    }
  }
}

export async function attachUsuario(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = leerCookieSid(req.headers.cookie);
    const usuario = token ? await validarSesion(token) : null;
    req.usuario = usuario;
    res.locals.usuario = usuario;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.locals.usuario) {
    next();
    return;
  }

  if (req.method === 'GET') {
    res.redirect('/login');
    return;
  }

  const error = new UnauthorizedError();
  res.status(error.status).set('Location', '/login').json({
    error: { code: error.code, message: error.message },
  });
}

export function redirigirInicio(req: Request, res: Response): void {
  const usuario = res.locals.usuario as UsuarioSesion | null;
  if (!usuario) {
    res.redirect('/login');
    return;
  }

  if (usuario.rol === 'ADMINISTRADOR') {
    res.redirect('/admin/zonas');
    return;
  }
  if (usuario.rol === 'VIGILANTE') {
    res.redirect('/vigilancia');
    return;
  }
  res.redirect('/reservar');
}
