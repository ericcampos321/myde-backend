import "dotenv/config";
import postgres from "postgres";
import { pathToFileURL } from "node:url";
import { env } from "../config/env.js";

export interface RequiredColumn {
  tableName: string;
  columnName: string;
  migration: string;
}

interface ExistingColumn {
  table_name: string;
  column_name: string;
}

export const REQUIRED_DB_COLUMNS: readonly RequiredColumn[] = [
  {
    tableName: "ai_interaction_logs",
    columnName: "provider",
    migration: "0006_tan_zombie",
  },
  {
    tableName: "ai_interaction_logs",
    columnName: "prompt_tokens",
    migration: "0006_tan_zombie",
  },
  {
    tableName: "ai_interaction_logs",
    columnName: "completion_tokens",
    migration: "0006_tan_zombie",
  },
  {
    tableName: "ai_interaction_logs",
    columnName: "total_tokens",
    migration: "0006_tan_zombie",
  },
  {
    tableName: "ai_interaction_logs",
    columnName: "duration_ms",
    migration: "0006_tan_zombie",
  },
  {
    tableName: "ai_interaction_logs",
    columnName: "context_items_count",
    migration: "0006_tan_zombie",
  },
  {
    tableName: "ai_interaction_logs",
    columnName: "context_chars",
    migration: "0006_tan_zombie",
  },
  {
    tableName: "ai_interaction_logs",
    columnName: "cached_prompt_tokens",
    migration: "0008_cached_prompt_tokens",
  },
];

export function findMissingColumns(
  requiredColumns: readonly RequiredColumn[],
  existingColumns: readonly ExistingColumn[]
): RequiredColumn[] {
  const existing = new Set(
    existingColumns.map((column) => `${column.table_name}.${column.column_name}`)
  );

  return requiredColumns.filter(
    (column) => !existing.has(`${column.tableName}.${column.columnName}`)
  );
}

export function formatMissingSchemaMessage(
  missingColumns: readonly RequiredColumn[]
): string {
  return [
    "Banco local desatualizado. Rode: npm run db:migrate",
    "",
    "Itens ausentes:",
    ...missingColumns.map(
      (column) =>
        `- ${column.tableName}.${column.columnName} (migration ${column.migration})`
    ),
  ].join("\n");
}

async function checkDbSchema(): Promise<void> {
  const sql = postgres(env.DATABASE_URL, { max: 1 });

  try {
    const tableNames = [
      ...new Set(REQUIRED_DB_COLUMNS.map((column) => column.tableName)),
    ];
    const rows = await sql<ExistingColumn[]>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any(${tableNames})
    `;

    const missing = findMissingColumns(REQUIRED_DB_COLUMNS, rows);
    if (missing.length > 0) {
      console.error(formatMissingSchemaMessage(missing));
      process.exitCode = 1;
      return;
    }

    console.log("Schema local compatível.");
  } catch (error) {
    console.error(
      [
        "Não foi possível validar o schema do banco local.",
        "Verifique se o Postgres está rodando e se o .env está configurado.",
        "Depois rode: npm run db:migrate",
        "",
        `Erro: ${error instanceof Error ? error.message : "erro desconhecido"}`,
      ].join("\n")
    );
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const entrypointArg = process.argv[1];
if (entrypointArg && import.meta.url === pathToFileURL(entrypointArg).href) {
  void checkDbSchema();
}
