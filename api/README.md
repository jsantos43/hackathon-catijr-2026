# API — Arremate

API do leilão em tempo real: Express 5 + Prisma 7 (PostgreSQL) + Redis + Socket.IO.

```bash
docker compose up -d          # na raiz: postgres, redis, api (porta 3333) e app
npm run dev                   # ou rode a API fora do Docker (pare o serviço api antes)
npm test                      # testes (precisam do postgres e do redis do compose no ar)
npm run typecheck             # src/ e tests/
npm run db:seed               # dados de demonstração (-- --sala: lote novo Em andamento; -- --reset: recria tudo)
```

---

## 1. Quem faz o quê

```
navegador ──HTTP (cookies httpOnly)──▶ Express ──▶ PostgreSQL  histórico: leilões, itens, lances e resultado
    │                                   │                      (só recebe a disputa quando ela termina)
    └──────Socket.IO (mesmo cookie)─────┼──▶ Redis       a sala Em andamento INTEIRA: estado, todos os
                                        │                lances, idempotência; presença, rate limit, adapter
                                        └──▶ disco       fotos (UPLOADS_DIR; o nginx serve em produção)
```

- **Durante a disputa só o Redis é usado.** Cada lance é um script Lua atômico na sala
  (`services/RoomState.ts`): valida, aplica e guarda. Nenhum lance toca o PostgreSQL.
- **No fim, o PostgreSQL recebe tudo de uma vez** (`services/Settlement.ts`): todos os lances e o
  resultado numa transação; depois do COMMIT a sala some do Redis.
- **Socket.IO transmite.** O evento `auction:bid` sai depois de o lance estar gravado na sala.
- **Redis com AOF** (fsync a cada segundo): se só o Redis reiniciar, as salas voltam como estavam.

## 2. Pastas

```
src/
  server.ts            ponto de entrada: pasta de fotos → regra de queda → HTTP + socket → job
  app.ts               o Express (sem listen); os testes usam direto
  config/env.ts        todas as variáveis de ambiente, validadas com zod
  prisma/              schema.prisma, migrations e o cliente (db.ts)
  redis/               cliente (client.ts) e o nome de TODAS as chaves (keys.ts)

  routes/              URL → middlewares → controller (só ligação, sem regra)
  middlewares/         classes: Auth, Validate, Upload, RateLimit, ErrorHandler
  controllers/         classes: lê a requisição, chama o service, monta a resposta HTTP
  services/            classes com as regras de negócio (não conhecem Express)
    Auction.ts           criar, editar (RF23), cancelar (RF08), listar
    Bid.ts               dar lance (RF10–RF15), últimos lances, participações (RF27)
    RoomState.ts         a sala Em andamento no Redis (scripts Lua: lance, fechar, cancelar)
    Settlement.ts        fechamento: grava a sala no PostgreSQL e apaga do Redis
    SessionCache.ts      sessionVersion no Redis (cada lance reconfere a sessão)
    Presence.ts          participantes/espectadores no Redis (RF09)
    Auth.ts, User.ts, Item.ts
  views/               formato que a API devolve: selects do Prisma + serialização
  schemas/             validação de entrada (zod) de REST e socket

  socket/              tempo real
    index.ts             monta o Socket.IO (CORS, adapter Redis, auth, handlers)
    contract.ts          nomes e formatos de TODOS os eventos (o front espelha isto)
    RoomEmitter.ts       único lugar que envia eventos para as salas
    middlewares/SocketAuth.ts
    handlers/RoomHandler.ts   auction:join / leave / role / disconnecting
    handlers/BidHandler.ts    auction:bid

  jobs/AuctionLifecycle.ts   abre/fecha leilões pelo relógio + regra de queda
  errors/              classes de erro HTTP (cada uma com status e código)
  utils/               funções puras: dinheiro, prorrogação, nome curto, hash, storage...

tests/
  unit/                funções puras, sem banco
  integration/         Postgres + Redis de verdade (banco leilao_test, Redis DB 15)
  helpers/factories.ts cria usuários, itens, leilões e cookies de sessão
```

