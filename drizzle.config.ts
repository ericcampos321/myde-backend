import "dotenv/config";
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema/**/*.schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/atendimento",
  },
} satisfies Config;
