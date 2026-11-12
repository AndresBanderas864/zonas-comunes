import { crearBaseDePrueba, destruirBaseDePrueba } from './helpers/db';

export default async function setup() {
  const nombre = process.env.TEST_DB_NAME;
  if (!nombre) throw new Error('TEST_DB_NAME no esta definido');
  await crearBaseDePrueba(nombre);

  return async () => {
    await destruirBaseDePrueba(nombre);
  };
}
