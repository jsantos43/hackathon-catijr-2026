# hackathon-catijr-2026 — Arremate

Sistema de leilões online em tempo real. API Node/Express + Prisma (PostgreSQL) + Redis +
Socket.IO, front React servido por nginx em produção. Um leilão pode ser um **lote com vários
itens** (até 10): o vencedor leva todos. Detalhes de arquitetura e regras em
[`AGENTS.md`](./AGENTS.md); guia da API em [`api/README.md`](./api/README.md).

- **Sistema publicado:** _preencher com a `PUBLIC_URL` da VM_

## Contas de demonstração (RNF04)

Criadas pelo seed. Senha de todas: **`arremate123`**.

| E-mail | Papel no seed |
|---|---|
| `marina@arremate.dev` | comitente: lote Em andamento com lances, vendido, agendado |
| `rafael@arremate.dev` | comitente: leilão que abre em 2 min, encerrado sem lances, cancelado |
| `ana@arremate.dev`, `bruno@arremate.dev`, `carla@arremate.dev` | compradores (já deram lances) |

```bash
# dev
docker compose exec api npm run db:seed              # cria os dados (não duplica)
docker compose exec api npm run db:seed -- --sala    # + um lote novo Em andamento (10 min), bom para a demo
docker compose exec api npm run db:seed -- --reset   # apaga TUDO e recria

# produção (na VM)
docker compose -f compose.prod.yml --env-file .env exec api node dist/scripts/seed.js
docker compose -f compose.prod.yml --env-file .env exec api node dist/scripts/seed.js --sala
```

## Recriar o ambiente do zero (RNF03)

```bash
cp .env.example .env
cp api/.env.example api/.env
cp app/.env.example app/.env
docker compose up -d                      # API :3333, front Vite :5173, Postgres, Redis
docker compose exec api npm run db:seed   # dados de demonstração
```

Testes:

```bash
cd api && npm test            # 87 testes de API (precisam do Postgres e do Redis do compose)
cd app && npm run test:e2e    # Playwright: jornada de lance com 4 navegadores (precisa do compose no ar)
# primeira vez: cd app && npx playwright install chromium
```

## Decisões da equipe (seção 8)

| Requisito | Decisão | Por quê |
|---|---|---|
| RF02 sessão | Cookies httpOnly: access token de 15 min + refresh de 7 dias, rotativo (renova com o uso). Cada lance reconfere a sessão. | Cookie httpOnly não é lido por JS; refresh rotativo derruba sessão roubada. |
| RF05/RF06 limites | 3–8 fotos JPG/PNG/WebP de até 5 MB (conteúdo conferido pelos bytes); título 3–100; início de 1 min a 30 dias; duração de 1 min a 7 dias; lote de até 10 itens. Tudo no `.env`. | Leilão curto para a demo sem mexer em código. |
| Fotos (RF07 riscado) | Arquivos crus no disco da VM (volume Docker), servidos pelo nginx com cache de 1 ano. | Com 1 vCPU / 1 GB, o MinIO consumia memória que a VM não tinha. |
| RF09 tempo real | Socket.IO com adapter Redis. Sala mostra todos os lances (ranking); nome abreviado “Marina T.”. | Reconexão automática e salas prontas; o adapter permite várias instâncias. |
| RF11 concorrência | PostgreSQL decide: transação com `SELECT … FOR UPDATE` na linha do leilão. O evento só sai depois do COMMIT. | Simples de provar correto; lance, edição, cancelamento e fechamento travam a mesma linha. |
| RF12 reenvio | Chave de idempotência gerada no navegador; Redis devolve o resultado original e um índice único no banco garante mesmo sem Redis. | Clique duplo e rede instável não criam segundo lance. |
| RF13 anti-rajada | 500 ms entre lances do mesmo usuário; reenvio com a mesma chave não conta. | Não pune reenvio legítimo nem bloqueia outras pessoas. |
| RF14 lance mínimo | Tabela de incrementos de referência (R$ 1 até R$ 99,99 … R$ 500 acima de R$ 25 mil). | Previsível e fácil de explicar. |
| RF15 prorrogação | Lance com menos de 2 min no relógio leva o término a 2 min depois dele; máximo de 30 min acumulados. | Dá chance de resposta sem esticar para sempre. |
| RF18 queda | Ao subir, todo leilão com `startsAt <= agora` ainda não finalizado vira Cancelado (`AUCTION_CANCEL_RUNNING_ON_BOOT`); os lances da sala vão para o histórico. Durante a disputa os lances ficam só no Redis e vão ao PostgreSQL no fechamento. | _Ver observação no AGENTS.md (conflito com RN01)._ |
| RF20/RF21 listagem e busca | Abertos por padrão (ao vivo primeiro); filtros combináveis de texto, categorias e estado; busca ignora acentos e maiúsculas (`unaccent`); “carregar mais” de 12 em 12. | “camera” acha “Câmera”; a página não carrega tudo de uma vez. |
| RF22 comitentes | Busca por pedaço do nome; só aparece quem já anunciou. Conta excluída vira “Conta excluída” e o histórico fica. | Perfil público sem e-mail; leilões e lances nunca são apagados (RF08). |
| RF23 edição | Matriz de referência: > 30 min do início tudo; ≤ 30 min nada; em andamento só acrescentar texto. Vale também para fotos e dados dos itens. | Nada muda depois que alguém pode ter decidido dar lance. |
| RNF01 VM | Uma VM com Docker Compose: nginx (front + proxy + fotos), API Node, PostgreSQL e Redis, com limite de memória por serviço. Imagens construídas no GitHub Actions. | Cabe em 1 vCPU / 1 GB (≈ 115 MB em repouso); buildar na VM estourava a memória. |

