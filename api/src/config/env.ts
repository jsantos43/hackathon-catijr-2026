import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3333),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  DATABASE_URL: z.url(),

  JWT_SECRET: z.string().min(16, "JWT_SECRET precisa ter pelo menos 16 caracteres"),
  // Em segundos. Access token curto; o refresh token renova a sessão com o uso (RF02).
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),

  S3_ENDPOINT: z.url(),
  // URL que o navegador usa para baixar as fotos (no compose, o endpoint interno é http://minio:9000).
  S3_PUBLIC_URL: z.url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

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

  // Quantos itens um lote (leilão) pode ter.
  AUCTION_MAX_ITEMS: z.coerce.number().int().positive().default(10),

  ITEM_MIN_PHOTOS: z.coerce.number().int().positive().default(3),
  ITEM_MAX_PHOTOS: z.coerce.number().int().positive().default(10),
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
