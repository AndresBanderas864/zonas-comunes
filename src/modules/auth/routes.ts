import { Router } from 'express';
import { ValidationError } from '../../lib/errors';
import {
  EnlaceInvalidoError,
  restablecerPassword,
  solicitarRecuperacion,
  validarTokenRecuperacion,
} from './recovery';
import {
  obtenerInvitacionVigente,
  registrarConInvitacion,
  verificarCorreo,
} from './service';

export const authRoutes = Router();

const MENSAJE_RECUPERACION =
  'Si el correo está registrado, te enviaremos un enlace para restablecer la contraseña.';

authRoutes.get('/recuperar', (_req, res) => {
  res.render('auth/recuperar', { titulo: 'Recuperar contraseña', error: null });
});

authRoutes.post('/recuperar', async (req, res) => {
  await solicitarRecuperacion(String(req.body?.correo ?? ''));
  res.render('auth/aviso', {
    titulo: 'Revisa tu correo',
    mensaje: MENSAJE_RECUPERACION,
  });
});

authRoutes.get('/restablecer/:token', async (req, res) => {
  try {
    await validarTokenRecuperacion(req.params.token);
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).render('auth/aviso', {
        titulo: 'Enlace no válido',
        mensaje: error.message,
      });
      return;
    }
    throw error;
  }

  res.render('auth/restablecer', {
    titulo: 'Nueva contraseña',
    token: req.params.token,
    error: null,
  });
});

authRoutes.post('/restablecer/:token', async (req, res) => {
  try {
    await restablecerPassword(req.params.token, String(req.body?.password ?? ''));
    req.flash('exito', 'Contraseña actualizada. Ya puedes iniciar sesión.');
    res.redirect('/login');
  } catch (error) {
    if (error instanceof EnlaceInvalidoError) {
      res.status(400).render('auth/aviso', {
        titulo: 'Enlace no válido',
        mensaje: error.message,
      });
      return;
    }
    if (error instanceof ValidationError) {
      res.status(400).render('auth/restablecer', {
        titulo: 'Nueva contraseña',
        token: req.params.token,
        error: error.message,
      });
      return;
    }
    throw error;
  }
});

authRoutes.get('/registro/:token', async (req, res) => {
  try {
    await obtenerInvitacionVigente(req.params.token);
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).render('auth/aviso', {
        titulo: 'Invitación no válida',
        mensaje: error.message,
      });
      return;
    }
    throw error;
  }

  res.render('auth/registro', {
    titulo: 'Crear cuenta',
    token: req.params.token,
    valores: { nombre: '', correo: '' },
    error: null,
  });
});

authRoutes.post('/registro/:token', async (req, res) => {
  const valores = {
    nombre: String(req.body?.nombre ?? ''),
    correo: String(req.body?.correo ?? ''),
  };

  try {
    await registrarConInvitacion(req.params.token, req.body);
    req.flash('exito', 'Cuenta creada. Revisa tu correo y luego inicia sesión.');
    res.redirect('/login');
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).render('auth/registro', {
        titulo: 'Crear cuenta',
        token: req.params.token,
        valores,
        error: error.message,
      });
      return;
    }
    throw error;
  }
});

authRoutes.get('/verificar/:token', async (req, res) => {
  try {
    await verificarCorreo(req.params.token);
    req.flash('exito', 'Correo verificado. Ya puedes iniciar sesión.');
    res.redirect('/login');
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).render('auth/aviso', {
        titulo: 'Enlace no válido',
        mensaje: error.message,
      });
      return;
    }
    throw error;
  }
});
