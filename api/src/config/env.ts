import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3333),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  DATABASE_URL: z.url(),

  JWT_SECRET: z.string().min(16, "JWT_SECRET precisa ter pelo menos 16 caracteres"),
  JWT_EXPIRES_IN: z.string().default("2h"),

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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
