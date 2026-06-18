import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KnowledgeBaseService } from "./KnowledgeBaseService.js";

describe("KnowledgeBaseService", () => {
  it("carrega documentos e consolida contexto em memoria", async () => {
    const directoryPath = await createTemporaryKnowledgeBaseDirectory();
    const service = new KnowledgeBaseService({ directoryPath });

    const documents = await service.loadDocuments();
    const contextA = await service.getContext();
    const contextB = await service.getContext();

    expect(documents).toHaveLength(3);
    expect(documents.map((document) => document.name)).toEqual([
      "faq-geral.md",
      "planos-e-precos.md",
      "suporte-e-sla.md",
    ]);
    expect(contextA).toContain("# faq-geral.md");
    expect(contextA).toContain("Fibra Start 300 Mbps");
    expect(contextA).toBe(contextB);
  });

  it("lança erro claro quando diretorio ou arquivo nao existem", async () => {
    const service = new KnowledgeBaseService({
      directoryPath: path.join(os.tmpdir(), "kb-inexistente"),
    });

    await expect(service.loadDocuments()).rejects.toThrow(
      /Knowledge base document not found or unreadable/
    );
  });
});

async function createTemporaryKnowledgeBaseDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), "myde-kb-"));

  await Promise.all([
    writeFile(
      path.join(directoryPath, "faq-geral.md"),
      "Horário de atendimento: segunda a sábado.\n"
    ),
    writeFile(
      path.join(directoryPath, "planos-e-precos.md"),
      "Fibra Start 300 Mbps - R$ 79,90.\n"
    ),
    writeFile(
      path.join(directoryPath, "suporte-e-sla.md"),
      "SLA residencial de 48h úteis.\n"
    ),
  ]);

  return directoryPath;
}
