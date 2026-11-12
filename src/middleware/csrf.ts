import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { derivarCsrf } from '../lib/crypto';
import { ForbiddenError } from '../lib/errors';
import { leerCookieSid } from '../modules/auth/sessions';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

const RUTAS_PUBLICAS = [
  '/login',
  '/logout',
  '/registro',
  '/verificar',
  '/recuperar',
  '/restablecer',
  '/health',
];

function esRutaPublica(ruta: string): boolean {
  return RUTAS_PUBLICAS.some(
    (publica) => ruta === publica || ruta.startsWith(`${publica}/`),
  );
}

function compararSeguro(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const sessionToken = leerCookieSid(req.headers.cookie);
  const secret = process.env.SESSION_SECRET ?? '';

  if (sessionToken) {
    res.locals.csrfToken = derivarCsrf(sessionToken, secret);
  }

  if (
    METODOS_SEGUROS.has(req.method) ||
    esRutaPublica(req.path) ||
    !res.locals.usuario
  ) {
    next();
    return;
  }

  const enviado = String(
    req.body?._csrf ?? req.headers['x-csrf-token'] ?? '',
  );
  const esperado = String(res.locals.csrfToken ?? '');

  if (!enviado || !esperado || !compararSeguro(enviado, esperado)) {
    next(new ForbiddenError('Token CSRF inválido'));
    return;
  }

  next();
}
