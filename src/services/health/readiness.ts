import { Redis, type RedisOptions } from "ioredis";
import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { getRedisConnectionOptions } from "../../infrastructure/index.js";

/**
 * Readiness: o serviço consegue atender (dependências acessíveis)?
 * Separado do liveness (`/health`). Não vaza connection string, host nem stack —
 * só o status agregado por dependência.
 */

export type ReadinessCheckStatus = "ok" | "fail";

export interface ReadinessChecks {
  db: ReadinessCheckStatus;
  redis: ReadinessCheckStatus;
}

export interface ReadinessResult {
  ok: boolean;
  status: "ready" | "not_ready";
  httpStatus: 200 | 503;
  checks: ReadinessChecks;
}

export interface ReadinessDeps {
  checkDb: () => Promise<boolean>;
  checkRedis: () => Promise<boolean>;
}

/**
 * Roda os checks (injetáveis para teste) e agrega o resultado. Uma exceção em um
 * check vira `fail` — a falha fica VISÍVEL no status/HTTP (não é mascarada).
 */
export async function runReadinessChecks(
  deps: ReadinessDeps
): Promise<ReadinessResult> {
  const [dbOk, redisOk] = await Promise.all([
    deps.checkDb().catch(() => false),
    deps.checkRedis().catch(() => false),
  ]);

  const checks: ReadinessChecks = {
    db: dbOk ? "ok" : "fail",
    redis: redisOk ? "ok" : "fail",
  };
  const ok = dbOk && redisOk;

  return {
    ok,
    status: ok ? "ready" : "not_ready",
    httpStatus: ok ? 200 : 503,
    checks,
  };
}

/** Check leve do Postgres: `SELECT 1`. Lança em falha (tratado por runReadinessChecks). */
export async function checkDatabaseReady(): Promise<boolean> {
  await db.execute(sql`select 1`);
  return true;
}

/** Check leve do Redis: conexão transitória + PING. Sempre desconecta no fim. */
export async function checkRedisReady(): Promise<boolean> {
  const options: RedisOptions = {
    ...(getRedisConnectionOptions() as RedisOptions),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  };
  const client = new Redis(options);
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === "PONG";
  } finally {
    client.disconnect();
  }
}
