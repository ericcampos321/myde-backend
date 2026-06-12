import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KnowledgeBaseDocument } from "../AiTypes.js";

const DEFAULT_DOCUMENT_NAMES = [
  "faq-geral.md",
  "planos-e-precos.md",
  "suporte-e-sla.md",
] as const;

export interface KnowledgeBaseServiceOptions {
  directoryPath?: string;
  documentNames?: readonly string[];
}

export class KnowledgeBaseService {
  private readonly directoryPath: string;
  private readonly documentNames: readonly string[];
  private documentsCache: KnowledgeBaseDocument[] | null = null;
  private contextCache: string | null = null;

  constructor(options: KnowledgeBaseServiceOptions = {}) {
    this.directoryPath =
      options.directoryPath ?? getDefaultKnowledgeBaseDirectoryPath();
    this.documentNames = options.documentNames ?? DEFAULT_DOCUMENT_NAMES;
  }

  async loadDocuments(): Promise<KnowledgeBaseDocument[]> {
    if (this.documentsCache) {
      return this.documentsCache;
    }

    const documents = await Promise.all(
      this.documentNames.map(async (documentName) => {
        const documentPath = path.join(this.directoryPath, documentName);

        let content: string;
        try {
          content = await readFile(documentPath, "utf8");
        } catch (error) {
          throw new Error(
            `Knowledge base document not found or unreadable: ${documentPath}`,
            { cause: error }
          );
        }

        return {
          name: documentName,
          path: documentPath,
          content,
        };
      })
    );

    this.documentsCache = documents;
    return documents;
  }

  async getContext(): Promise<string> {
    if (this.contextCache) {
      return this.contextCache;
    }

    const documents = await this.loadDocuments();
    const context = documents
      .map(
        (document) =>
          `# ${document.name}\n${document.content.trim()}`
      )
      .join("\n\n");

    this.contextCache = context;
    return context;
  }
}

function getDefaultKnowledgeBaseDirectoryPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../knowledge-base"
  );
}
