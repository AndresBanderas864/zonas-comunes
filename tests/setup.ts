import { beforeEach } from 'vitest';
import { resetearBase } from './helpers/db';

beforeEach(async () => {
  await resetearBase();
});
