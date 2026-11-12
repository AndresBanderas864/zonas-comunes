import type { NextFunction, Request, Response } from 'express';

export type TipoFlash = 'exito' | 'error' | 'info';
export type MensajeFlash = { tipo: TipoFlash; mensaje: string };

declare global {
  namespace Express {
    interface Request {
      flash(tipo: TipoFlash, mensaje: string): void;
    }
  }
}

const COOKIE_FLASH = 'flash';

function leerCookie(req: Request): MensajeFlash[] {
  const cookies = req.headers.cookie ?? '';
  const par = cookies
    .split(';')
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith(`${COOKIE_FLASH}=`));

  if (!par) return [];

  try {
    const valor = JSON.parse(decodeURIComponent(par.slice(COOKIE_FLASH.length + 1)));
    if (!Array.isArray(valor)) return [];
    return valor.filter(
      (item): item is MensajeFlash =>
        typeof item?.tipo === 'string' && typeof item?.mensaje === 'string',
    );
  } catch {
    return [];
  }
}

export function flash(req: Request, res: Response, next: NextFunction): void {
  res.locals.flash = leerCookie(req);
  if ((req.headers.cookie ?? '').includes(`${COOKIE_FLASH}=`)) {
    res.clearCookie(COOKIE_FLASH, { path: '/' });
  }

  req.flash = (tipo: TipoFlash, mensaje: string): void => {
    const pendientes = (res.locals.flashPendientes ?? []) as MensajeFlash[];
    pendientes.push({ tipo, mensaje });
    res.locals.flashPendientes = pendientes;
    res.cookie(COOKIE_FLASH, JSON.stringify(pendientes), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60_000,
    });
  };

  next();
}
