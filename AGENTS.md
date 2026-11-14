# AGENTS.md — Arremate (leilão em tempo real · Hackathon CATI Jr 2026)

Guia de estado do projeto para pessoas e agentes de código. **Atualize este arquivo sempre que
uma rota, evento ou regra mudar** — principalmente a seção [O que falta fazer](#o-que-falta-fazer).

> Última atualização: 14/11/2026 — núcleo de lances (tabela `Bid`, socket `auction:bid`, Redis, presença,
> regra de queda), rotas de lances/participações, testes automatizados da API e front ligado ao back real.
> Guia didático da API: [`api/README.md`](api/README.md).

---

## 1. Visão geral

Sistema de leilões online com salas ao vivo. Qualquer conta pode anunciar itens (comitente) e dar
lances (participante). Leilões abrem e fecham sozinhos pelo relógio do servidor; durante a
disputa os lances são transmitidos em tempo real para todos na sala.

| Camada | Tecnologia | Pasta | Estado |
|---|---|---|---|
| API REST | Node 24, Express 5, Zod 4, TypeScript | `api/` | Completa (ver [O que falta](#o-que-falta-fazer)) |
| Banco | PostgreSQL 17 + Prisma 7 | `api/src/prisma/` | Usuário, Item, Leilão, Itens do leilão, **Lance** |
| Tempo real | Socket.IO 4 + `@socket.io/redis-adapter` | `api/src/socket/` | join (com snapshot), leave, role, bid, status, presence |
| Estado quente da sala | Redis 7 (ioredis) | `api/src/redis/`, `services/RoomState.ts` | Estado da sala, idempotência, anti-rajada, presença, rate limit |
| Testes da API | Vitest 3 + Supertest + socket.io-client | `api/tests/` | 78 testes (unitários + integração com Postgres/Redis reais) |
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
  leilões que estavam Em andamento são marcados **Cancelados** quando o sistema volta
  (`AuctionLifecycle.recoverFromCrash()`, roda antes do job). Desligável em dev com
  `AUCTION_CANCEL_RUNNING_ON_BOOT=false`.

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
Scripts da API: `npm run dev`, `npm test`, `npm run test:unit`, `npm run typecheck` (src + tests),
`npm run db:migrate`, `npm run db:studio`.

Testes da API: precisam do Postgres e do Redis do compose no ar. Usam o banco `leilao_test`
(criado e migrado automaticamente) e o Redis DB 15 — não tocam nos dados de dev. O MinIO é mockado.

⚠️ Em dev, o `tsx watch` reinicia a API a cada arquivo salvo, e a regra de queda cancela os
leilões Em andamento. Para testar a sala enquanto mexe na API: `AUCTION_CANCEL_RUNNING_ON_BOOT=false`.

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
- **Bid**: `id, auctionId, bidderId, amountCents, idempotencyKey, createdAt`. Só lances **aceitos**.
  `@@unique([bidderId, idempotencyKey])` garante que reenvio não duplica nem se o Redis cair.
- Respostas de leilão trazem `winner: { id, name } | null` (líder atual / vencedor).
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
| GET | `/health` | público | `{ database, redis }` up/down (503 se algum cair) |

Login e cadastro têm rate limit por IP no Redis (`AUTH_RATE_LIMIT_MAX` por `AUTH_RATE_LIMIT_WINDOW_SECONDS`, 429).

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
| GET | `/auction/all` | público | `?q=&category=A,B&status=RUNNING,SCHEDULED&ownerId=&sort=live\|ends\|starts\|price\|bids&page=&pageSize=` (padrão: abertos, ordenado por término; `live` = Em andamento por término e depois Agendados por início) |
| GET | `/auction/participations` | login | onde dei lance: `{ auction, myHighestBidCents, situation: LEADING\|OUTBID\|WON\|LOST }[]` |
| GET | `/auction/:id/bids` | público | `?limit=20`, mais recente primeiro, `bidderName` já abreviado ("Marina T.") |
| GET | `/auction/my` | login | os que eu criei |
| GET | `/auction/history` | login | os que eu **venci** (só SOLD) |
| GET | `/auction/:id` | público | inclui `items`, `owner`, `minimumBidCents` |
| POST | `/auction` | login | `{ title, description, itemIds[], startingPriceCents, startsAt(ISO c/ fuso), durationSeconds }`. Também é a relistagem (RF28) |
| PUT | `/auction/:id` | dono | matriz RF23 (abaixo); `appendDescription` acrescenta texto |
| DELETE | `/auction/:id` | dono | marca CANCELLED (só agendado ou rodando sem lances) |

### Ciclo de vida (`api/src/jobs/AuctionLifecycle.ts`)
Na subida: `recoverFromCrash()` (regra de queda). Depois, a cada `AUCTION_TICK_MS` (1 s):
`SCHEDULED → RUNNING` quando chega `startsAt` (cria `room:<id>:state` no Redis); `RUNNING → SOLD`
(com lances) ou `ENDED_NO_BIDS` no `endsAt` (apaga o estado do Redis). UPDATEs condicionais
(idempotente, seguro com várias instâncias). Emite `auction:status` para a sala.

### Socket.IO (`api/src/socket/`, contrato em `contract.ts`)
- Handshake exige o cookie `accessToken` (erro `UNAUTHORIZED`). Cada lance reconfere a sessão.
- `auction:join`, `auction:leave`, `auction:role`, `auction:bid` — contrato completo na seção 6.
- Servidor emite `auction:status`, `auction:bid` (depois do COMMIT) e `auction:presence`.
- Adapter do Redis: com várias instâncias da API, o emit chega a todas.

### Regras de negócio já implementadas
- **Incremento mínimo** (`api/src/utils/money.ts`): até R$ 99,99 → R$ 1; até 499,99 → 5; até 999,99 → 10;
  até 4.999,99 → 50; até 24.999,99 → 100; acima → 500. Primeiro lance pode ser igual ao preço inicial.
- **Edição (RF23)**: Agendado > 30 min antes = tudo; Agendado ≤ 30 min = nada; Em andamento = só
  acrescentar texto; Finalizado = nada.
- **Cancelamento (RF08)**: agendado ou em andamento **sem lances**; nunca apaga.
- **Relistagem (RF28)**: item não pode estar em dois leilões abertos nem ter sido vendido.
- Locks `SELECT … FOR UPDATE` em item/leilão para evitar corrida. **Lance, cancelamento, edição e
  fechamento travam a mesma linha do leilão**, então nunca se atropelam.
- **Lance**: idempotência (Redis + índice único), anti-rajada (`BID_THROTTLE_MS`), pré-validação no
  Redis, decisão final no Postgres. Fluxo completo em `api/README.md` seção 3.

---

## 5. Front-end (`app/`)

Implementado a partir de `design/DESIGN.md` + `design/telas/*.html` + `design/tokens.css`
(copiado para `app/src/styles/tokens.css`). Nome provisório da marca: **Arremate**.

| Rota | Página | Acesso | API usada |
|---|---|---|---|
| `/entrar` (`?modo=cadastro&next=`) | `pages/Login.tsx` | público | `POST /user`, `POST /auth/login` |
| `/` | `pages/Listagem.tsx` | público | `GET /auction/all` (sempre abertos, `sort=live` por padrão; busca grande com categorias múltiplas embutidas em `components/CategoryPicker`, `?categoria=A,B`; “carregar mais”) |
| `/leiloes/:id` | `pages/Detalhe.tsx` | público | `GET /auction/:id` |
| `/leiloes/:id/sala` | `pages/Sala.tsx` | login | Socket.IO (snapshot no join, `auction:bid`, presença) + `GET /auction/:id`, `GET /auction/:id/bids?limit=100` (completa o ranking) — destaque de tempo/valor atual e ranking do maior para o menor lance |
| `/anunciar` | `pages/Inventario.tsx` | login | `GET /item` — passo 1: inventário; escolhe item(ns) ou vai cadastrar um novo |
| `/anunciar/novo-item` | `pages/NovoItem.tsx` | login | `POST /item` — cadastra e segue para o leilão com ele |
| `/anunciar/leilao?itens=a,b` (`?relistar=:id`) | `pages/Criar.tsx` | login | `GET /item`, `POST /auction` — passo 2: dados do leilão |
| `/meus-leiloes` | `pages/MeusLeiloes.tsx` | login | `GET /auction/my`, `PUT`/`DELETE /auction/:id` |
| `/participacoes` | `pages/Participacoes.tsx` | login | `GET /auction/participations` |
| `/comitentes/:id` | `pages/Perfil.tsx` | público | `GET /user/:id`, `GET /auction/all?ownerId=` |

Estrutura:
```
app/src/
  config.ts              limites (fotos, nomes, prazos), durações, VITE_API_URL
  types.ts               tipos espelhando as respostas da API
  lib/format.ts          dinheiro (centavos→BRL), parse de valor, datas no fuso de quem vê,
                         "Marina T.", iniciais, cor de avatar por hash, tabela de incremento
  lib/serverClock.ts     offset do relógio do servidor (serverTime de cada resposta)
  services/api.ts        axios + refresh automático no 401 + tradução de erros + isMissingRoute
  services/*Service.ts   auth, user, item, auction, bid (lances e participações)
  services/socket.ts     socket singleton, join (com papel), setRole, placeBid (chave de idempotência)
  contexts/AuthContext   sessão (GET /user ao abrir), login, cadastro (cria e já entra), logout
  components/            Layout/cabeçalho, RequireAuth, AuctionCard, StatusBadge, Gallery, Dialog…
  pages/                 uma por tela do design
```

As antigas “respostas genéricas” (`services/pending.ts`, `VITE_PENDING_FALLBACK`) foram removidas:
todas as rotas e eventos que o front usa existem na API.

---

## 6. Contratos de tempo real (implementados — `api/src/socket/contract.ts` ↔ `app/src/services/socket.ts`)

### Socket — `auction:bid` (cliente → servidor, com ack)
```ts
emit('auction:bid', { auctionId, amountCents, idempotencyKey })
// ack de sucesso
{ ok: true, bid: Bid, auction: { finalPriceCents, minimumBidCents, bidCount, endsAt, winnerId } }
// ack de recusa (sempre com o mínimo vigente)
// (+ extended: boolean, duplicate?: true quando é reenvio da mesma chave)
{ ok: false, error: 'BID_TOO_LOW'|'AUCTION_NOT_RUNNING'|'IS_OWNER'|'ALREADY_LEADER'|'RATE_LIMITED'|'UNAUTHORIZED'
                   |'INVALID_PAYLOAD'|'NOT_IN_ROOM'|'INTERNAL',
  message: string /* em português */, minimumBidCents: number | null }
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

### Socket — presença (RF09)
- cliente → `auction:role { auctionId, role: 'participant' | 'spectator' }` → ack `{ ok }`
- servidor → `auction:presence { auctionId, participants, spectators }` (conta pessoas, não abas;
  o comitente sempre conta como espectador)

### Socket — join com snapshot
`auction:join { auctionId, role? }` → ack `{ ok: true, serverTime, role, snapshot: { auction, bids: Bid[] (últimos 20), presence } }`
ou `{ ok: false, error: 'NOT_FOUND'|'INVALID_PAYLOAD'|'INTERNAL', message }`. Ao reconectar, o front
só entra de novo (passando o papel atual) e recebe o estado em dia.

### Socket — status
`auction:status { auctionId, status, endsAt, winnerId, finalPriceCents, serverTime }` ao abrir, vender,
encerrar sem lances e cancelar.

### REST
- `GET /auction/:id/bids?limit=20` → `{ success, bids: Bid[] }` (mais recente primeiro).
- `GET /auction/participations` → `{ success, participations: { auction, myHighestBidCents, situation: 'LEADING'|'OUTBID'|'WON'|'LOST' }[] }`
  (router `routes/bid.ts` registrado antes do de leilões, por causa de `/auction/:id`).

---

## O que falta fazer

### Back-end
- [x] Tabela `Bid` + migration `20261114210417_bids`.
- [x] Handler `auction:bid` (validações, lock `FOR UPDATE`, prorrogação, broadcast depois do COMMIT).
- [x] Redis: `REDIS_URL` validado, estado quente da sala, idempotência com TTL, anti-rajada, presença,
      `@socket.io/redis-adapter`.
- [x] Regra de queda na subida (`recoverFromCrash`), antes do job.
- [x] Snapshot no `auction:join`.
- [x] `GET /auction/:id/bids` e `GET /auction/participations`.
- [x] Nome do líder/vencedor (`winner`) nas respostas de leilão.
- [x] Presença (`auction:role` / `auction:presence`).
- [x] Ordenação no servidor (`?sort=live|ends|starts|price|bids`).
- [x] Rate limit HTTP no login/cadastro.
- [x] Testes (lifecycle, regra de queda, lances concorrentes, idempotência, prorrogação, socket ponta a ponta).
- [x] Middlewares em classes (`Auth.require`, `Validate.body/query/params`, `Upload.images`, `RateLimit.byIp`, `ErrorHandler`).
- [ ] Alinhar limite de fotos: API aceita até 10 (`ITEM_MAX_PHOTOS`), design diz 8 (front usa 8).
- [ ] Mensagens de erro REST em português (hoje em inglês; o front traduz as mais comuns em
      `services/api.ts`). As mensagens de lance (socket) já são em português.
- [ ] `sort=price` ordena em memória (ok para centenas de leilões); com muito volume, criar coluna de preço atual.
- [ ] Várias instâncias da API: a regra de queda roda em cada subida e cancelaria salas atendidas
      por outra instância. Para escalar horizontalmente, trocar por um "heartbeat" por instância.

### Front-end
- [x] Sala ligada ao `auction:bid` real, snapshot no join, papel preservado ao reconectar.
- [x] Respostas genéricas removidas; participações e lances usam as rotas reais.
- [x] Listagem ordena no servidor.
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
1. ~~Queda do serviço~~ — resolvido: a API cancela os leilões Em andamento ao subir.
2. **Lote vs. item**: o design pressupõe 1 item por leilão; a API modela *lotes* (vários itens). O front
   suporta os dois (galeria junta as fotos de todos os itens; capa = primeiro item).
3. **Limites**: design 3–8 fotos / API 3–10; duração mínima design 3 min / API 60 s (env).
4. O commit `f892760` tinha uma versão da sala com lances só no Redis (script Lua, eventos `bid:place` /
   `auction:state`). Foi substituída pela arquitetura acima (Postgres decide, Redis acelera) para seguir a
   decisão da equipe e o contrato que o front consome. Chaves antigas `auction:<id>:*` no Redis de dev
   podem ser apagadas sem problema.

## Convenções
- Código e comentários em português; nomes de variáveis em inglês.
- API em camadas: `routes → middlewares → controllers → services → prisma/redis`, tudo em classes com
  métodos estáticos. Services não conhecem Express; para avisar a sala, usam `socket/RoomEmitter`.
- Formato de resposta em `api/src/views/`; chaves do Redis só em `api/src/redis/keys.ts`.
- Dinheiro em centavos (`Int`) em todo lugar; formatar só na tela (`Intl.NumberFormat('pt-BR', BRL)`).
- O relógio que vale é o do servidor; o front só exibe (`serverNow()`).
- Estilo: só tokens de `tokens.css`; Space Grotesk 700 para títulos/valores, Inter para texto; ícones lucide.
- Cores com significado fixo: `--primary` ação, `--live` ao vivo, `--win` vitória/liderança,
  `--warn` prorrogação/reconexão, `--danger` erro/cancelar.
