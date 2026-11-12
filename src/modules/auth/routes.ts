import { Router } from 'express';
import { ValidationError } from '../../lib/errors';
import {
  obtenerInvitacionVigente,
  registrarConInvitacion,
  verificarCorreo,
} from './service';

export const authRoutes = Router();

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
