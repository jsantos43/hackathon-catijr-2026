/**
 * Variáveis de ambiente dos testes. Usam um banco SEPARADO (leilao_test) e outro índice do
 * Redis (15), para os testes poderem apagar tudo sem tocar nos dados de desenvolvimento.
 *
 * Para apontar para outro lugar: TEST_DATABASE_URL e TEST_REDIS_URL.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://leilao:leilao@localhost:5432/leilao_test?schema=public';

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';

export const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  JWT_SECRET: 'segredo-dos-testes-com-mais-de-16',
  CORS_ORIGIN: 'http://localhost:5173',
  // O MinIO é substituído por um mock (tests/setup.ts); estes valores só passam na validação.
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_URL: 'http://localhost:9000',
  S3_ACCESS_KEY: 'test',
  S3_SECRET_KEY: 'test',
  S3_BUCKET: 'test-bucket',
  AUCTION_MIN_LEAD_SECONDS: '60',
  AUCTION_MIN_DURATION_SECONDS: '60',
  AUCTION_CANCEL_RUNNING_ON_BOOT: 'true',
  BID_THROTTLE_MS: '500',
  AUTH_RATE_LIMIT_MAX: '1000',
};
