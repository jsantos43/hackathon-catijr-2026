#!/usr/bin/env bash
# Deploy de produção: atualiza o repositório, prepara o .env e sobe a stack
# definida em compose.prod.yml (API Node + front React no nginx, porta 8080).
#
# Roda no servidor. O GitHub Actions chama este arquivo por SSH a cada push.
# O acesso ao repositório (git fetch/pull) usa a chave SSH já configurada no
# servidor para o remote origin.
#
# Variáveis opcionais:
#   DEPLOY_BRANCH   branch a acompanhar            (padrão: main)
#   PUBLIC_URL      URL pública do front           (padrão: http://localhost:8080)
#   S3_PUBLIC_URL   URL pública do MinIO/fotos     (padrão: http://<host do PUBLIC_URL>:9000)
#   APP_PORT        porta publicada do nginx       (padrão: 8080)
#   REPO_DIR        pasta do repositório           (padrão: pasta deste script)

set -euo pipefail

BRANCH="${DEPLOY_BRANCH:-main}"
PUBLIC_URL="${PUBLIC_URL:-http://localhost:8080}"
APP_PORT="${APP_PORT:-8080}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

cd "$REPO_DIR"

# --- Docker -----------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  die "Docker não encontrado. Instale o Docker Engine e o plugin Compose antes do deploy."
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  die "Docker Compose não encontrado (plugin 'docker compose' ou binário 'docker-compose')."
fi

# --- Código -----------------------------------------------------------------
if [ -d .git ]; then
  git config --global --add safe.directory "$REPO_DIR" >/dev/null 2>&1 || true
  log "Atualizando código para origin/$BRANCH"
  git fetch --prune origin
  git checkout -f -B "$BRANCH" "origin/$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  log "Pasta sem .git; usando os arquivos já presentes em $REPO_DIR"
fi

# --- .env de produção -------------------------------------------------------
PUBLIC_HOST="${PUBLIC_URL#*://}"
PUBLIC_HOST="${PUBLIC_HOST%%[:/]*}"
DEFAULT_S3_PUBLIC_URL="http://$PUBLIC_HOST:9000"

if [ ! -f .env ]; then
  log "Gerando .env de produção"

  {
    printf 'POSTGRES_USER=leilao\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$(random_hex 16)"
    printf 'POSTGRES_DB=leilao\n'
    printf 'MINIO_ROOT_USER=leilao\n'
    printf 'MINIO_ROOT_PASSWORD=%s\n' "$(random_hex 16)"
    printf 'JWT_SECRET=%s\n' "$(random_hex 32)"
    printf 'PUBLIC_URL=%s\n' "$PUBLIC_URL"
    printf 'S3_PUBLIC_URL=%s\n' "${S3_PUBLIC_URL:-$DEFAULT_S3_PUBLIC_URL}"
    printf 'APP_PORT=%s\n' "$APP_PORT"
  } > .env
  chmod 600 .env
  log ".env criado (guarde os segredos; ele não vai para o git)"
fi

# Completa chaves que faltarem em um .env antigo (ex.: veio do .env.example).
ensure_env() {
  local key="$1" value="$2"
  grep -q "^${key}=" .env || printf '%s=%s\n' "$key" "$value" >> .env
}
ensure_env POSTGRES_USER leilao
ensure_env POSTGRES_DB leilao
ensure_env MINIO_ROOT_USER leilao
ensure_env JWT_SECRET "$(random_hex 32)"
ensure_env PUBLIC_URL "$PUBLIC_URL"
ensure_env S3_PUBLIC_URL "${S3_PUBLIC_URL:-$DEFAULT_S3_PUBLIC_URL}"
ensure_env APP_PORT "$APP_PORT"

# --- Build e subida ---------------------------------------------------------
log "Construindo imagens de produção"
"${COMPOSE[@]}" -f compose.prod.yml --env-file .env build --pull

log "Subindo a stack (migrations do Prisma são aplicadas no start da API)"
"${COMPOSE[@]}" -f compose.prod.yml --env-file .env up -d --remove-orphans

log "Removendo imagens antigas sem uso"
docker image prune -f >/dev/null 2>&1 || true

log "Status dos serviços"
"${COMPOSE[@]}" -f compose.prod.yml --env-file .env ps

log "Deploy concluído. Front em ${PUBLIC_URL} (nginx na porta ${APP_PORT})."
