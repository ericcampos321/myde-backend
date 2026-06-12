import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Mock determinístico de credenciais Meta só é injetado em NODE_ENV=test
    // (ver src/config/env.ts). Tornamos isso explícito aqui.
    env: { NODE_ENV: "test" },
  },
});
