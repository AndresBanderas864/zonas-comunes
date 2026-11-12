import { z } from 'zod';

const esquema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  TEST_DATABASE_URL: z.string().min(1).optional(),
});

export type Env = z.infer<typeof esquema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const resultado = esquema.safeParse(raw);
  if (!resultado.success) {
    const faltantes = resultado.error.issues
      .map((issue) => issue.path.join('.'))
      .join(', ');
    throw new Error(`Configuracion invalida: ${faltantes}`);
  }
  return resultado.data;
}

export const env = parseEnv(process.env);
