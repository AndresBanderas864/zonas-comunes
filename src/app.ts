import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Rol } from './lib/types';
import { pool } from './db/pool';
import { ConflictError } from './lib/errors';
import { errorHandler } from './middleware/error';
import { attachUsuario, redirigirInicio, requireAuth } from './middleware/auth';
import { csrfProtection } from './middleware/csrf';
import { requireRole } from './middleware/require-role';
import { flash } from './middleware/flash';
import { layoutRender } from './middleware/render';
import { authRoutes } from './modules/auth/routes';
import { loginRoutes } from './modules/auth/login-routes';
import { apartamentosRoutes } from './modules/apartamentos/routes';
import { invitacionesRoutes } from './modules/invitaciones/routes';
import { usuariosRoutes } from './modules/usuarios/routes';
import { zonasRoutes } from './modules/zonas/routes';
import { parametrosRoutes } from './modules/zonas/parametros';
import { disponibilidadRoutes } from './modules/reservas/disponibilidad-routes';

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
  app.use(attachUsuario);
  app.use(csrfProtection);

  app.get('/', redirigirInicio);

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

  app.use('/reservas', requireAuth);
  app.use('/reservar', requireAuth);
  app.use('/reservar', disponibilidadRoutes);
  app.use('/mis-reservas', requireAuth);
  app.use('/notificaciones', requireAuth);
  app.use('/mi-cuenta', requireAuth);
  app.use('/vigilancia', requireRole('VIGILANTE', 'ADMINISTRADOR'));
  app.use('/admin', requireRole('ADMINISTRADOR'));
  app.use('/admin', zonasRoutes);
  app.use('/admin', parametrosRoutes);
  app.use('/admin', apartamentosRoutes);
  app.use('/admin', invitacionesRoutes);
  app.use('/admin', usuariosRoutes);

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
