# API — Arremate

API do leilão em tempo real: Express 5 + Prisma 7 (PostgreSQL) + Redis + Socket.IO.

```bash
docker compose up -d          # na raiz: postgres, redis, minio, api (porta 3333) e app
npm run dev                   # ou rode a API fora do Docker (pare o serviço api antes)
npm test                      # testes (precisam do postgres e do redis do compose no ar)
npm run typecheck             # src/ e tests/
```

---

## 1. Quem faz o quê

```
navegador ──HTTP (cookies httpOnly)──▶ Express ──▶ PostgreSQL  fonte da verdade: leilões, itens, lances
    │                                   │
    └──────Socket.IO (mesmo cookie)─────┼──▶ Redis       acelerador: estado quente da sala, idempotência,
                                        │                anti-rajada, presença, rate limit, adapter do socket
                                        └──▶ MinIO (S3)  fotos
```

- **PostgreSQL decide.** Todo lance é validado e gravado numa transação com a linha do leilão
  travada (`SELECT … FOR UPDATE`). Se o Redis sumir, nada permanente se perde.
- **Redis acelera.** Recusa na hora lances que com certeza seriam recusados, guarda o resultado
  de cada lance pela chave de idempotência, conta presença e serve de ponte entre instâncias.
- **Socket.IO transmite.** O evento `auction:bid` só sai **depois do COMMIT** no banco.

## 2. Pastas

```
src/
  server.ts            ponto de entrada: bucket → regra de queda → HTTP + socket → job
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
    RoomState.ts         estado quente da sala no Redis
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
  3. a sessão ainda vale? (logout derruba lances) ..................... UNAUTHORIZED
  └─▶ services/Bid.place()
       4. mesma idempotencyKey já processada? → devolve o resultado original (Redis, depois banco)
       5. anti-rajada: SET bid:throttle:<user> NX PX 500 ................ RATE_LIMITED
       6. pré-validação no Redis (comitente? abaixo do mínimo?) ........ IS_OWNER / BID_TOO_LOW
       7. TRANSAÇÃO no PostgreSQL
            SELECT … FROM "Auction" WHERE id = $1 FOR UPDATE   ← lances do mesmo leilão fazem fila aqui
            RUNNING e antes do endsAt? ............................... AUCTION_NOT_RUNNING
            autor ≠ comitente? autor ≠ líder? ........................ IS_OWNER / ALREADY_LEADER
            valor ≥ mínimo vigente? .................................. BID_TOO_LOW
            prorrogação (RF15) → INSERT "Bid" → UPDATE "Auction"
          COMMIT
       8. atualiza room:<id>:state no Redis e guarda o resultado pela chave
  9. ack para quem deu o lance + emit('auction:bid') para a sala inteira
```

Por que a pré-validação do Redis é segura mesmo se ele estiver um pouco atrasado: o comitente
nunca muda e o lance mínimo só sobe. Então "abaixo de um mínimo antigo" é sempre "abaixo do
mínimo atual". O resto ("já é o líder", "já encerrou") pode mudar nos dois sentidos, e quem
decide é o banco.

**Prorrogação (RF15):** lance com menos de 2 min no relógio leva o término para 2 min depois
do lance, limitado a `originalEndsAt + 30 min` (`utils/extension.ts`).

**Incremento mínimo (`utils/money.ts`):** até R$ 99,99 → R$ 1; até 499,99 → 5; até 999,99 → 10;
até 4.999,99 → 50; até 24.999,99 → 100; acima → 500. O primeiro lance pode ser igual ao preço inicial.

## 4. Ciclo de vida do leilão

`jobs/AuctionLifecycle.ts`, a cada `AUCTION_TICK_MS`:

| De | Para | Quando | Efeito |
|---|---|---|---|
| SCHEDULED | RUNNING | `startsAt` chegou | cria `room:<id>:state`, emite `auction:status` |
| RUNNING | SOLD / ENDED_NO_BIDS | `endsAt` passou | apaga o estado da sala, emite `auction:status` |
| SCHEDULED / RUNNING | CANCELLED | dono cancela sem lances (RF08) | idem |

**Regra de queda (decisão da equipe):** na subida, antes de o job começar, `recoverFromCrash()`
marca como **Cancelados** os leilões que estavam Em andamento (e os agendados cuja janela inteira
passou com a API fora) e limpa a presença do Redis. Em dev, o `tsx watch` reinicia a API a cada
arquivo salvo; use `AUCTION_CANCEL_RUNNING_ON_BOOT=false` no `api/.env` se isso atrapalhar.

## 5. Chaves do Redis (`src/redis/keys.ts`)

| Chave | Tipo | Conteúdo |
|---|---|---|
| `room:<auctionId>:state` | HASH | preço, líder, mínimo, nº de lances, término, comitente |
| `room:<auctionId>:presence` | HASH | `socketId → "userId\|role"` |
| `bid:idem:<userId>:<key>` | STRING | resultado JSON do lance (TTL `BID_IDEMPOTENCY_TTL_SECONDS`) |
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
`tests/globalSetup.ts`) e o índice 15 do Redis, e apagam tudo antes de cada teste. O MinIO é
substituído por um mock (`tests/setup.ts`). Para apontar para outro lugar: `TEST_DATABASE_URL`
e `TEST_REDIS_URL`.

O que está coberto: regras de cada recusa de lance, idempotência (inclusive sem Redis),
anti-rajada, prorrogação, **lances simultâneos** (só um vence com o mesmo valor; estado final
coerente), abertura/fechamento pelo relógio, regra de queda, cancelamento/edição, ordenação,
rate limit, e o Socket.IO ponta a ponta (handshake, snapshot, broadcast, presença, logout).
