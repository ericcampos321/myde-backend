import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

/**
 * Cliente Postgres + Drizzle.
 * O driver `postgres` é lazy: nenhuma conexão é aberta até a primeira query —
 * importar este módulo (ex.: em testes que não tocam o banco) não conecta.
 */
const sql = postgres(env.DATABASE_URL, { max: 10 });

export const db = drizzle(sql, { schema });

/** Encerra o pool de conexões no shutdown. */
export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
