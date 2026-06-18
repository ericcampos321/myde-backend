import type { ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

/** Porta Redis padrão quando a REDIS_URL não traz porta explícita. */
const DEFAULT_REDIS_PORT = 6379;

/**
 * Parseia uma REDIS_URL em ConnectionOptions do BullMQ. Função pura (sem ler
 * env) para ser testável. Suporta porta, database index e credenciais; e usa
 * `maxRetriesPerRequest: null`, exigido por conexões de bloqueio do BullMQ.
 */
export function parseRedisConnectionOptions(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const database =
    url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;
  const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;

  return {
    host,
    port: url.port ? Number(url.port) : DEFAULT_REDIS_PORT,
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number.isNaN(database) ? undefined : database,
    maxRetriesPerRequest: null,
  };
}

/**
 * Configuração centralizada de conexão Redis para Queue, Worker e QueueEvents.
 * Única fonte de verdade — lê a REDIS_URL centralizada em `src/config/env.ts`.
 */
export function getRedisConnectionOptions(): ConnectionOptions {
  return parseRedisConnectionOptions(env.REDIS_URL);
}
