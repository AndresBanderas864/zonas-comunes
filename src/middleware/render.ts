import type { NextFunction, Request, Response } from 'express';

type OpcionesVista = Record<string, unknown>;
type CallbackRender = (err: Error | null, html?: string) => void;

type RenderOriginal = (
  vista: string,
  opciones?: OpcionesVista,
  callback?: CallbackRender,
) => void;

export function layoutRender(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const renderOriginal = res.render.bind(res) as RenderOriginal;

  res.render = ((
    vista: string,
    opciones?: OpcionesVista,
    callback?: CallbackRender,
  ) => {
    const locales: OpcionesVista = {
      usuario: res.locals.usuario ?? null,
      flash: res.locals.flash ?? [],
      titulo: 'Zonas comunes',
      ...opciones,
    };

    if (vista === 'layout') {
      renderOriginal('layout', locales, callback);
      return;
    }

    renderOriginal(vista, locales, (err, html) => {
      if (err) {
        if (callback) {
          callback(err);
          return;
        }
        next(err);
        return;
      }
      renderOriginal('layout', { ...locales, body: html ?? '' }, callback);
    });
  }) as typeof res.render;

  next();
}
