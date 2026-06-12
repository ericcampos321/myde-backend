import type { AiProviderInput, AiProviderResult } from "../AiTypes.js";
import type { AiProvider } from "./AiProvider.js";

const SAFE_FALLBACK =
  "Não encontrei essa informação na base de conhecimento disponível. Posso encaminhar para um atendente humano.";

export class StubAiProvider implements AiProvider {
  readonly source = "stub" as const;

  async generateReply(
    input: AiProviderInput
  ): Promise<AiProviderResult> {
    const normalizedMessage = normalizeText(input.userMessage);

    if (hasAnyKeyword(normalizedMessage, ["plano", "preco", "valor"])) {
      return {
        source: this.source,
        text:
          extractSectionReply(input.knowledgeBaseContext, "planos") ??
          SAFE_FALLBACK,
      };
    }

    if (hasAnyKeyword(normalizedMessage, ["suporte", "sla", "prazo"])) {
      return {
        source: this.source,
        text:
          extractSectionReply(input.knowledgeBaseContext, "suporte") ??
          SAFE_FALLBACK,
      };
    }

    if (hasAnyKeyword(normalizedMessage, ["horario", "atendimento"])) {
      return {
        source: this.source,
        text:
          extractSectionReply(input.knowledgeBaseContext, "faq") ??
          SAFE_FALLBACK,
      };
    }

    return {
      source: this.source,
      text: SAFE_FALLBACK,
    };
  }
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function extractSectionReply(
  knowledgeBaseContext: string,
  section: "planos" | "suporte" | "faq"
): string | null {
  const lines = knowledgeBaseContext.split("\n");

  if (section === "planos") {
    const matchedLines = lines.filter((line) => {
      const normalizedLine = normalizeText(line);
      return (
        normalizedLine.includes("fibra start") ||
        normalizedLine.includes("fibra plus") ||
        normalizedLine.includes("fibra max") ||
        normalizedLine.includes("ip fixo") ||
        normalizedLine.includes("neoplay") ||
        normalizedLine.includes("mesh")
      );
    });

    if (matchedLines.length === 0) {
      return null;
    }

    return `Planos disponíveis na base:\n${matchedLines.join("\n")}`;
  }

  if (section === "suporte") {
    const matchedLines = lines.filter((line) => {
      const normalizedLine = normalizeText(line);
      return (
        normalizedLine.includes("sla") ||
        normalizedLine.includes("48h") ||
        normalizedLine.includes("8h") ||
        normalizedLine.includes("0800") ||
        normalizedLine.includes("whatsapp") ||
        normalizedLine.includes("app")
      );
    });

    if (matchedLines.length === 0) {
      return null;
    }

    return `Suporte e prazos conforme a base:\n${matchedLines.join("\n")}`;
  }

  const matchedLines = lines.filter((line) => {
    const normalizedLine = normalizeText(line);
    return (
      normalizedLine.includes("segunda") ||
      normalizedLine.includes("sabado") ||
      normalizedLine.includes("boleto") ||
      normalizedLine.includes("status do pedido") ||
      normalizedLine.includes("mudanca de endereco")
    );
  });

  if (matchedLines.length === 0) {
    return null;
  }

  return `Informações encontradas na base:\n${matchedLines.join("\n")}`;
}
