import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../../../bootstrap/app.js";
import { healthController } from "./HealthController.js";
import type { ReadinessDeps } from "../../../services/health/readiness.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("responde 200 com ok:true", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, service: "myde-backend" });
  });
});

async function buildReadyApp(deps: ReadinessDeps): Promise<FastifyInstance> {
  const ready = Fastify({ logger: false });
  await ready.register(healthController, { readinessDeps: deps });
  await ready.ready();
  return ready;
}

describe("GET /ready", () => {
  it("200 ready quando DB e Redis ok (não vaza detalhes internos)", async () => {
    const ready = await buildReadyApp({
      checkDb: () => Promise.resolve(true),
      checkRedis: () => Promise.resolve(true),
    });
    const res = await ready.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      status: "ready",
      checks: { db: "ok", redis: "ok" },
    });
    await ready.close();
  });

  it("503 not_ready quando uma dependência falha", async () => {
    const ready = await buildReadyApp({
      checkDb: () => Promise.resolve(true),
      checkRedis: () => Promise.reject(new Error("down")),
    });
    const res = await ready.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      ok: false,
      status: "not_ready",
      checks: { db: "ok", redis: "fail" },
    });
    await ready.close();
  });
});