## Deploy (produção)

O deploy é automático a cada push na `main` pelo workflow
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml):

1. **No GitHub Actions**: constrói as imagens da API e do front e publica no GHCR
   (`ghcr.io/<dono>/<repo>-api` e `-app`, tag = commit).
2. **Na VM, por SSH**: faz login temporário no GHCR com o token do job e roda o
   [`deploy.sh`](./deploy.sh), que:
   - atualiza o repositório (`git fetch`/`reset --hard`);
   - cria o `.env` de produção na primeira execução (senhas e `JWT_SECRET` aleatórios);
   - **baixa** as imagens prontas (`API_IMAGE`/`APP_IMAGE`; nunca constrói na VM) e sobe `compose.prod.yml`.

Em produção o nginx (porta **8080**) serve o front, as fotos em `/uploads` e faz proxy de `/user`,
`/auth`, `/item`, `/auction`, `/health` e `/socket.io` para a API. As migrations do Prisma são
aplicadas no start do container da API. Limites de memória: Postgres 256 MB, Redis 64 MB,
API 320 MB, nginx 48 MB.

### Segredos do repositório no GitHub

| Secret | Descrição |
|---|---|
| `SSH_HOST` | host/IP do servidor |
| `SSH_USER` | usuário SSH com acesso ao Docker |
| `SSH_PRIVATE_KEY` | chave privada usada pelo Actions para entrar no servidor |
| `SSH_PORT` | porta SSH (opcional, padrão 22) |
| `DEPLOY_PATH` | caminho do repositório no servidor (ex.: `/opt/leilao`) |
| `PUBLIC_URL` | URL pública do front (ex.: `http://IP:8080`) — também vai no build do front |

Pré-requisitos no servidor:

- Docker Engine + plugin Compose instalados;
- repositório clonado em `DEPLOY_PATH` com o remote `origin` em SSH e uma **deploy key** com acesso
  de leitura;
- usuário do SSH com permissão de rodar `docker` (grupo `docker`);
- swap configurado na VM (o `deploy.sh` não cria).

Deploy manual no servidor: `API_IMAGE=ghcr.io/... APP_IMAGE=ghcr.io/... bash deploy.sh` (imagens já publicadas).
