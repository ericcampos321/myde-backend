import "dotenv/config";
import { z } from "zod";

/**
 * Única leitura de process.env na aplicação.
 *
 * Credenciais Meta NÃO têm fallback mock em runtime de dev/prod: ausentes ficam
 * ausentes (o erro aparece de forma explícita quando a feature real é usada).
 * Apenas em NODE_ENV=test injetamos valores mock determinísticos, para os testes
 * rodarem sem depender de segredos reais. Infra local (DB/Redis) e modelo OpenAI
 * mantêm defaults de conveniência.
 */

// NODE_ENV resolvido antes do schema para condicionar o comportamento por ambiente.
const rawNodeEnv = process.env.NODE_ENV;
const nodeEnv: "development" | "test" | "production" =
  rawNodeEnv === "test" || rawNodeEnv === "production" ? rawNodeEnv : "development";
const isTest = nodeEnv === "test";

// Mock determinístico — SOMENTE para NODE_ENV=test. Nunca usado em dev/prod.
const META_TEST_DEFAULTS: Readonly<Record<string, string>> = {
  META_VERIFY_TOKEN: "meu-verify-token-secreto",
  META_APP_SECRET: "super-secret-app-secret-trocar",
  META_TOKEN: "mock-token",
  META_PHONE_NUMBER_ID: "123456789012345",
  META_API_BASE_URL: "http://localhost:8001",
};

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://127.0.0.1:3000"),

  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://postgres:postgres@localhost:5432/atendimento"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6380"),

  // Credenciais Meta: opcionais (sem default mock). Em dev/prod ficam ausentes
  // até serem preenchidas no .env local; em test recebem o mock acima.
  META_VERIFY_TOKEN: z.string().min(1).optional(),
  META_APP_SECRET: z.string().min(1).optional(),
  META_TOKEN: z.string().min(1).optional(),
  META_PHONE_NUMBER_ID: z.string().min(1).optional(),
  // Base da Graph API real por padrão; o mock é injetado só em test.
  META_API_BASE_URL: z
    .string()
    .url()
    .default("https://graph.facebook.com/v20.0"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.4"),
});

// Valores em branco no .env (ex.: copiado do .env.example) são tratados como
// ausência, evitando quebrar o boot. Credenciais reais vão no .env local.
const normalizedEnv: Record<string, string | undefined> = {};
for (const [key, value] of Object.entries(process.env)) {
  normalizedEnv[key] = value === "" ? undefined : value;
}

// Mock só em test, e apenas onde a variável estiver ausente.
if (isTest) {
  for (const [key, value] of Object.entries(META_TEST_DEFAULTS)) {
    if (normalizedEnv[key] === undefined) {
      normalizedEnv[key] = value;
    }
  }
}

const parsed = envSchema.safeParse(normalizedEnv);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`[env] Configuração inválida:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;
export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

/**
 * Indica se há provedor OpenAI real configurado. Sem a chave, o stub só é usado
 * em NODE_ENV=test; em dev/prod a criação do provider falha de forma explícita
 * (ver `selectAiProviderKind`).
 */
export const hasOpenAi = Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.length > 0);