**Regra de ouro das camadas:** `routes → middlewares → controllers → services → prisma/redis`.
Um service nunca recebe `req`/`res`; um controller nunca escreve SQL. Para avisar a sala, services
e jobs chamam o `RoomEmitter`, sem conhecer o Socket.IO.

Padrão de classe usado em toda a API (controllers, services, middlewares, handlers):

```ts
class Bid {
  static async participations(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Unauthorized();
      const participations = await Service.listParticipations(req.user.id);
      return res.status(200).json({ success: true, participations });
    } catch (err) {
      return next(err); // o ErrorHandler transforma em { success: false, error, message, details }
    }
  }
}
```

## 3. A vida de um lance

```
navegador ── emit('auction:bid', { auctionId, amountCents, idempotencyKey }) ──▶ BidHandler
  1. zod valida o payload ............................................ INVALID_PAYLOAD
  2. o socket está na sala? ........................................... NOT_IN_ROOM
  3. a sessão ainda vale? (session:<user> no Redis) ................... UNAUTHORIZED
  └─▶ services/Bid.place()
       4. HGET room:{id}:idem "<user>:<key>" → já processado? devolve o original (duplicate)
       5. sala não existe no Redis? → reenvio de leilão já gravado (banco) ou AUCTION_NOT_RUNNING
       6. anti-rajada: SET bid:throttle:<user> NX PX 500 ................ RATE_LIMITED
       7. SCRIPT LUA (atômico — o Redis executa um script por vez)
            idempotência de novo (o duplo clique simultâneo cai aqui)
            status RUNNING e agora < endsAt? ......................... AUCTION_NOT_RUNNING
            autor ≠ comitente? autor ≠ líder? ........................ IS_OWNER / ALREADY_LEADER
            valor ≥ mínimo vigente? .................................. BID_TOO_LOW
            prorrogação (RF15) → HSET state · RPUSH bids · HSET idem · HSET bidders
       8. ZADD GT rooms:deadlines (novo término) · SADD user:<id>:rooms
  9. ack para quem deu o lance + emit('auction:bid') para a sala inteira
```

Por que não há condição de corrida: todas as leituras e escritas que decidem um lance acontecem
dentro do mesmo script. Dois lances simultâneos viram dois scripts em fila; o segundo já enxerga
o preço, o líder e o término deixados pelo primeiro. As chaves de uma sala usam a hash tag
`{auctionId}`, então o script continua válido num Redis Cluster (todas no mesmo nó).

**Duplo clique:** o navegador manda a mesma `idempotencyKey` no reenvio; o resultado fica em
`room:{id}:idem` dentro do mesmo script que aceita o lance, então o segundo envio recebe o
primeiro resultado (ou, se chegar no mesmo instante, cai na anti-rajada). Cliques com chaves
diferentes caem em `ALREADY_LEADER`. Depois do fechamento, o índice único
`(bidderId, idempotencyKey)` da tabela `Bid` faz o mesmo papel.

**Prorrogação (RF15):** lance com menos de 2 min no relógio leva o término para 2 min depois
do lance, limitado a `originalEndsAt + 30 min` (no script; `utils/extension.ts` é a mesma regra em TS).

**Incremento mínimo (`utils/money.ts`):** até R$ 99,99 → R$ 1; até 499,99 → 5; até 999,99 → 10;
até 4.999,99 → 50; até 24.999,99 → 100; acima → 500. O primeiro lance pode ser igual ao preço
inicial. A tabela é traduzida para Lua a partir do mesmo array, então não há duas fontes.

## 4. Ciclo de vida do leilão

`jobs/AuctionLifecycle.ts`, a cada `AUCTION_TICK_MS`:

| De | Para | Quando | Efeito |
|---|---|---|---|
| SCHEDULED | RUNNING | `startsAt` chegou | UPDATE condicional no banco; cria a sala no Redis; `auction:status` |
| RUNNING | SOLD / ENDED_NO_BIDS | término (com prorrogações) passou | script `CLAIM_CLOSE` (RUNNING→CLOSING no Redis) → `Settlement.settle` grava lances + resultado → apaga a sala |
| SCHEDULED | CANCELLED | dono cancela | linha travada no banco |
| RUNNING | CANCELLED | dono cancela sem lances (RF08) | script `CANCEL` no Redis (atômico com os lances) → `Settlement.settle` |

