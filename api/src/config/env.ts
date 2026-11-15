import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3333),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  DATABASE_URL: z.url(),

  REDIS_URL: z.url().default("redis://localhost:6379"),

  JWT_SECRET: z.string().min(16, "JWT_SECRET precisa ter pelo menos 16 caracteres"),
  // Em segundos. Access token curto; o refresh token renova a sessão com o uso (RF02).
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),

  // Fotos no disco (decisão da equipe; ver utils/storage.ts). UPLOADS_PUBLIC_URL é o endereço
  // que o navegador usa: em produção o nginx serve /uploads direto do volume.
  UPLOADS_DIR: z.string().min(1).default("./uploads"),
  UPLOADS_PUBLIC_URL: z.url().default("http://localhost:3333/uploads"),

  // Conexões do pool do PostgreSQL. Na VM pequena, poucas bastam (cada uma custa memória no banco).
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Atrás do nginx, de quais proxies confiar no X-Forwarded-For (para o rate limit ver o IP real).
  // Valor do Express: "loopback, uniquelocal" cobre localhost e a rede interna do Docker.
  TRUST_PROXY: z.string().default("loopback, uniquelocal"),

  // RF05/RF06: limites de leilão e fotos. Ficam no .env para a demo poder usar leilões curtos
  // (ex.: AUCTION_MIN_LEAD_SECONDS=60 e AUCTION_MIN_DURATION_SECONDS=180). Tempos em segundos.
  AUCTION_MIN_LEAD_SECONDS: z.coerce.number().int().nonnegative().default(60),
  AUCTION_MAX_LEAD_SECONDS: z.coerce.number().int().positive().default(30 * 24 * 60 * 60),
  AUCTION_MIN_DURATION_SECONDS: z.coerce.number().int().positive().default(60),
  AUCTION_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),
  // RF23: a menos disso do início, um leilão agendado não pode mais ser editado.
  AUCTION_EDIT_LOCK_SECONDS: z.coerce.number().int().nonnegative().default(30 * 60),
  // Intervalo do processo que abre/fecha leilões (RF17/RF18).
  AUCTION_TICK_MS: z.coerce.number().int().positive().default(1000),

  // RF15: lance a menos de 2 min do fim leva o término para 2 min depois do lance,
  // com no máximo 30 min de prorrogação acumulada.
  AUCTION_EXTENSION_WINDOW_SECONDS: z.coerce.number().int().nonnegative().default(2 * 60),
  AUCTION_EXTENSION_SECONDS: z.coerce.number().int().positive().default(2 * 60),
  AUCTION_MAX_EXTENSION_SECONDS: z.coerce.number().int().nonnegative().default(30 * 60),

  // RF09: quantos lances recentes a sala envia no snapshot ao entrar.
  AUCTION_RECENT_BIDS_LIMIT: z.coerce.number().int().positive().default(20),

  // Regra de queda (decisão da equipe): ao subir, leilões que estavam Em andamento viram
  // Cancelados. Dá para desligar em dev (o tsx watch reinicia a API a cada arquivo salvo).
  AUCTION_CANCEL_RUNNING_ON_BOOT: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // Anti-rajada: intervalo mínimo entre dois lances do mesmo usuário (reenvio não conta).
  BID_THROTTLE_MS: z.coerce.number().int().nonnegative().default(500),

  // Rate limit HTTP de login e cadastro (por IP).
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  // Quantos itens um lote (leilão) pode ter.
  AUCTION_MAX_ITEMS: z.coerce.number().int().positive().default(10),

  ITEM_MIN_PHOTOS: z.coerce.number().int().positive().default(3),
  ITEM_MAX_PHOTOS: z.coerce.number().int().positive().default(8),
  PHOTO_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === "production",
  jwtSecret: parsed.data.JWT_SECRET,
  accessTokenTtl: parsed.data.ACCESS_TOKEN_TTL,
  refreshTokenTtl: parsed.data.REFRESH_TOKEN_TTL,
};
