import { Router } from 'express';
import { NotFoundError } from '../../lib/errors';
import type { TextoLegal } from './service';
import { textoVigente } from './service';

export const legalRoutes = Router();

type PaginaLegal = {
  ruta: string;
  tipo: TextoLegal['tipo'];
  titulo: string;
  tituloSinTexto: string;
  mensajeSinTexto: string;
};

// RF-39: los textos vigentes deben ser consultables sin sesion, desde el
// registro y desde el menu. Las rutas se montan a nivel de app, fuera de
// cualquier requireAuth; csrf no aplica a GET.
const PAGINAS: PaginaLegal[] = [
  {
    ruta: '/politica',
    tipo: 'POLITICA',
    titulo: 'Política de datos personales',
    tituloSinTexto: 'Política no disponible',
    mensajeSinTexto: 'Aún no hay una política de datos publicada.',
  },
  {
    ruta: '/aviso-privacidad',
    tipo: 'AVISO_PRIVACIDAD',
    titulo: 'Aviso de privacidad',
    tituloSinTexto: 'Aviso no disponible',
    mensajeSinTexto: 'Aún no hay un aviso de privacidad publicado.',
  },
];

for (const pagina of PAGINAS) {
  legalRoutes.get(pagina.ruta, async (_req, res) => {
    let texto: TextoLegal;
    try {
      texto = await textoVigente(pagina.tipo);
    } catch (error) {
      if (error instanceof NotFoundError) {
        res
          .status(404)
          .render('auth/aviso', {
            titulo: pagina.tituloSinTexto,
            mensaje: pagina.mensajeSinTexto,
          });
        return;
      }
      throw error;
    }

    res.render('legal/texto', {
      titulo: pagina.titulo,
      contenido: texto.contenido,
    });
  });
}
