# AGENTS.md — Arremate (leilão em tempo real · Hackathon CATI Jr 2026)

Guia de estado do projeto para pessoas e agentes de código. **Atualize este arquivo sempre que
uma rota, evento ou regra mudar** — principalmente a seção [O que falta fazer](#o-que-falta-fazer).

> Última atualização: 14/11/2026 (madrugada) — **sala só no Redis**: durante a disputa os lances vivem
> apenas no Redis (scripts Lua atômicos) e vão para o PostgreSQL de uma vez no fechamento
> (`services/Settlement.ts`); regra de queda por `startsAt`; deploy simplificado (sem swap, sem MinIO).
>
> Antes: 14/11/2026 (noite) — Nível 2 completo: busca de comitentes (RF22), filtro por estado e
> busca sem acentos (RF21), conta (nome/excluir), edição de item com ordem das fotos/capa, ordem dos itens do
> lote, seed de demonstração (RNF04), mensagens da API em português, e2e com Playwright. Infra para VM de
> 1 vCPU / 1 GB: fotos no disco (MinIO removido), imagens construídas no GitHub Actions, limites de memória.
> Guia didático da API: [`api/README.md`](api/README.md).

---

## 1. Visão geral

Sistema de leilões online com salas ao vivo. Qualquer conta pode anunciar itens (comitente) e dar
lances (participante). Leilões abrem e fecham sozinhos pelo relógio do servidor; durante a
disputa os lances são transmitidos em tempo real para todos na sala.

| Camada | Tecnologia | Pasta | Estado |
|---|---|---|---|
| API REST | Node 24, Express 5, Zod 4, TypeScript | `api/` | Completa (ver [O que falta](#o-que-falta-fazer)) |
| Banco | PostgreSQL 17 + Prisma 7 | `api/src/prisma/` | Usuário, Item, Leilão, Itens do leilão, **Lance** (gravados no fechamento) |
| Tempo real | Socket.IO 4 + `@socket.io/redis-adapter` | `api/src/socket/` | join (com snapshot), leave, role, bid, status, presence |
| Sala Em andamento | Redis 7 (ioredis, AOF) | `api/src/redis/`, `services/RoomState.ts`, `services/Settlement.ts` | Estado, **todos os lances**, idempotência, prazos, presença, sessão, rate limit |
| Testes da API | Vitest 3 + Supertest + socket.io-client | `api/tests/` | 87 testes (unitários + integração com Postgres/Redis reais) |
| Testes e2e | Playwright (Chromium) | `app/e2e/` | Jornada de lance com 4 navegadores (RF04, RF09, RF10, RF24, RF25, RF26) |
| Fotos | Disco da VM (volume `uploads`), servidas pelo nginx | `api/src/utils/storage.ts` | Pronto |
| Front-end | React 19, Vite 8, React Router 7, Axios, socket.io-client, lucide-react | `app/` | Todas as telas do design implementadas |
| Design | HTML de referência + tokens | `design/` | Referência, não rodar |

Requisitos originais: `Requisitos_Leilao_Hackathon.pdf` (é imagem; os códigos RFxx citados no
código e no design vêm dele).

### Arquitetura (decisão da equipe)

```
navegador ──HTTP (cookies httpOnly)──▶ API Express ──▶ PostgreSQL (histórico permanente; recebe a disputa no fim)
    │                                     │
    └──────Socket.IO (mesmo cookie)───────┤──▶ Redis (a sala Em andamento INTEIRA: estado, todos os lances,
                                          │     idempotência, prazos, presença, sessão, anti-rajada)
                                          └──▶ disco (fotos; nginx serve /uploads)
```

- **Durante a disputa só o Redis é usado.** Cada lance é um script Lua atômico (`RoomState.placeBid`).
  O PostgreSQL só é tocado na abertura (SCHEDULED → RUNNING) e no fechamento.
- **Fechamento** (`Settlement.settle`): sala reivindicada no Redis (RUNNING → CLOSING/CANCELLED), uma
  transação grava todos os lances e o resultado, e só depois a sala é apagada do Redis. Idempotente.
- **Leituras** de leilões Em andamento (REST e snapshot) aplicam o estado do Redis por cima do banco
  (`RoomState.withLive`).
- **Regra de queda:** na subida, todo leilão Agendado/Em andamento com `startsAt <= agora` vira
  **Cancelado** (`AuctionLifecycle.recoverFromCrash()`); salas já decididas antes da queda são gravadas
  normalmente. Desligável em dev com `AUCTION_CANCEL_RUNNING_ON_BOOT=false` (a sala segue no Redis).
- Leilão RUNNING no banco sem sala no Redis (Redis perdeu os dados) é cancelado pelo `reconcile()`.

---

## 2. Como rodar

```bash
# Tudo (dev, com hot reload) — API na 3333, front na 5173
cp .env.example .env                 # opcional; tudo tem default
cp api/.env.example api/.env
cp app/.env.example app/.env         # VITE_API_URL=http://localhost:3333
docker compose up -d                 # postgres, redis, api, app
docker compose exec api npm run db:seed   # contas de demo (senha arremate123), ver README

# Alternativa: front fora do Docker (pare o serviço app antes: docker compose stop app)
cd app && npm install && npm run dev
```

Scripts do front: `npm run dev`, `npm run build` (tsc + vite), `npm run lint`.
Scripts da API: `npm run dev`, `npm test`, `npm run test:unit`, `npm run typecheck` (src + tests),
`npm run db:migrate`, `npm run db:studio`.

Testes da API: precisam do Postgres e do Redis do compose no ar. Usam o banco `leilao_test`
(criado e migrado automaticamente) e o Redis DB 15 — não tocam nos dados de dev. A gravação de fotos é mockada.
E2E: `cd app && npm run test:e2e` (precisa do compose no ar; o globalSetup cria uma sala com `db:seed -- --sala`).

⚠️ Em dev, o `tsx watch` reinicia a API a cada arquivo salvo, e a regra de queda cancela os
leilões Em andamento. Para testar a sala enquanto mexe na API: `AUCTION_CANCEL_RUNNING_ON_BOOT=false`.

Para a demo, use leilões curtos: no `api/.env`, `AUCTION_MIN_LEAD_SECONDS=60` e
`AUCTION_MIN_DURATION_SECONDS=180` (já são os defaults ou próximos disso).

### Deploy (produção)

- **A VM tem 1 vCPU e 1 GB de RAM.** Não construir imagens nela nem adicionar serviços sem medir.
- Workflow `.github/workflows/deploy.yml` (push na `main` ou manual): job `build` constrói
  `api/Dockerfile` e `app/Dockerfile` no GitHub e publica no GHCR (tag = commit); job `deploy` entra por
  SSH (`SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_PORT`, `DEPLOY_PATH`, `PUBLIC_URL`), faz login
  temporário no GHCR e roda `deploy.sh` com `API_IMAGE`/`APP_IMAGE`.
- `deploy.sh`: `git reset --hard`, cria o `.env` na primeira vez, **pull** das imagens (`API_IMAGE`/`APP_IMAGE`
  obrigatórias; nunca constrói na VM) e `up -d --no-build`. O swap é configurado à mão na VM.
- `compose.prod.yml`: Postgres ajustado para pouca RAM (shared_buffers 64 MB, 20 conexões), Redis com
  AOF (`everysec`, volume `redis_data` — os lances da disputa só existem lá), limites de memória por serviço, logs com rotação. O nginx
  (**8080**) serve a SPA, `/uploads` (volume compartilhado, só leitura) e faz proxy de `/user`, `/auth`,
  `/item`, `/auction`, `/health` e `/socket.io`. A API confia no `X-Forwarded-For` (`TRUST_PROXY`) para o
  rate limit ver o IP real.
- Medido localmente com a stack de produção: ≈ 115 MB em repouso (api 75, postgres 23, redis 9, nginx 7).

---

## 3. Modelo de dados (Prisma — `api/src/prisma/schema.prisma`)

- **User**: `id, email (único), name, password (bcrypt), sessionVersion, refreshTokenHash, refreshTokenExpires, deletedAt`.
  Excluir conta = anonimizar (nome “Conta excluída”, e-mail liberado, sessões derrubadas); o histórico fica.
- **Item**: `id, ownerId, name, description, category, images[]` (chaves `items/<id>/<uuid>.<ext>` relativas a `UPLOADS_DIR`; a API devolve URLs públicas). A ordem é a ordem de exibição (a primeira é a capa).
- **Auction** (um *lote*): `id, ownerId, title, description, status, startingPriceCents, bidCount,
  startsAt, originalEndsAt, endsAt, winnerId, finalPriceCents`.
  - Em andamento: no banco ficam como na abertura (`bidCount` 0, `winnerId` null); o líder e o preço atuais
    estão no Redis e as respostas da API já os trazem. Depois: vencedor e valor pago.
- **AuctionItem**: liga leilão ↔ item com `position` (o primeiro é a capa). Um leilão pode ter até 10 itens.
- **Bid**: `id, auctionId, bidderId, amountCents, idempotencyKey, createdAt`. Só lances **aceitos**, gravados
  no fechamento a partir da lista do Redis (o `id` é gerado no lance). `@@unique([bidderId, idempotencyKey])`
  + `skipDuplicates` tornam o settle repetível.
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
| GET | `/user/search` | público | RF22: `?q=` comitentes (quem tem ≥ 1 leilão) por pedaço do nome, sem acento; `{ users: { id, name, createdAt, auctionCount }[] }` |
| GET | `/user/:id` | público | perfil público (sem e-mail) |
| PUT | `/user` | login | `{ name }` |
| DELETE | `/user` | login | anonimiza a conta e limpa os cookies; 422 se tiver leilão próprio aberto ou liderar uma disputa |
| POST | `/auth/login` | público | seta cookies, devolve `{ user }` |
| POST | `/auth/refresh` | cookie | rotaciona tokens |
| POST | `/auth/logout` | login | invalida a sessão (`sessionVersion++`) |
| GET | `/health` | público | `{ database, redis }` up/down (503 se algum cair) |

Login e cadastro têm rate limit por IP no Redis (`AUTH_RATE_LIMIT_MAX` por `AUTH_RATE_LIMIT_WINDOW_SECONDS`, 429).

### Itens (multipart, fotos no campo `images`, 3–8, JPG/PNG/WebP, ≤ 5 MB, conteúdo verificado)
| Método | Rota | Notas |
|---|---|---|
| GET | `/item/categories` | público |
| GET | `/item` | meus itens + leilões de que participaram |
| GET | `/item/:id` | só do dono |
| POST | `/item` | cria item com fotos |
| PUT | `/item/:id` | `keepImages` (JSON) = ordem final: URLs/chaves atuais e `"new:N"` para a N-ésima foto enviada; sem ele, fotos novas substituem todas. Total 3–8. Bloqueado se o item está em leilão rodando ou a < 30 min do início |
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
`SCHEDULED → RUNNING` quando chega `startsAt` (UPDATE condicional + cria a sala no Redis); salas de
`rooms:deadlines` cujo término passou são reivindicadas (`CLAIM_CLOSE`) e gravadas pelo `Settlement`
(`SOLD` com lances, `ENDED_NO_BIDS` sem). A cada 5 rodadas, `reconcile()`. Emite `auction:status`.

### Socket.IO (`api/src/socket/`, contrato em `contract.ts`)
- Handshake exige o cookie `accessToken` (erro `UNAUTHORIZED`). Cada lance reconfere a sessão.
- `auction:join`, `auction:leave`, `auction:role`, `auction:bid` — contrato completo na seção 6.
- Servidor emite `auction:status`, `auction:bid` (depois de gravado na sala, no Redis) e `auction:presence`.
- Adapter do Redis: com várias instâncias da API, o emit chega a todas.

### Regras de negócio já implementadas
- **Incremento mínimo** (`api/src/utils/money.ts`): até R$ 99,99 → R$ 1; até 499,99 → 5; até 999,99 → 10;
  até 4.999,99 → 50; até 24.999,99 → 100; acima → 500. Primeiro lance pode ser igual ao preço inicial.
- **Edição (RF23)**: Agendado > 30 min antes = tudo; Agendado ≤ 30 min = nada; Em andamento = só
  acrescentar texto; Finalizado = nada.
- **Cancelamento (RF08)**: agendado ou em andamento **sem lances**; nunca apaga.
- **Relistagem (RF28)**: item não pode estar em dois leilões abertos nem ter sido vendido.
- Locks `SELECT … FOR UPDATE` em item/leilão para criação/edição/cancelamento de agendados.
- **Lance, fechamento e cancelamento de leilão Em andamento** são scripts Lua na mesma sala do Redis:
  o Redis os executa um por vez, então nunca se atropelam.
- **Lance**: idempotência (`room:{id}:idem`, gravada no mesmo script que aceita), anti-rajada
  (`BID_THROTTLE_MS`), sessão conferida no Redis (`session:<id>`). Fluxo completo em `api/README.md` seção 3.

---

## 5. Front-end (`app/`)

Implementado a partir de `design/DESIGN.md` + `design/telas/*.html` + `design/tokens.css`
(copiado para `app/src/styles/tokens.css`). Nome provisório da marca: **Arremate**.

| Rota | Página | Acesso | API usada |
|---|---|---|---|
| `/entrar` (`?modo=cadastro&next=`) | `pages/Login.tsx` | público | `POST /user`, `POST /auth/login` |
| `/` | `pages/Listagem.tsx` | público | `GET /auction/all` (abertos por padrão; chips de estado `?estado=`; `sort=live` por padrão; busca grande com categorias múltiplas embutidas em `components/CategoryPicker`, `?categoria=A,B`; “carregar mais”) |
| `/leiloes/:id` | `pages/Detalhe.tsx` | público | `GET /auction/:id` |
| `/leiloes/:id/sala` | `pages/Sala.tsx` | login | Socket.IO (snapshot no join, `auction:bid`, presença) + `GET /auction/:id`, `GET /auction/:id/bids?limit=100` (completa o ranking) — destaque de tempo/valor atual, faixa com os itens do lote e ranking do maior para o menor lance |
| `/anunciar` | `pages/Inventario.tsx` | login | `GET /item` — passo 1: inventário; escolhe item(ns) ou vai cadastrar um novo |
| `/anunciar/novo-item` | `pages/ItemForm.tsx` | login | `POST /item` — cadastra e segue para o leilão com ele |
| `/itens/:id/editar` (`?voltar=`) | `pages/ItemForm.tsx` | login | `GET`/`PUT`/`DELETE /item/:id` — dados, fotos (reordenar, capa, remover, adicionar) |
| `/anunciar/leilao?itens=a,b` (`?relistar=:id`) | `pages/Criar.tsx` | login | `GET /item`, `POST /auction` — passo 2: dados do leilão; setas reordenam os itens do lote (o primeiro é a capa) |
| `/meus-leiloes` | `pages/MeusLeiloes.tsx` | login | `GET /auction/my`, `PUT`/`DELETE /auction/:id` |
| `/participacoes` | `pages/Participacoes.tsx` | login | `GET /auction/participations` |
| `/comitentes` (`?q=`) | `pages/Comitentes.tsx` | público | `GET /user/search` (RF22) |
| `/comitentes/:id` | `pages/Perfil.tsx` | público | `GET /user/:id`, `GET /auction/all?ownerId=`; busca de comitentes no topo |
| `/conta` | `pages/Conta.tsx` | login | `PUT /user` (nome), `DELETE /user` (excluir) |

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
- [x] Handler `auction:bid` (script Lua atômico no Redis, prorrogação, broadcast depois de gravado na sala).
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
- [x] Limite de fotos alinhado: 3–8 na API, no front e no design.
- [x] Mensagens de erro REST em português (inclusive as padrão do Zod, `config/zod.ts`).
- [x] Busca de comitentes `GET /user/search` e busca de leilões sem acentos (`unaccent`, migration
      `20261114230000_search_and_account`).
- [x] Excluir conta = anonimizar (`deletedAt`); edição de item com `keepImages` (ordem/capa).
- [x] Seed de demonstração (`npm run db:seed`, `--sala`, `--reset`) — RNF04.
- [x] Fotos no disco (multer grava no `.tmp` e o service renomeia; nada de foto inteira em RAM).
- [x] `trust proxy` (rate limit de login via nginx usava o IP do nginx para todo mundo).
- [x] **Sala só no Redis**: lances não tocam o PostgreSQL durante a disputa; settle no fechamento.
- [ ] **Regra de queda × RN01**: cancelar no boot um leilão Em andamento **com lances** contraria
      RN01 (“Em andamento com lance só pode terminar Vendido”) e a transição 3 (“Em andamento → Cancelado
      só sem lance”). RF18 pede que, ao voltar, o que passou do término feche normalmente. Decidir com a
      equipe; a alternativa é `AUCTION_CANCEL_RUNNING_ON_BOOT=false` (a sala é recriada a partir do banco).
- [ ] `sort=price` ordena em memória (ok para centenas de leilões); com muito volume, criar coluna de preço atual.
- [ ] Várias instâncias da API: a regra de queda roda em cada subida e cancelaria salas atendidas
      por outra instância. Para escalar horizontalmente, trocar por um "heartbeat" do cluster no Redis
      (só cancela se nenhuma instância estava viva). Os relógios das instâncias precisam de NTP.
- [ ] `sort=ends` usa o `endsAt` do banco, que não tem as prorrogações da sala (diferença de minutos).

### Front-end
- [x] Sala ligada ao `auction:bid` real, snapshot no join, papel preservado ao reconectar.
- [x] Respostas genéricas removidas; participações e lances usam as rotas reais.
- [x] Listagem ordena no servidor.
- [x] Editar item (`/itens/:id/editar`), a partir do inventário e do “Editar” de Meus leilões.
- [x] Página de conta (`/conta`: trocar nome, excluir conta).
- [x] Busca de comitentes (`/comitentes` + caixa no topo do perfil) — RF22.
- [x] Reordenar fotos/escolher capa (`components/PhotoManager`) e reordenar itens do lote no Criar.
- [x] Filtro por estado na listagem (RF21) e faixa com os itens do lote na Sala.
- [x] E2E da jornada de lance (Playwright, `app/e2e/`).
- [ ] Testes de componente (Vitest + Testing Library).
- [x] Serviço `app` no `compose.yml` (Vite dev em http://localhost:5173, porta via `APP_PORT`).

### Infra / entrega
- [x] `.env` de produção, segredos e deploy automático (GitHub Actions + `deploy.sh` + `compose.prod.yml`).
- [x] Fotos no disco da VM (RF07 foi riscado); MinIO removido de vez (sem importação).
- [x] Imagens construídas no GitHub Actions (GHCR); VM só faz pull. Limites de memória, logs com rotação.
- [ ] TLS/domínio (bônus 7.2): pôr um proxy com HTTPS (ex.: Caddy) na frente do nginx.
- [ ] Preencher a URL pública no README.
- [x] README raiz com instruções de dev e deploy.

---

## Divergências conhecidas
1. ~~Queda do serviço~~ — resolvido: a API cancela, ao subir, os leilões cuja janela já começou.
2. **Lote vs. item**: o design pressupõe 1 item por leilão; a API modela *lotes* (vários itens). O front
   suporta os dois (galeria junta as fotos de todos os itens; capa = primeiro item).
3. **Limites**: duração mínima design 3 min / API 60 s (env). Fotos alinhadas em 3–8.
4. A sala voltou a ser só Redis (decisão da equipe), mantendo o contrato de eventos que o front consome
   (`auction:bid`, `auction:status`, snapshot no join). Chaves antigas `room:<id>:*` (sem `{}`) e
   `bid:idem:*` no Redis de dev podem ser apagadas.

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
