import type { ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

/**
 * Configuração centralizada de conexão Redis para Queue e Worker.
 * Parseia REDIS_URL (com suporte a porta, database, credenciais) e retorna
 * ConnectionOptions do BullMQ. Fallback: localhost:6379.
 */
export function getRedisConnectionOptions(): ConnectionOptions {
  const redisUrl = new URL(env.REDIS_URL);
  const database =
    redisUrl.pathname.length > 1 ? Number(redisUrl.pathname.slice(1)) : undefined;
  const host = redisUrl.hostname === "localhost" ? "127.0.0.1" : redisUrl.hostname;

  return {
    host,
    port: redisUrl.port ? Number(redisUrl.port) : 6379,
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    db: Number.isNaN(database) ? undefined : database,
    maxRetriesPerRequest: null,
  };
}
