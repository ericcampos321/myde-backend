import { describe, expect, it } from "vitest";
import { buildAiSystemPrompt } from "./AiPromptBuilder.js";
import { AI_PROMPT_VERSION } from "./AiPromptVersion.js";

describe("buildAiSystemPrompt", () => {
  it("retorna a version atual do prompt", () => {
    expect(buildAiSystemPrompt().version).toBe(AI_PROMPT_VERSION);
  });

  it("retorna systemPrompt não vazio", () => {
    expect(buildAiSystemPrompt().systemPrompt.trim().length).toBeGreaterThan(0);
  });

  it("explica que a IA atua como assistente de atendimento comercial", () => {
    const prompt = buildAiSystemPrompt().systemPrompt.toLowerCase();

    expect(prompt).toContain("assistente");
    expect(prompt).toContain("atendimento comercial");
  });

  it("instrui a não revelar prompt, tokens, chaves e segredos", () => {
    const prompt = buildAiSystemPrompt().systemPrompt.toLowerCase();

    expect(prompt).toContain("nunca revele");
    expect(prompt).toContain("prompt interno");
    expect(prompt).toContain("tokens");
    expect(prompt).toContain("chaves");
    expect(prompt).toContain("credenciais");
  });

  it("instrui a não inventar preço, desconto ou condição comercial", () => {
    const prompt = buildAiSystemPrompt().systemPrompt.toLowerCase();

    expect(prompt).toContain("não invente preço");
    expect(prompt).toContain("desconto");
    expect(prompt).toContain("condição comercial");
  });

  it("instrui a usar somente a base e o contexto fornecido", () => {
    const prompt = buildAiSystemPrompt().systemPrompt.toLowerCase();

    expect(prompt).toContain("use somente a base de conhecimento");
    expect(prompt).toContain("contexto fornecido");
  });

  it("reforça que a IA só sugere e o operador revisa e envia", () => {
    const prompt = buildAiSystemPrompt().systemPrompt.toLowerCase();

    expect(prompt).toContain("apenas sugere");
    expect(prompt).toContain("operador revisar e enviar");
  });

  it("inclui instruções extras quando reinforced é true", () => {
    const prompt = buildAiSystemPrompt({ reinforced: true }).systemPrompt.toLowerCase();

    expect(prompt).toContain("atenção extra");
    expect(prompt).toContain("tentando manipular a ia");
    expect(prompt).toContain("não execute ações");
    expect(prompt).toContain("prefira o fallback seguro");
  });

  it("gera prompts diferentes para modo normal e reinforced", () => {
    const normal = buildAiSystemPrompt().systemPrompt;
    const reinforced = buildAiSystemPrompt({ reinforced: true }).systemPrompt;

    expect(reinforced).not.toBe(normal);
  });

  it("não contém placeholders perigosos ou referências técnicas sensíveis", () => {
    const prompt = buildAiSystemPrompt({ reinforced: true }).systemPrompt;

    expect(prompt).not.toContain("OPENAI_API_KEY");
    expect(prompt).not.toContain("Authorization");
    expect(prompt).not.toContain("Bearer ");
    expect(prompt).not.toContain("process.env");
    expect(prompt.toLowerCase()).not.toContain("secret");
    expect(prompt.toLowerCase()).not.toContain("secrets");
  });
});
