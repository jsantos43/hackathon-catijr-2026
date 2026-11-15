import { defineConfig, devices } from '@playwright/test';

/**
 * Testes ponta a ponta (navegador de verdade contra a API e o front rodando).
 * Pré-requisito: `docker compose up -d` na raiz (API na 3333, front na 5173) e o seed aplicado.
 * O globalSetup cria um lote novo Em andamento com `npm run db:seed -- --sala`.
 *
 *   npm run test:e2e
 *   E2E_BASE_URL=https://meu-servidor npm run test:e2e   # contra outro ambiente
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
