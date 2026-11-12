import express from 'express';
import { pool } from './db/pool';
import { ConflictError } from './lib/errors';
import { errorHandler } from './middleware/error';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', async (_req, res, next) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'up' });
    } catch (error) {
      next(error);
    }
  });

  if (process.env.NODE_ENV === 'test') {
    app.get('/_test/conflict', () => {
      throw new ConflictError('Conflicto de prueba');
    });
  }

  app.use(errorHandler);

  return app;
}
