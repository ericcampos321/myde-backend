import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Mock determinístico de credenciais Meta só é injetado em NODE_ENV=test
    // (ver src/config/env.ts). Tornamos isso explícito aqui.
    // Auto-reply fixado em "false" para os testes serem herméticos, independente
    // do .env local (que no desafio usa "true"). Os testes de auto-reply ligam a
    // flag explicitamente via injeção (`autoReplyEnabled: true`).
    env: { NODE_ENV: "test", WHATSAPP_AUTO_REPLY_ENABLED: "false" },
  },
});
