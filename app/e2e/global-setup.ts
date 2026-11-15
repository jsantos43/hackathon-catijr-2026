import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Cria um lote novo Em andamento (10 min, sem lances) e guarda o id para os testes.
 * Roda o seed dentro do container da API, que enxerga o banco, o Redis e as fotos.
 * E2E_SEED_CMD troca o comando (ex.: em produção, `docker compose -f compose.prod.yml exec -T api node dist/scripts/seed.js --sala`).
 */
export default function globalSetup() {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const cmd = process.env.E2E_SEED_CMD ?? 'docker compose exec -T api npm run --silent db:seed -- --sala';
  const out = execSync(cmd, { cwd: root, encoding: 'utf8' });
  const id = out.trim().split('\n').at(-1)?.trim();
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new Error(`O seed não devolveu o id do leilão:\n${out}`);
  process.env.E2E_AUCTION_ID = id;
}
