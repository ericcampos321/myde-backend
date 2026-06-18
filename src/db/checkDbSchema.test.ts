import { describe, expect, it } from "vitest";
import {
  findMissingColumns,
  formatMissingSchemaMessage,
  type RequiredColumn,
} from "./checkDbSchema.js";

const required: RequiredColumn[] = [
  {
    tableName: "ai_interaction_logs",
    columnName: "prompt_tokens",
    migration: "0006_tan_zombie",
  },
  {
    tableName: "ai_interaction_logs",
    columnName: "cached_prompt_tokens",
    migration: "0008_cached_prompt_tokens",
  },
];

describe("findMissingColumns", () => {
  it("retorna vazio quando todas as colunas críticas existem", () => {
    expect(
      findMissingColumns(required, [
        { table_name: "ai_interaction_logs", column_name: "prompt_tokens" },
        {
          table_name: "ai_interaction_logs",
          column_name: "cached_prompt_tokens",
        },
      ])
    ).toEqual([]);
  });

  it("identifica coluna crítica ausente sem tocar em secrets", () => {
    const missing = findMissingColumns(required, [
      { table_name: "ai_interaction_logs", column_name: "prompt_tokens" },
    ]);

    expect(missing).toEqual([required[1]]);
  });
});

describe("formatMissingSchemaMessage", () => {
  it("orienta migration pendente com tabela/coluna e sem DATABASE_URL", () => {
    const message = formatMissingSchemaMessage([required[1]!]);

    expect(message).toContain(
      "Banco local desatualizado. Rode: npm run db:migrate"
    );
    expect(message).toContain("ai_interaction_logs.cached_prompt_tokens");
    expect(message).toContain("0008_cached_prompt_tokens");
    expect(message).not.toMatch(/DATABASE_URL|postgres:\/\/|password/i);
  });
});