O settle é idempotente: trava curta por sala, `createMany(skipDuplicates)` e
`UPDATE … WHERE status = 'RUNNING'`; a sala só é apagada depois do COMMIT. Se o processo cair no
meio, a sala continua CLOSING/CANCELLED no Redis e a próxima rodada repete.

A cada 5 rodadas o `reconcile()` cancela leilões RUNNING no banco cuja sala sumiu do Redis (sem
os lances não há vencedor) e corrige o índice de prazos.

**Regra de queda:** na subida, antes do job, `recoverFromCrash()`:
1. limpa a presença;
2. grava normalmente as salas que já estavam decididas (CLOSING/CANCELLED) antes da queda;
3. cancela todo leilão Agendado/Em andamento com `startsAt <= agora` — a janela dele começou e o
   serviço caiu (ou estava fora). Os lances que estavam no Redis vão para o histórico, sem vencedor.

Em dev, o `tsx watch` reinicia a API a cada arquivo salvo; com `AUCTION_CANCEL_RUNNING_ON_BOOT=false`
o passo 3 não roda e as salas continuam de onde pararam no Redis.

## 5. Chaves do Redis (`src/redis/keys.ts`)

| Chave | Tipo | Conteúdo |
|---|---|---|
| `room:{id}:state` | HASH | status (RUNNING/CLOSING/CANCELLED), preço, líder, mínimo, nº de lances, término, comitente |
| `room:{id}:bids` | LIST | todos os lances aceitos (JSON), em ordem |
| `room:{id}:idem` | HASH | `"<userId>:<key>" → resultado do lance` |
| `room:{id}:bidders` | HASH | `userId → maior lance` (participações) |
| `room:{id}:settling` | STRING | trava do settle (30 s) |
| `room:{id}:presence` | HASH | `socketId → "userId\|role"` |
| `rooms:deadlines` | ZSET | `auctionId` com score = término (ms) |
| `user:<id>:rooms` | SET | salas abertas em que a pessoa deu lance |
| `session:<userId>` | STRING | `sessionVersion` válida (lance não consulta o banco) |
| `bid:throttle:<userId>` | STRING | existe por `BID_THROTTLE_MS` |
| `ratelimit:<scope>:<ip>` | STRING | contador de login/cadastro na janela |
| `socket.io#…` | pub/sub | canais do `@socket.io/redis-adapter` |

## 6. Rotas e eventos

Tabela completa no [`AGENTS.md`](../AGENTS.md) (seções 4 e 6). Resumo do que é novo:

- `GET /auction/:id/bids?limit=20` — últimos lances (mais recente primeiro).
- `GET /auction/participations` — onde dei lance + `myHighestBidCents` + `situation`.
- `GET /auction/all?sort=ends|starts|price|bids` — ordenação no servidor.
- `GET /health` — banco e Redis no ar?
- Socket: `auction:join` (com snapshot), `auction:role`, `auction:bid`, `auction:presence`.

## 7. Testes

```bash
npm test             # tudo (unitários + integração)
npm run test:unit    # só os que não precisam de banco
npm run test:watch
```

Os testes de integração usam um banco separado (`leilao_test`, criado e migrado sozinho pelo
`tests/globalSetup.ts`) e o índice 15 do Redis, e apagam tudo antes de cada teste. A gravação
de fotos é um mock (`tests/setup.ts`); o multer grava os temporários numa pasta do sistema. Para apontar para outro lugar: `TEST_DATABASE_URL`
e `TEST_REDIS_URL`.

O que está coberto: regras de cada recusa de lance, idempotência e duplo clique (Redis e, depois
do fechamento, banco), nada gravado no banco durante a disputa, settle,
anti-rajada, prorrogação, **lances simultâneos** (só um vence com o mesmo valor; estado final
coerente), abertura/fechamento pelo relógio, regra de queda, cancelamento/edição, ordenação,
rate limit, e o Socket.IO ponta a ponta (handshake, snapshot, broadcast, presença, logout).
