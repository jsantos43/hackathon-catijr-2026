/**
 * Dados de demonstração (RNF04): 2 comitentes, 3 compradores e leilões em todos os estados,
 * inclusive lotes com vários itens, um leilão Em andamento com disputa e um que abre em
 * 2 minutos (para a banca ver a abertura automática).
 *
 *   npm run db:seed            # dev (tsx)
 *   npm run db:seed -- --reset # apaga TUDO antes (recusa em produção sem SEED_ALLOW_RESET=true)
 *   npm run db:seed -- --sala  # só cria um lote novo Em andamento (10 min), sem lances, da Marina.
 *                              # Bom para a demo e para o teste e2e. A última linha é o id dele.
 *   node dist/scripts/seed.js  # produção (dentro do container da API)
 *
 * Todas as contas usam a senha DEMO_PASSWORD. As fotos são PNGs gerados aqui mesmo, então o
 * seed não depende de arquivo nenhum além do código.
 */
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { env } from '../config/env.js';
import { AuctionStatus, type Category } from '../generated/prisma/enums.js';
import { db } from '../prisma/db.js';
import { closeRedis } from '../redis/client.js';
import RoomState from '../services/RoomState.js';
import { hash } from '../utils/hash.js';
import { bidIncrementCents } from '../utils/money.js';
import { uploadItemImages } from '../utils/storage.js';

export const DEMO_PASSWORD = 'arremate123';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// ---------------------------------------------------------------------------------------------
// PNG mínimo (RGB, sem filtro) com degradê e uma forma no meio, para cada foto ser diferente.
// ---------------------------------------------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

