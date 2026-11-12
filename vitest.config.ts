import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-secret-con-mas-de-32-caracteres',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'mysql://ecc:ecc@localhost:3306/ecc',
    },
  },
});
