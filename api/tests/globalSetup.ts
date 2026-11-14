import { execSync } from 'node:child_process';
import pg from 'pg';
import { TEST_DATABASE_URL, testEnv } from './testEnv.js';

/**
 * Roda uma vez antes de todos os testes: cria o banco leilao_test (se não existir) e aplica
 * as migrations nele. Precisa do PostgreSQL e do Redis do compose no ar (docker compose up -d).
 */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);

  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, ...testEnv, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}
