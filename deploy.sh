#!/usr/bin/env bash
# Deploy de produção: atualiza o repositório, prepara o .env e sobe a stack
# definida em compose.prod.yml (API Node + front React no nginx, porta 8080).
#
# Roda no servidor. O GitHub Actions chama este arquivo por SSH a cada push.
# O acesso ao repositório (git fetch/pull) usa a chave SSH já configurada no
# servidor para o remote origin.
#
# Pensado para uma VM de 1 vCPU / 1 GB: com API_IMAGE e APP_IMAGE (publicadas pelo
# GitHub Actions no GHCR) a VM só baixa as imagens; construir aqui consome mais memória
# do que a VM tem. Também cria 1 GB de swap, se ainda não houver, como rede de segurança.
#
# Variáveis opcionais:
#   DEPLOY_BRANCH   branch a acompanhar            (padrão: main)
#   PUBLIC_URL      URL pública do front           (padrão: http://localhost:8080)
#   APP_PORT        porta publicada do nginx       (padrão: 8080)
#   REPO_DIR        pasta do repositório           (padrão: pasta deste script)
#   API_IMAGE       imagem pronta da API           (sem ela, constrói na VM)
#   APP_IMAGE       imagem pronta do front         (sem ela, constrói na VM)
#   SWAP_SIZE       tamanho do swapfile a criar    (padrão: 1G; "0" desliga)

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

# --- Swap (VM com 1 GB de RAM) ----------------------------------------------
SWAP_SIZE="${SWAP_SIZE:-1G}"
if [ "$SWAP_SIZE" != "0" ] && [ -z "$(swapon --noheadings 2>/dev/null)" ]; then
  SUDO=""
  [ "$(id -u)" -ne 0 ] && SUDO="sudo -n"
  if $SUDO true 2>/dev/null; then
    log "Criando swap de $SWAP_SIZE em /swapfile"
    if [ ! -f /swapfile ]; then
      $SUDO fallocate -l "$SWAP_SIZE" /swapfile || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=1024
      $SUDO chmod 600 /swapfile
      $SUDO mkswap /swapfile >/dev/null
    fi
    $SUDO swapon /swapfile || true
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
    # Só usa swap quando a RAM realmente acabar.
    $SUDO sysctl -q vm.swappiness=10 || true
  else
    log "Sem swap e sem sudo sem senha: crie o swap manualmente (veja o README)."
  fi
fi

# --- .env de produção -------------------------------------------------------

if [ ! -f .env ]; then
  log "Gerando .env de produção"

  {
    printf 'POSTGRES_USER=leilao\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$(random_hex 16)"
    printf 'POSTGRES_DB=leilao\n'
    printf 'JWT_SECRET=%s\n' "$(random_hex 32)"
    printf 'PUBLIC_URL=%s\n' "$PUBLIC_URL"
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
ensure_env JWT_SECRET "$(random_hex 32)"
ensure_env PUBLIC_URL "$PUBLIC_URL"
ensure_env APP_PORT "$APP_PORT"

# --- Imagens ---------------------------------------------------------------
DC=("${COMPOSE[@]}" -f compose.prod.yml --env-file .env)

if [ -n "${API_IMAGE:-}" ] && [ -n "${APP_IMAGE:-}" ]; then
  export API_IMAGE APP_IMAGE
  log "Baixando imagens prontas ($API_IMAGE, $APP_IMAGE)"
  "${DC[@]}" pull api app
else
  # Uma imagem por vez: buildar as duas juntas numa VM de 1 GB estoura a memória.
  log "Construindo imagens na VM (sem API_IMAGE/APP_IMAGE; pode demorar)"
  "${DC[@]}" build api
  "${DC[@]}" build app
fi
"${DC[@]}" pull --ignore-buildable postgres redis 2>/dev/null || "${DC[@]}" pull postgres redis

# --- Subida -----------------------------------------------------------------
log "Subindo a stack (migrations do Prisma são aplicadas no start da API)"
"${DC[@]}" up -d --remove-orphans --no-build

# --- Migração única: fotos do MinIO para o disco ----------------------------
# Antes as fotos ficavam no MinIO. Se o volume antigo existir e a importação ainda não
# rodou, sobe o MinIO uma vez, copia as fotos para o volume "uploads" e desliga.
if docker volume inspect leilao-prod_minio_data >/dev/null 2>&1 && [ ! -f .photos-imported ]; then
  log "Importando fotos antigas do MinIO para o disco (uma vez só)"
  "${DC[@]}" --profile legado up -d minio
  sleep 8
  if "${DC[@]}" exec -T api node dist/scripts/import-minio-photos.js; then
    touch .photos-imported
  fi
  "${DC[@]}" --profile legado stop minio || true
  "${DC[@]}" --profile legado rm -f minio || true
fi

log "Removendo imagens antigas sem uso"
docker image prune -f >/dev/null 2>&1 || true

log "Status dos serviços"
"${COMPOSE[@]}" -f compose.prod.yml --env-file .env ps

log "Deploy concluído. Front em ${PUBLIC_URL} (nginx na porta ${APP_PORT})."
