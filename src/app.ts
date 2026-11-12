import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
import { reservasRoutes, misReservasRoutes, adminReservasRoutes } from './modules/reservas/routes';
import { adminEstadisticasRoutes } from './modules/estadisticas/routes';
import { auditoriaRoutes } from './modules/auditoria/routes';
import { notificacionesRoutes } from './modules/notificaciones/routes';
import { datosPersonalesRoutes } from './modules/datos-personales/routes';
import { legalRoutes } from './modules/datos-personales/legal-routes';
import { vigilanciaRoutes } from './modules/reservas/vigilancia';

const raizProyecto = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// RNF-13: sin unsafe-inline. Las unicas fuentes de script/style del layout
// son externas (/htmx.min.js y /styles.css servidos por express.static), asi
// que 'self' basta. Se quita upgrade-insecure-requests porque el desarrollo
// local corre en http plano; en produccion el TLS termina en el host.
const helmetOpciones = {
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", 'data:'],
      'font-src': ["'self'", 'data:'],
      'upgrade-insecure-requests': null,
    },
  },
};

// RNF-08: 10 intentos de login por IP y ventana de 15 minutos; 5 peticiones
// de recuperacion por IP en la misma ventana. Los limitters se construyen
// DENTRO de createApp: cada instancia de aplicacion (cada test supertest con
// request(createApp())) tiene su propio MemoryStore, y las pruebas que no
// buscan el 429 no se contaminan entre si.
function limiterLogin() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT',
          message: 'Demasiados intentos de acceso. Espera 15 minutos.',
        },
      });
    },
  });
}

function limiterRecuperar() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT',
          message: 'Demasiadas solicitudes de recuperación. Espera 15 minutos.',
        },
      });
    },
  });
}

export function createApp() {
  const app = express();

  app.set('views', path.join(raizProyecto, 'src', 'views'));
  app.set('view engine', 'ejs');

  app.use(helmet(helmetOpciones));
  app.use(express.static(path.join(raizProyecto, 'src', 'public')));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(flash);
  app.use(layoutRender);
  app.use(attachUsuario);
  app.use(csrfProtection);

  app.post('/login', limiterLogin());
  app.post('/recuperar', limiterRecuperar());

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
  // RF-39: textos legales publicos, registrados antes de cualquier guard de
  // sesion y sin requireAuth propio.
  app.use(legalRoutes);

  app.use('/reservas', requireAuth);
  app.use('/reservas', reservasRoutes);
  app.use('/reservar', requireAuth);
  app.use('/reservar', disponibilidadRoutes);
  app.use('/mis-reservas', requireAuth);
  app.use('/mis-reservas', misReservasRoutes);
  app.use('/notificaciones', requireAuth);
  app.use('/notificaciones', notificacionesRoutes);
  app.use('/mi-cuenta', requireAuth);
  app.use('/mi-cuenta', datosPersonalesRoutes);
  app.use('/vigilancia', requireRole('VIGILANTE', 'ADMINISTRADOR'));
  app.use('/vigilancia', vigilanciaRoutes);
  app.use('/admin', requireRole('ADMINISTRADOR'));
  app.use('/admin', zonasRoutes);
  app.use('/admin', parametrosRoutes);
  app.use('/admin', apartamentosRoutes);
  app.use('/admin', invitacionesRoutes);
  app.use('/admin', usuariosRoutes);
  app.use('/admin', adminReservasRoutes);
  app.use('/admin', adminEstadisticasRoutes);
  app.use('/admin', auditoriaRoutes);

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
