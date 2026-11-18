import { describe, expect, it } from "vitest";
import { looksLikeTable, unwrapMarkdownFences } from "../src/ui/markdownFix";

const table = "| Atividade | Detalhes |\n| --- | --- |\n| Islândia | a pesquisar |\n| Escócia | a pesquisar |";

describe("unwrapMarkdownFences", () => {
  it("unwraps a table the model put inside an unmarked code fence (the real answer)", () => {
    const answer = "```\n" + table + "\n```\n\n[[Viagens/2026-11-travel/index.md]]";
    expect(unwrapMarkdownFences(answer)).toBe(table + "\n\n[[Viagens/2026-11-travel/index.md]]");
  });
  it("unwraps fences marked markdown or md", () => {
    expect(unwrapMarkdownFences("Veja:\n```markdown\n## Título\n- item\n```")).toBe("Veja:\n## Título\n- item");
    expect(unwrapMarkdownFences("```md\n**oi**\n```")).toBe("**oi**");
  });
  it("keeps real code blocks", () => {
    const code = '```json\n{"a": 1}\n```';
    expect(unwrapMarkdownFences(code)).toBe(code);
    const plain = "```\nnpm run deploy\n```";
    expect(unwrapMarkdownFences(plain)).toBe(plain);
  });
  it("detects tables", () => {
    expect(looksLikeTable(table)).toBe(true);
    expect(looksLikeTable("a | b")).toBe(false);
  });
});
