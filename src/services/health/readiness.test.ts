import { describe, it, expect, vi } from "vitest";
import { runReadinessChecks } from "./readiness.js";

const ok = () => Promise.resolve(true);
const fail = () => Promise.resolve(false);
const boom = () => Promise.reject(new Error("connection refused"));

describe("runReadinessChecks", () => {
  it("db ok + redis ok → ready 200", async () => {
    const result = await runReadinessChecks({ checkDb: ok, checkRedis: ok });
    expect(result).toEqual({
      ok: true,
      status: "ready",
      httpStatus: 200,
      checks: { db: "ok", redis: "ok" },
    });
  });

  it("db fail → not_ready 503", async () => {
    const result = await runReadinessChecks({ checkDb: fail, checkRedis: ok });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("not_ready");
    expect(result.httpStatus).toBe(503);
    expect(result.checks).toEqual({ db: "fail", redis: "ok" });
  });

  it("redis fail → not_ready 503", async () => {
    const result = await runReadinessChecks({ checkDb: ok, checkRedis: fail });
    expect(result.httpStatus).toBe(503);
    expect(result.checks).toEqual({ db: "ok", redis: "fail" });
  });

  it("exceção em um check vira 'fail' (não mascara, status reflete)", async () => {
    const result = await runReadinessChecks({ checkDb: ok, checkRedis: boom });
    expect(result.httpStatus).toBe(503);
    expect(result.checks).toEqual({ db: "ok", redis: "fail" });
  });

  it("roda os dois checks em paralelo", async () => {
    const checkDb = vi.fn(ok);
    const checkRedis = vi.fn(ok);
    await runReadinessChecks({ checkDb, checkRedis });
    expect(checkDb).toHaveBeenCalledTimes(1);
    expect(checkRedis).toHaveBeenCalledTimes(1);
  });
});
