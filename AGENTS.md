# AGENTS.md — Arremate (leilão em tempo real · Hackathon CATI Jr 2026)

Guia de estado do projeto para pessoas e agentes de código. **Atualize este arquivo sempre que
uma rota, evento ou regra mudar** — principalmente a seção [O que falta fazer](#o-que-falta-fazer).

> Última atualização: 14/11/2026 — front-end React implementado em `app/` a partir de `design/`.

---

## 1. Visão geral

Sistema de leilões online com salas ao vivo. Qualquer conta pode anunciar itens (comitente) e dar
lances (participante). Leilões abrem e fecham sozinhos pelo relógio do servidor; durante a
disputa os lances são transmitidos em tempo real para todos na sala.

| Camada | Tecnologia | Pasta | Estado |
|---|---|---|---|
| API REST | Node 24, Express 5, Zod 4, TypeScript | `api/` | ~70% (falta o núcleo de lances) |
| Banco | PostgreSQL 17 + Prisma 7 | `api/src/prisma/` | Usuário, Item, Leilão, Itens do leilão. **Sem tabela de lances** |
| Tempo real | Socket.IO 4 | `api/src/socket/` | Só `join`/`leave` + evento de status |
| Estado quente da sala | Redis 7 | `compose.yml` | **Sobe no compose, mas a API ainda não usa** |
| Fotos | MinIO (S3) | `api/src/utils/storage.ts` | Pronto |
| Front-end | React 19, Vite 8, React Router 7, Axios, socket.io-client, lucide-react | `app/` | Todas as telas do design implementadas |
| Design | HTML de referência + tokens | `design/` | Referência, não rodar |

Requisitos originais: `Requisitos_Leilao_Hackathon.pdf` (é imagem; os códigos RFxx citados no
código e no design vêm dele).

### Arquitetura pretendida (decisão da equipe)

```
navegador ──HTTP (cookies httpOnly)──▶ API Express ──▶ PostgreSQL (fonte da verdade, histórico)
    │                                     │
    └──────Socket.IO (mesmo cookie)───────┤──▶ Redis (estado da sala enquanto ela está aberta:
                                          │     preço atual, líder, lance mínimo, término,
                                          │     presença, chaves de idempotência, anti-rajada)
                                          └──▶ MinIO (fotos)
```

- **PostgreSQL** guarda tudo que é permanente (leilões, itens, lances aceitos, resultado).
- **Redis** guarda o estado da sala **só enquanto o leilão está Em andamento**.
- **Socket.IO** transmite lances e mudanças de estado. A sala só muda depois que o lance foi gravado.
- **Regra de queda (decisão da equipe):** se o serviço cair durante a execução de salas, os
  leilões que estavam Em andamento devem ser considerados **Cancelados** quando o sistema voltar.
  ⚠️ O código atual faz o contrário (ver [Divergências](#divergências-conhecidas)).

---

## 2. Como rodar

```bash
# Tudo (dev, com hot reload) — API na 3333, front na 5173
cp .env.example .env                 # opcional; tudo tem default
cp api/.env.example api/.env
cp app/.env.example app/.env         # VITE_API_URL=http://localhost:3333
docker compose up -d                 # postgres, redis, minio, api, app

# Alternativa: front fora do Docker (pare o serviço app antes: docker compose stop app)
cd app && npm install && npm run dev
```

Scripts do front: `npm run dev`, `npm run build` (tsc + vite), `npm run lint`.
Scripts da API: `npm run dev`, `npm run typecheck`, `npm run db:migrate`, `npm run db:studio`.

Para a demo, use leilões curtos: no `api/.env`, `AUCTION_MIN_LEAD_SECONDS=60` e
`AUCTION_MIN_DURATION_SECONDS=180` (já são os defaults ou próximos disso).

### Deploy (produção)

- Workflow `.github/workflows/deploy.yml` roda a cada push na `main` (e manualmente). Entra por SSH
  no servidor usando `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_PORT`, `DEPLOY_PATH` e
  `PUBLIC_URL` (secrets) e executa `bash deploy.sh`.
- `deploy.sh` atualiza o repo por `git fetch`/`reset --hard` (remote via SSH), cria/completa o `.env`
  de produção e roda `docker compose -f compose.prod.yml up -d --build`.
- `compose.prod.yml` é independente do `compose.yml` (dev): builda `api/Dockerfile` (Node + migrations
  no start) e `app/Dockerfile` (build Vite → nginx na **8080**). O nginx serve a SPA e faz proxy de
  `/user`, `/auth`, `/item`, `/auction` e `/socket.io` para a API; o front é buildado com
  `VITE_API_URL=PUBLIC_URL` (mesma origem). MinIO publica a porta 9000 para as fotos.

---

## 3. Modelo de dados (Prisma — `api/src/prisma/schema.prisma`)

- **User**: `id, email (único), name, password (bcrypt), sessionVersion, refreshTokenHash, refreshTokenExpires`.
- **Item**: `id, ownerId, name, description, category, images[]` (chaves do bucket; a API devolve URLs públicas).
- **Auction** (um *lote*): `id, ownerId, title, description, status, startingPriceCents, bidCount,
  startsAt, originalEndsAt, endsAt, winnerId, finalPriceCents`.
  - Em andamento: `winnerId`/`finalPriceCents` = **líder e preço atuais**. Depois: vencedor e valor pago.
- **AuctionItem**: liga leilão ↔ item com `position` (o primeiro é a capa). Um leilão pode ter até 10 itens.
- **Enums**: `AuctionStatus = SCHEDULED | RUNNING | SOLD | ENDED_NO_BIDS | CANCELLED`;
  `Category = ELECTRONICS | FASHION | HOME | VEHICLES | ART | COLLECTIBLES | SPORTS | BOOKS | OTHER`
  (o front traduz em `app/src/lib/format.ts`).
- Dinheiro **sempre em centavos inteiros**. Datas `timestamptz`.

> `tabelas-banco.md` é o rascunho antigo (tinha `score`, `extra_time`, `minimum_bid`…). O schema
> Prisma é o que vale.

---

## 4. API — o que já existe

Formato de erro padrão: `{ success: false, error: CODE, message, details: string[] }`.
Respostas de leilão trazem `serverTime` para o front sincronizar o relógio (RF16).
Autenticação: cookies httpOnly `accessToken` (15 min) e `refreshToken` (7 dias, `path=/auth`, rotativo).

### Auth / Usuário
| Método | Rota | Acesso | Notas |
|---|---|---|---|
| POST | `/user` | público | cadastro `{ name, email, password(min 8) }` |
| GET | `/user` | login | `{ user }` (próprio, com e-mail) |
| GET | `/user/:id` | público | perfil público (sem e-mail) |
| PUT | `/user` | login | `{ name }` |
| DELETE | `/user` | login | |
| POST | `/auth/login` | público | seta cookies, devolve `{ user }` |
| POST | `/auth/refresh` | cookie | rotaciona tokens |
| POST | `/auth/logout` | login | invalida a sessão (`sessionVersion++`) |

### Itens (multipart, fotos no campo `images`, 3–10, JPG/PNG/WebP, ≤ 5 MB, conteúdo verificado)
| Método | Rota | Notas |
|---|---|---|
| GET | `/item/categories` | público |
| GET | `/item` | meus itens + leilões de que participaram |
| GET | `/item/:id` | só do dono |
| POST | `/item` | cria item com fotos |
| PUT | `/item/:id` | fotos novas substituem todas; bloqueado se o item está em leilão rodando ou a < 30 min do início |
| DELETE | `/item/:id` | só itens nunca leiloados |

### Leilões
| Método | Rota | Acesso | Notas |
|---|---|---|---|
| GET | `/auction/all` | público | `?q=&category=A,B&status=RUNNING,SCHEDULED&ownerId=&page=&pageSize=` (padrão: abertos, ordenado por término) |
| GET | `/auction/my` | login | os que eu criei |
| GET | `/auction/history` | login | os que eu **venci** (só SOLD) |
| GET | `/auction/:id` | público | inclui `items`, `owner`, `minimumBidCents` |
| POST | `/auction` | login | `{ title, description, itemIds[], startingPriceCents, startsAt(ISO c/ fuso), durationSeconds }`. Também é a relistagem (RF28) |
| PUT | `/auction/:id` | dono | matriz RF23 (abaixo); `appendDescription` acrescenta texto |
| DELETE | `/auction/:id` | dono | marca CANCELLED (só agendado ou rodando sem lances) |

### Ciclo de vida (`api/src/jobs/auctionLifecycle.ts`)
A cada `AUCTION_TICK_MS` (1 s): `SCHEDULED → RUNNING` quando chega `startsAt`; `RUNNING → SOLD`
(com lances) ou `ENDED_NO_BIDS` no `endsAt`. UPDATEs condicionais (idempotente, seguro com várias
instâncias). Emite `auction:status` para a sala.

### Socket.IO (`api/src/socket/index.ts`)
- Handshake exige o cookie `accessToken` (erro `UNAUTHORIZED`).
- `auction:join { auctionId }` → ack `{ ok, serverTime }` (entra na room `auction:<id>`).
- `auction:leave { auctionId }`.
- Servidor emite `auction:status { auctionId, status, endsAt, winnerId, finalPriceCents, serverTime }`.

### Regras de negócio já implementadas
- **Incremento mínimo** (`api/src/utils/money.ts`): até R$ 99,99 → R$ 1; até 499,99 → 5; até 999,99 → 10;
  até 4.999,99 → 50; até 24.999,99 → 100; acima → 500. Primeiro lance pode ser igual ao preço inicial.
- **Edição (RF23)**: Agendado > 30 min antes = tudo; Agendado ≤ 30 min = nada; Em andamento = só
  acrescentar texto; Finalizado = nada.
- **Cancelamento (RF08)**: agendado ou em andamento **sem lances**; nunca apaga.
- **Relistagem (RF28)**: item não pode estar em dois leilões abertos nem ter sido vendido.
- Locks `SELECT … FOR UPDATE` em item/leilão para evitar corrida.

---

## 5. Front-end (`app/`)

Implementado a partir de `design/DESIGN.md` + `design/telas/*.html` + `design/tokens.css`
(copiado para `app/src/styles/tokens.css`). Nome provisório da marca: **Arremate**.

| Rota | Página | Acesso | API usada |
|---|---|---|---|
| `/entrar` (`?modo=cadastro&next=`) | `pages/Login.tsx` | público | `POST /user`, `POST /auth/login` |
| `/` | `pages/Listagem.tsx` | público | `GET /auction/all` (busca, estado, categoria, “carregar mais”) |
| `/leiloes/:id` | `pages/Detalhe.tsx` | público | `GET /auction/:id` |
| `/leiloes/:id/sala` | `pages/Sala.tsx` | login | `GET /auction/:id` + Socket.IO + **pendentes** |
| `/anunciar` (`?relistar=:id`) | `pages/Criar.tsx` | login | `GET /item`, `POST /item`, `POST /auction` |
| `/meus-leiloes` | `pages/MeusLeiloes.tsx` | login | `GET /auction/my`, `PUT`/`DELETE /auction/:id` |
| `/participacoes` | `pages/Participacoes.tsx` | login | **pendente** (fallback: `GET /auction/history`) |
| `/comitentes/:id` | `pages/Perfil.tsx` | público | `GET /user/:id`, `GET /auction/all?ownerId=` |

Estrutura:
```
app/src/
  config.ts              limites (fotos, nomes, prazos), durações, VITE_API_URL, VITE_PENDING_FALLBACK
  types.ts               tipos espelhando as respostas da API
  lib/format.ts          dinheiro (centavos→BRL), parse de valor, datas no fuso de quem vê,
                         "Marina T.", iniciais, cor de avatar por hash, tabela de incremento
  lib/serverClock.ts     offset do relógio do servidor (serverTime de cada resposta)
  services/api.ts        axios + refresh automático no 401 + tradução de erros + isMissingRoute
  services/*Service.ts   auth, user, item, auction
  services/socket.ts     socket singleton, join, placeBid (com chave de idempotência), contrato de eventos
  services/pending.ts    rotas que ainda não existem → resposta genérica
  contexts/AuthContext   sessão (GET /user ao abrir), login, cadastro (cria e já entra), logout
  components/            Layout/cabeçalho, RequireAuth, AuctionCard, StatusBadge, Gallery, Dialog…
  pages/                 uma por tela do design
```

### Respostas genéricas (rotas pendentes)
Tudo que o front precisa e a API ainda não tem fica em `services/pending.ts` e `services/socket.ts`.
Cada chamada tenta a rota real; se a API responder “rota não existe” (404 `Route … not found`, ou
400 de UUID quando o caminho cai em `/:id`), usa uma resposta genérica e loga `[pendente]` no console.
**Quando o back implementar com o contrato abaixo, o front passa a usar a rota real sem mudanças.**
Desligue com `VITE_PENDING_FALLBACK=false` para ver os erros reais.

| Pendência | Resposta genérica atual |
|---|---|
| `GET /auction/:id/bids` | lista vazia; a sala acumula os lances que chegam pelo socket |
| `GET /auction/participations` | só os leilões vencidos (`/auction/history`) como “Vencedor” |
| socket `auction:bid` (ack) | sem ack em 5 s → “aceito” local, calculando preço/mínimo/prorrogação no cliente (**não grava nada**) |
| `auction:join` com snapshot | front busca `GET /auction/:id` ao entrar/reconectar |
| `auction:presence` / `auction:role` | contadores de participantes/espectadores ficam ocultos |

---

## 6. Contratos que o back precisa implementar (o front já consome)

### Socket — `auction:bid` (cliente → servidor, com ack)
```ts
emit('auction:bid', { auctionId, amountCents, idempotencyKey })
// ack de sucesso
{ ok: true, bid: Bid, auction: { finalPriceCents, minimumBidCents, bidCount, endsAt, winnerId } }
// ack de recusa (sempre com o mínimo vigente)
{ ok: false, error: 'BID_TOO_LOW'|'AUCTION_NOT_RUNNING'|'IS_OWNER'|'ALREADY_LEADER'|'RATE_LIMITED'|'UNAUTHORIZED'|'INVALID_PAYLOAD',
  message?: string, minimumBidCents: number }
```
Validação **no momento do processamento** (design/Fluxos.html): sessão válida e usuário na sala;
leilão RUNNING e antes do `endsAt` (relógio do servidor); autor ≠ comitente e ≠ líder atual;
valor ≥ mínimo vigente. Anti-rajada: 500 ms entre lances do mesmo usuário (reenvio com a mesma
chave não conta). Mesma `idempotencyKey` → devolve o resultado original.

### Socket — `auction:bid` (servidor → sala, depois de gravar)
```ts
{ auctionId, bid: Bid, priceCents, minimumBidCents, leaderId, bidCount, endsAt, extended: boolean, serverTime }
// Bid = { id, auctionId, bidderId, bidderName /* "Marina T." */, amountCents, createdAt }
```
**Prorrogação**: lance com < 2 min para o fim leva `endsAt` para 2 min depois do lance, limitado a
`originalEndsAt + 30 min`.

### Socket — presença (opcional, RF09)
- cliente → `auction:role { auctionId, role: 'participant' | 'spectator' }`
- servidor → `auction:presence { auctionId, participants, spectators }`

### Socket — snapshot no join (há um TODO no código)
ack do `auction:join`: `{ ok, serverTime, snapshot: { auction, bids: Bid[] (últimos 20), presence } }`.

### REST
- `GET /auction/:id/bids?limit=20` → `{ success, bids: Bid[] }` (mais recente primeiro).
- `GET /auction/participations` → `{ success, participations: { auction, myHighestBidCents, situation: 'LEADING'|'OUTBID'|'WON'|'LOST' }[] }`.
  **Registrar antes de `/auction/:id`** no router (senão cai na validação de UUID).

---

## O que falta fazer

### Back-end (prioridade de cima para baixo)
- [ ] **Tabela `Bid`** no Prisma (`id, auctionId, bidderId, amountCents, idempotencyKey (único por usuário), createdAt`) + migration.
- [ ] **Handler `auction:bid`** no socket com as 4 validações, lock `FOR UPDATE` no leilão, atualização de
      `finalPriceCents/winnerId/bidCount/endsAt`, prorrogação e broadcast (contrato na seção 6).
- [ ] **Redis**: adicionar `REDIS_URL` ao `env.ts` (hoje está no `.env` mas não é validado), cliente (`ioredis`),
      estado quente da sala (`auction:<id>` → preço, líder, mínimo, endsAt), chaves de idempotência com TTL,
      anti-rajada (`SET NX PX 500`), presença. Considerar `@socket.io/redis-adapter` para várias instâncias.
- [ ] **Regra de queda**: na subida da API, marcar como `CANCELLED` os leilões que estavam `RUNNING`
      (e limpar as chaves da sala no Redis) **antes** de iniciar o `auctionLifecycle`. Ver divergência abaixo.
- [ ] **Snapshot no `auction:join`** (TODO em `api/src/socket/index.ts`).
- [ ] `GET /auction/:id/bids` e `GET /auction/participations`.
- [ ] Nome do líder no leilão (hoje só `winnerId`; o front mostra “Outro participante” se o lance não estiver na lista).
- [ ] Presença (`auction:role` / `auction:presence`).
- [ ] Ordenação no servidor na listagem (`?sort=ends|starts|price|bids`); hoje o front ordena só a página carregada.
- [ ] Rate limit HTTP no login/cadastro.
- [ ] Testes (lifecycle, lances concorrentes, idempotência, prorrogação).
- [ ] Alinhar limite de fotos: API aceita até 10 (`ITEM_MAX_PHOTOS`), design diz 8 (front usa 8).
- [ ] Mensagens de erro em português na API (hoje em inglês; o front traduz as mais comuns em `services/api.ts`).

### Front-end
- [ ] Ligar a sala ao `auction:bid` real assim que existir (já pronto; basta o back responder o ack).
- [ ] Remover as respostas genéricas (`VITE_PENDING_FALLBACK=false`) quando as rotas existirem.
- [ ] Editar item (fotos/nome) a partir de “Meus leilões” (a rota `PUT /item/:id` existe; falta tela).
- [ ] Página de conta (trocar nome / excluir conta — rotas `PUT`/`DELETE /user` existem).
- [ ] Busca de comitentes no cabeçalho do perfil (design `Perfil.html`) — **não há rota de busca de usuários**.
- [ ] Reordenar fotos/escolher capa no anunciar.
- [ ] Testes (Vitest + Testing Library) e e2e da jornada de lance.
- [x] Serviço `app` no `compose.yml` (Vite dev em http://localhost:5173, porta via `APP_PORT`).

### Infra / entrega
- [x] `.env` de produção, segredos e deploy automático (GitHub Actions + `deploy.sh` + `compose.prod.yml`).
- [ ] Bucket/MinIO na nuvem e TLS (hoje `S3_PUBLIC_URL` aponta para o MinIO publicado na 9000).
- [x] README raiz com instruções de dev e deploy.

---

## Divergências conhecidas
1. **Queda do serviço**: `auctionLifecycle.ts` diz que reiniciar “não perde nada” e fecha normalmente os
   leilões que venceram enquanto a API estava fora. A decisão da equipe é **cancelar** os que estavam
   em andamento. Precisa mudar o job (e o comentário) — o `closeDue` hoje transformaria em SOLD/ENDED.
2. **Lote vs. item**: o design pressupõe 1 item por leilão; a API modela *lotes* (vários itens). O front
   suporta os dois (galeria junta as fotos de todos os itens; capa = primeiro item).
3. **Limites**: design 3–8 fotos / API 3–10; duração mínima design 3 min / API 60 s (env).
4. `leilao-front/` foi removido do git e substituído por `app/` (ainda não commitado).

## Convenções
- Código e comentários em português; nomes de variáveis em inglês.
- Dinheiro em centavos (`Int`) em todo lugar; formatar só na tela (`Intl.NumberFormat('pt-BR', BRL)`).
- O relógio que vale é o do servidor; o front só exibe (`serverNow()`).
- Estilo: só tokens de `tokens.css`; Space Grotesk 700 para títulos/valores, Inter para texto; ícones lucide.
- Cores com significado fixo: `--primary` ação, `--live` ao vivo, `--win` vitória/liderança,
  `--warn` prorrogação/reconexão, `--danger` erro/cancelar.
