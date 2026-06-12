import "dotenv/config";
import { z } from "zod";

/**
 * Única leitura de process.env na aplicação.
 * Valores padrão refletem o ambiente local/mock — o app sobe out-of-the-box
 * para avaliação (Meta apontando para o mock). Em produção, sobrescreva via
 * ambiente/.env. Redis fica na 6380 no host para evitar conflito com a 6379.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://postgres:postgres@localhost:5432/atendimento"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6380"),

  META_VERIFY_TOKEN: z.string().min(1).default("meu-verify-token-secreto"),
  META_APP_SECRET: z.string().min(1).default("super-secret-app-secret-trocar"),
  META_TOKEN: z.string().min(1).default("mock-token"),
  META_API_BASE_URL: z.string().url().default("http://localhost:8001"),
  META_PHONE_NUMBER_ID: z.string().min(1).default("123456789012345"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`[env] Configuração inválida:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;

/** Indica se há provedor OpenAI real configurado (senão, usa StubAiProvider). */
export const hasOpenAi = Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.length > 0);
