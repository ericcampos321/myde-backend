import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

/**
 * Cliente Postgres + Drizzle.
 * O driver `postgres` é lazy: nenhuma conexão é aberta até a primeira query —
 * importar este módulo (ex.: em testes que não tocam o banco) não conecta.
 *
 * Pool (singleton de módulo — uma instância por processo; nunca por request):
 * - `max`: teto de conexões simultâneas. 10 cobre a concorrência da API e do
 *   worker (concurrency 5) com folga. Subir só se o EXPLAIN/observabilidade
 *   mostrar saturação.
 * - `idle_timeout`: fecha conexões ociosas após 20s, evitando segurar conexões
 *   à toa e tolerando proxies/load balancers que derrubam conexões paradas.
 * - `connect_timeout`: falha rápido (10s) se o banco não aceitar conexão, em vez
 *   de pendurar o request indefinidamente.
 */
const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(sql, { schema });
export type Database = typeof db;

/** Encerra o pool de conexões no shutdown. */
export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
