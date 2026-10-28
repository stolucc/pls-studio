import { defineConfig } from 'vitest/config';

// Integration tests against a real PostgreSQL database (pls_studio_test),
// run sequentially; each test file resets the schema.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    env: { NODE_ENV: 'test' },
  },
});
