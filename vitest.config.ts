import { defineConfig } from 'vitest/config';

const testDbName = `ecc_test_${process.pid}`;
const testDatabaseUrl = `mysql://root:root@localhost:3306/${testDbName}`;

process.env.TEST_DB_NAME = testDbName;
process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-con-mas-de-32-caracteres';

export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: process.env.SESSION_SECRET,
      DATABASE_URL: testDatabaseUrl,
      TEST_DB_NAME: testDbName,
    },
  },
});
