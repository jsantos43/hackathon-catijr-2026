#!/usr/bin/env bash
# Deploy de produção: atualiza o repositório, cria o .env (na primeira vez) e sobe a stack
# de compose.prod.yml (API Node + front React no nginx, porta 8080).
#
# Roda no servidor. O GitHub Actions chama este arquivo por SSH a cada push na main, passando
# API_IMAGE e APP_IMAGE (imagens já publicadas no GHCR): a VM (1 vCPU / 1 GB) só faz pull.
# O swap da VM é configurado fora daqui.
#
# Variáveis:
#   API_IMAGE, APP_IMAGE  imagens prontas (obrigatórias; o workflow passa as duas)
#   PUBLIC_URL            URL pública do front     (padrão: http://localhost:8080)
#   APP_PORT              porta publicada do nginx (padrão: 8080)
#   DEPLOY_BRANCH         branch a acompanhar      (padrão: main)

set -euo pipefail

BRANCH="${DEPLOY_BRANCH:-main}"
PUBLIC_URL="${PUBLIC_URL:-http://localhost:8080}"
APP_PORT="${APP_PORT:-8080}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

cd "$(dirname "${BASH_SOURCE[0]}")"

command -v docker >/dev/null 2>&1 || die "Docker não encontrado."
docker compose version >/dev/null 2>&1 || die "Plugin 'docker compose' não encontrado."
[ -n "${API_IMAGE:-}" ] && [ -n "${APP_IMAGE:-}" ] \
  || die "Defina API_IMAGE e APP_IMAGE (imagens do GHCR publicadas pelo GitHub Actions)."
export API_IMAGE APP_IMAGE

# --- Código -----------------------------------------------------------------
log "Atualizando código para origin/$BRANCH"
git fetch --prune origin
git checkout -f -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

# --- .env (só na primeira vez) ----------------------------------------------
if [ ! -f .env ]; then
  log "Gerando .env de produção"
  {
    printf 'POSTGRES_USER=leilao\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 16)"
    printf 'POSTGRES_DB=leilao\n'
    printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)"
    printf 'PUBLIC_URL=%s\n' "$PUBLIC_URL"
    printf 'APP_PORT=%s\n' "$APP_PORT"
  } > .env
  chmod 600 .env
fi

# --- Subida -----------------------------------------------------------------
DC=(docker compose -f compose.prod.yml --env-file .env)

log "Baixando imagens ($API_IMAGE, $APP_IMAGE)"
"${DC[@]}" pull

log "Subindo a stack (as migrations do Prisma rodam no start da API)"
"${DC[@]}" up -d --remove-orphans --no-build

docker image prune -f >/dev/null 2>&1 || true

"${DC[@]}" ps
log "Deploy concluído. Front em ${PUBLIC_URL} (nginx na porta ${APP_PORT})."
