import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Rol } from './lib/types';
import { pool } from './db/pool';
import { ConflictError } from './lib/errors';
import { errorHandler } from './middleware/error';
import { flash } from './middleware/flash';
import { layoutRender } from './middleware/render';
import { authRoutes } from './modules/auth/routes';
import { loginRoutes } from './modules/auth/login-routes';

const raizProyecto = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp() {
  const app = express();

  app.set('views', path.join(raizProyecto, 'src', 'views'));
  app.set('view engine', 'ejs');

  app.use(express.static(path.join(raizProyecto, 'src', 'public')));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(flash);
  app.use(layoutRender);

  app.get('/health', async (_req, res, next) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'up' });
    } catch (error) {
      next(error);
    }
  });

  app.use(loginRoutes);
  app.use(authRoutes);

  if (process.env.NODE_ENV === 'test') {
    app.get('/_test/conflict', () => {
      throw new ConflictError('Conflicto de prueba');
    });

    app.get('/_test/layout', (req, res) => {
      const roles: Rol[] = ['RESIDENTE', 'ADMINISTRADOR', 'VIGILANTE'];
      const solicitado = String(req.query.rol ?? 'RESIDENTE') as Rol;
      const rol = roles.includes(solicitado) ? solicitado : 'RESIDENTE';

      res.render('_test-layout', {
        titulo: 'Prueba de layout',
        usuario: {
          id: 'test',
          nombre: 'Usuario de prueba',
          correo: 'prueba@ecc.local',
          rol,
          correoVerificado: req.query.verificado !== '0',
          apartamentoId: rol === 'RESIDENTE' ? 'apartamento-test' : null,
        },
      });
    });
  }

  app.use((_req, res) => {
    res.status(404).render('errors/404', { titulo: 'Página no encontrada' });
  });

  app.use(errorHandler);

  return app;
}