const makePng = (from: string, to: string, shape: 'circle' | 'square' | 'diamond', width = 640, height = 480) => {
  const [a, b] = [hex(from), hex(to)];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.22;

  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filtro "none"
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const inside =
        shape === 'circle' ? dx * dx + dy * dy < r * r : shape === 'square' ? dx < r && dy < r : dx + dy < r * 1.3;
      const i = row + 1 + x * 3;
      for (let ch = 0; ch < 3; ch++) {
        const base = a[ch]! + (b[ch]! - a[ch]!) * t;
        raw[i + ch] = Math.round(inside ? 255 - (255 - base) * 0.35 : base);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const photos = (from: string, to: string) =>
  (['circle', 'square', 'diamond'] as const).map(
    (shape, i) =>
      ({
        buffer: makePng(from, to, shape),
        originalname: `foto-${i + 1}.png`,
        mimetype: 'image/png',
      }) as Express.Multer.File,
  );

// ---------------------------------------------------------------------------------------------

const USERS = {
  marina: { name: 'Marina Torres', email: 'marina@arremate.dev' }, // comitente principal
  rafael: { name: 'Rafael Lima', email: 'rafael@arremate.dev' }, // segundo comitente
  ana: { name: 'Ana Souza', email: 'ana@arremate.dev' }, // compradores
  bruno: { name: 'Bruno Alves', email: 'bruno@arremate.dev' },
  carla: { name: 'Carla Mendes', email: 'carla@arremate.dev' },
} as const;
type Who = keyof typeof USERS;

const ITEMS: { key: string; owner: Who; name: string; category: Category; description: string; colors: [string, string] }[] = [
  { key: 'camera', owner: 'marina', name: 'Câmera analógica Pentax K1000', category: 'ELECTRONICS', description: 'Câmera 35 mm revisada, fotômetro funcionando, com lente 50 mm f/2.', colors: ['#1f2937', '#f59e0b'] },
  { key: 'lente', owner: 'marina', name: 'Lente 28 mm f/2.8', category: 'ELECTRONICS', description: 'Grande-angular baioneta K, vidro sem fungos nem riscos.', colors: ['#111827', '#60a5fa'] },
  { key: 'bolsa', owner: 'marina', name: 'Bolsa de couro para câmera', category: 'FASHION', description: 'Bolsa de couro legítimo, cabe corpo e duas lentes.', colors: ['#78350f', '#fbbf24'] },
  { key: 'vinil', owner: 'marina', name: 'Coleção de discos de vinil MPB', category: 'COLLECTIBLES', description: 'Doze discos dos anos 70, capas originais, bem conservados.', colors: ['#7c2d12', '#fb7185'] },
  { key: 'luminaria', owner: 'marina', name: 'Luminária de mesa retrô', category: 'HOME', description: 'Luminária articulada de metal, fiação nova, bivolt.', colors: ['#065f46', '#a7f3d0'] },
  { key: 'quadro', owner: 'marina', name: 'Quadro a óleo de paisagem', category: 'ART', description: 'Óleo sobre tela 60x40 cm, moldura de madeira, assinado.', colors: ['#1e3a8a', '#fde68a'] },
  { key: 'bike', owner: 'rafael', name: 'Bicicleta speed aro 700', category: 'SPORTS', description: 'Quadro de alumínio tamanho 54, grupo Shimano Sora, pneus novos.', colors: ['#991b1b', '#fca5a5'] },
  { key: 'livros', owner: 'rafael', name: 'Box de livros de ficção científica', category: 'BOOKS', description: 'Sete volumes em capa dura, edição de colecionador.', colors: ['#312e81', '#c4b5fd'] },
  { key: 'relogio', owner: 'rafael', name: 'Relógio de bolso antigo', category: 'COLLECTIBLES', description: 'Relógio de bolso suíço com corrente, funcionando.', colors: ['#44403c', '#e7e5e4'] },
  { key: 'violao', owner: 'rafael', name: 'Violão de cordas de nylon', category: 'OTHER', description: 'Tampo de cedro, regulado, com capa acolchoada.', colors: ['#92400e', '#fed7aa'] },
];

type AuctionSpec = {
  owner: Who;
  title: string;
  description: string;
  items: string[];
  startingPriceCents: number;
  status: AuctionStatus;
  startsAt: Date;
  endsAt: Date;
  bidders?: Who[]; // ordem dos lances (cada um cobre o mínimo vigente)
};

/** Lances sequenciais sempre no lance mínimo vigente, como a sala faria. */
const buildBids = (startingPriceCents: number, bidders: Who[], startsAt: Date, endsAt: Date) => {
  const span = Math.min(endsAt.getTime(), Date.now()) - startsAt.getTime();
  let price: number | null = null;
  return bidders.map((who, i) => {
    const amountCents: number = price === null ? startingPriceCents : price + bidIncrementCents(price);
    price = amountCents;
    const createdAt = new Date(startsAt.getTime() + (span * (i + 1)) / (bidders.length + 1));
    return { who, amountCents, createdAt };
  });
};

const reset = async () => {
  if (env.isProd && process.env['SEED_ALLOW_RESET'] !== 'true') {
    throw new Error('--reset em produção apaga tudo; defina SEED_ALLOW_RESET=true se for isso mesmo.');
  }
  await db.$executeRawUnsafe('TRUNCATE "Bid", "AuctionItem", "Auction", "Item", "User" CASCADE');
  console.log('Banco limpo.');
};

/** Cria as contas de demonstração que ainda não existem e devolve os ids de todas. */
const ensureUsers = async () => {
  const password = await hash(DEMO_PASSWORD);
  const now = Date.now();
  const ids = {} as Record<Who, string>;

  for (const [who, data] of Object.entries(USERS) as [Who, (typeof USERS)[Who]][]) {
    const user = await db.user.upsert({
      where: { email: data.email },
      update: {},
      create: {
        ...data,
        password,
        // Contas "antigas" para o perfil público mostrar datas de entrada diferentes.
        createdAt: new Date(now - (who === 'marina' ? 400 : who === 'rafael' ? 120 : 30) * DAY),
      },
    });
    ids[who] = user.id;
  }
  return ids;
};

const createItem = async (item: (typeof ITEMS)[number], ids: Record<Who, string>) => {
  const id = randomUUID();
  const images = await uploadItemImages(id, photos(...item.colors));
  await db.item.create({
    data: {
      id,
      ownerId: ids[item.owner],
      name: item.name,
      description: item.description,
      category: item.category,
      images,
    },
  });
  return id;
};

/** --sala: um lote novo Em andamento, sem lances, para a demo ou para o e2e. */
const createFreshRoom = async () => {
  const ids = await ensureUsers();
  const stamp = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const lot = ITEMS.filter((i) => ['camera', 'lente', 'bolsa'].includes(i.key));
  const itemIds = [];
  for (const item of lot) itemIds.push(await createItem(item, ids));

  const now = Date.now();
  const endsAt = new Date(now + 10 * MIN);
  const auction = await db.auction.create({
    data: {
      ownerId: ids.marina,
      title: `Kit fotógrafo (sala ${stamp})`,
      description: 'Lote criado pelo seed para demonstração da sala ao vivo.',
      status: AuctionStatus.RUNNING,
      startingPriceCents: 10_000,
      startsAt: new Date(now - 5_000),
      originalEndsAt: endsAt,
      endsAt,
      items: { create: itemIds.map((itemId, position) => ({ itemId, position })) },
    },
  });
  await RoomState.open(auction);
  console.log(`Sala criada: "${auction.title}", termina em 10 min. Senha das contas: ${DEMO_PASSWORD}`);
  console.log(auction.id);
};

const main = async () => {
  if (process.argv.includes('--sala')) return createFreshRoom();
  if (process.argv.includes('--reset')) await reset();

  const existing = await db.user.findUnique({ where: { email: USERS.marina.email } });
  if (existing) {
    console.log('Os dados de demonstração já existem (use --reset para recriar). Nada foi feito.');
    return;
  }

  const now = Date.now();
  const ids = await ensureUsers();

  const itemIds: Record<string, string> = {};
  for (const item of ITEMS) itemIds[item.key] = await createItem(item, ids);

  const auctions: AuctionSpec[] = [
    {
      owner: 'marina',
      title: 'Kit fotógrafo: câmera + lente + bolsa',
      description: 'Lote completo para começar na fotografia analógica. Os três itens vão juntos.',
      items: ['camera', 'lente', 'bolsa'],
      startingPriceCents: 80_000,
      status: AuctionStatus.RUNNING,
      startsAt: new Date(now - 5 * MIN),
      endsAt: new Date(now + 20 * MIN),
      bidders: ['ana', 'bruno', 'ana', 'carla'],
    },
    {
      owner: 'rafael',
      title: 'Bicicleta speed aro 700',
      description: 'Pronta para pedalar. Retirada em São Paulo.',
      items: ['bike'],
      startingPriceCents: 150_000,
      status: AuctionStatus.SCHEDULED,
      startsAt: new Date(now + 2 * MIN),
      endsAt: new Date(now + 7 * MIN),
    },
    {
      owner: 'marina',
      title: 'Quadro a óleo de paisagem',
      description: 'Obra única, acompanha certificado do artista.',
      items: ['quadro'],
      startingPriceCents: 45_000,
      status: AuctionStatus.SCHEDULED,
      startsAt: new Date(now + 1 * DAY),
      endsAt: new Date(now + 1 * DAY + 30 * MIN),
    },
    {
      owner: 'marina',
      title: 'Coleção de discos de vinil MPB',
      description: 'Doze discos clássicos.',
      items: ['vinil'],
      startingPriceCents: 30_000,
      status: AuctionStatus.SOLD,
      startsAt: new Date(now - 3 * DAY),
      endsAt: new Date(now - 3 * DAY + 30 * MIN),
      bidders: ['bruno', 'carla', 'bruno'],
    },
    {
      owner: 'rafael',
      title: 'Box de livros de ficção científica',
      description: 'Sete volumes, capa dura.',
      items: ['livros'],
      startingPriceCents: 20_000,
      status: AuctionStatus.ENDED_NO_BIDS,
      startsAt: new Date(now - 2 * DAY),
      endsAt: new Date(now - 2 * DAY + 20 * MIN),
    },
    {
      owner: 'rafael',
      title: 'Relógio de bolso + violão',
      description: 'Lote cancelado pelo comitente antes de começar.',
      items: ['relogio', 'violao'],
      startingPriceCents: 60_000,
      status: AuctionStatus.CANCELLED,
      startsAt: new Date(now - 1 * DAY),
      endsAt: new Date(now - 1 * DAY + 20 * MIN),
    },
  ];

  for (const spec of auctions) {
    const bids = buildBids(spec.startingPriceCents, spec.bidders ?? [], spec.startsAt, spec.endsAt);
    const last = bids.at(-1);

    const auction = await db.auction.create({
      data: {
        ownerId: ids[spec.owner],
        title: spec.title,
        description: spec.description,
        status: spec.status,
        startingPriceCents: spec.startingPriceCents,
        bidCount: bids.length,
        startsAt: spec.startsAt,
        originalEndsAt: spec.endsAt,
        endsAt: spec.endsAt,
        winnerId: last ? ids[last.who] : null,
        finalPriceCents: last?.amountCents ?? null,
        items: { create: spec.items.map((key, position) => ({ itemId: itemIds[key]!, position })) },
        bids: {
          create: bids.map((b) => ({
            bidderId: ids[b.who],
            amountCents: b.amountCents,
            idempotencyKey: randomUUID(),
            createdAt: b.createdAt,
          })),
        },
      },
    });

    // A sala Em andamento precisa do estado no Redis, como o job deixaria ao abrir.
    if (auction.status === AuctionStatus.RUNNING) await RoomState.open(auction);
  }

  console.log(`Dados de demonstração criados. Senha de todas as contas: ${DEMO_PASSWORD}`);
  for (const [who, u] of Object.entries(USERS)) {
    const role = who === 'marina' || who === 'rafael' ? 'comitente' : 'comprador';
    console.log(`  ${u.email.padEnd(22)} ${u.name} (${role})`);
  }
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    await closeRedis();
  });
