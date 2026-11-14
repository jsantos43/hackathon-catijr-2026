# hackathon-catijr-2026 — Arremate

Sistema de leilões online em tempo real. API Node/Express + Prisma + Socket.IO, front React
servido por nginx em produção. Detalhes de arquitetura e regras em [`AGENTS.md`](./AGENTS.md).

## Desenvolvimento

```bash
cp .env.example .env
cp api/.env.example api/.env
cp app/.env.example app/.env
docker compose up -d        # API :3333, front Vite :5173, Postgres/Redis/MinIO
```

## Deploy (produção)

O deploy é automático a cada push na `main` pelo workflow
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml). Ele entra por SSH no servidor e
executa o [`deploy.sh`](./deploy.sh), que:

1. faz `git fetch`/`reset --hard` para o commit mais recente (o servidor acessa o repositório com
   a chave SSH configurada no remote `origin`);
2. cria o `.env` de produção na primeira execução (senhas e `JWT_SECRET` aleatórios);
3. constrói as imagens e sobe `compose.prod.yml` com `docker compose up -d --build`.

Em produção o front é buildado (`npm run build`) e servido pelo nginx na porta **8080**; o mesmo
nginx faz proxy de `/user`, `/auth`, `/item`, `/auction` e `/socket.io` para a API. As migrations do
Prisma são aplicadas no start do container da API.

### Segredos do repositório no GitHub

| Secret | Descrição |
|---|---|
| `SSH_HOST` | host/IP do servidor |
| `SSH_USER` | usuário SSH com acesso ao Docker |
| `SSH_PRIVATE_KEY` | chave privada usada pelo Actions para entrar no servidor |
| `SSH_PORT` | porta SSH (opcional, padrão 22) |
| `DEPLOY_PATH` | caminho do repositório no servidor (ex.: `/opt/leilao`) |
| `PUBLIC_URL` | URL pública do front (ex.: `https://leilao.exemplo.com`); padrão `http://localhost:8080` |

Pré-requisitos no servidor:

- Docker Engine + plugin Compose instalados;
- repositório clonado em `DEPLOY_PATH` com o remote `origin` em SSH e uma **deploy key** com acesso
  de leitura;
- usuário do SSH com permissão de rodar `docker` (grupo `docker`).

O MinIO publica a porta `9000` para o navegador carregar as fotos (`S3_PUBLIC_URL`). Para rodar o
deploy manualmente no servidor: `cd <repo> && bash deploy.sh`.
