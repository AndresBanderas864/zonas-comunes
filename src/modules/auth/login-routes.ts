import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool';
import {
  crearSesion,
  leerCookieSid,
  revocarSesion,
} from './sessions';
import type { UsuarioLogin } from './service';
import { buscarUsuarioParaLogin } from './service';
import { verifyPassword } from '../../lib/crypto';

export const loginRoutes = Router();

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

const esquemaLogin = z.object({
  correo: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

function renderLogin(
  res: Response,
  datos: { correo: string; error: string | null; estado?: number },
): void {
  res.status(datos.estado ?? 200).render('auth/login', {
    titulo: 'Iniciar sesión',
    correo: datos.correo,
    error: datos.error,
  });
}

async function registrarFallo(usuario: UsuarioLogin): Promise<void> {
  const bloqueoVencido =
    usuario.bloqueadoHasta !== null &&
    new Date(usuario.bloqueadoHasta) <= new Date();
  const intentosPrevios = bloqueoVencido ? 0 : usuario.intentosFallidos;
  const intentos = Math.min(intentosPrevios + 1, MAX_INTENTOS);
  const bloquear = intentos >= MAX_INTENTOS;

  await query(
    'UPDATE USUARIO SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?',
    [
      intentos,
      bloquear ? new Date(Date.now() + MINUTOS_BLOQUEO * 60_000) : null,
      usuario.id,
    ],
  );
}

loginRoutes.get('/login', (req, res) => {
  renderLogin(res, { correo: '', error: null });
});

loginRoutes.post('/login', async (req, res) => {
  const entrada = esquemaLogin.safeParse(req.body);
  if (!entrada.success) {
    renderLogin(res, {
      correo: String(req.body?.correo ?? ''),
      error: 'Correo o contraseña incorrectos',
      estado: 401,
    });
    return;
  }

  const { correo, password } = entrada.data;
  const usuario = await buscarUsuarioParaLogin(correo);

  if (!usuario) {
    renderLogin(res, {
      correo,
      error: 'Correo o contraseña incorrectos',
      estado: 401,
    });
    return;
  }

  if (usuario.bloqueadoHasta && new Date(usuario.bloqueadoHasta) > new Date()) {
    const hasta = new Date(usuario.bloqueadoHasta).toLocaleString('es-CO');
    renderLogin(res, {
      correo,
      error: `La cuenta está bloqueada hasta ${hasta}`,
      estado: 429,
    });
    return;
  }

  const passwordCorrecta = await verifyPassword(usuario.passwordHash, password);
  if (!passwordCorrecta) {
    await registrarFallo(usuario);
    renderLogin(res, {
      correo,
      error: 'Correo o contraseña incorrectos',
      estado: 401,
    });
    return;
  }

  if (usuario.estado !== 'ACTIVA') {
    renderLogin(res, {
      correo,
      error: 'La cuenta está desactivada',
      estado: 403,
    });
    return;
  }

  await query(
    'UPDATE USUARIO SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?',
    [usuario.id],
  );

  const { token } = await crearSesion(usuario.id);
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.redirect('/');
});

loginRoutes.post('/logout', async (req, res) => {
  const token = leerCookieSid(req.headers.cookie);
  if (token) {
    await revocarSesion(token);
  }
  res.clearCookie('sid', { path: '/' });
  req.flash('exito', 'Sesión cerrada.');
  res.redirect('/login');
});
