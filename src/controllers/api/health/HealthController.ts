import type { FastifyInstance } from "fastify";
import {
  checkDatabaseReady,
  checkRedisReady,
  runReadinessChecks,
  type ReadinessDeps,
} from "../../../services/health/readiness.js";
import { LogEvents } from "../../../shared/logger/events.js";

export interface HealthControllerOptions {
  /** Injetável para teste; default usa os checks reais (DB + Redis). */
  readinessDeps?: ReadinessDeps;
}

/**
 * GET /health   — liveness simples, sem dependência de Postgres/Redis.
 * GET /ready     — readiness: DB + Redis acessíveis (503 quando não).
 */
export async function healthController(
  app: FastifyInstance,
  options: HealthControllerOptions = {}
): Promise<void> {
  const readinessDeps: ReadinessDeps = options.readinessDeps ?? {
    checkDb: checkDatabaseReady,
    checkRedis: checkRedisReady,
  };

  app.get("/health", async () => {
    return { ok: true, service: "myde-backend" };
  });

  app.get("/ready", async (request, reply) => {
    const startedAt = Date.now();
    const result = await runReadinessChecks(readinessDeps);

    request.log.info(
      {
        event: LogEvents.health.readinessChecked,
        requestId: request.id,
        status: result.status,
        checks: result.checks,
        durationMs: Date.now() - startedAt,
      },
      "readiness check"
    );

    reply.status(result.httpStatus);
    return { ok: result.ok, status: result.status, checks: result.checks };
  });
}
