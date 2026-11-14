import { defineConfig } from 'vitest/config';
import { testEnv } from './tests/testEnv.js';

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Os testes de integração dividem o mesmo banco e o mesmo Redis: um arquivo por vez.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
