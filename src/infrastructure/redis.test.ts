import { describe, expect, it } from "vitest";
import { parseRedisConnectionOptions } from "./redis.js";

describe("parseRedisConnectionOptions", () => {
  it("mapeia host local para 127.0.0.1 e usa a porta explícita (6380)", () => {
    expect(parseRedisConnectionOptions("redis://localhost:6380")).toEqual({
      host: "127.0.0.1",
      port: 6380,
      username: undefined,
      password: undefined,
      db: undefined,
      maxRetriesPerRequest: null,
    });
  });

  it("mantém o host de serviço Docker (redis:6379)", () => {
    const options = parseRedisConnectionOptions("redis://redis:6379");
    expect(options).toMatchObject({ host: "redis", port: 6379 });
  });

  it("usa a porta padrão 6379 quando ausente", () => {
    expect(parseRedisConnectionOptions("redis://localhost")).toMatchObject({
      port: 6379,
    });
  });

  it("extrai username, password e db index", () => {
    expect(
      parseRedisConnectionOptions("redis://user:pass@cache:6381/2")
    ).toEqual({
      host: "cache",
      port: 6381,
      username: "user",
      password: "pass",
      db: 2,
      maxRetriesPerRequest: null,
    });
  });

  it("sempre define maxRetriesPerRequest: null (exigência do BullMQ)", () => {
    expect(
      parseRedisConnectionOptions("redis://localhost:6380")
    ).toHaveProperty("maxRetriesPerRequest", null);
  });
});
