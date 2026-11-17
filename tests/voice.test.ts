import { describe, expect, it } from "vitest";
import { plainForSpeech } from "../src/voice/Voice";

describe("plainForSpeech", () => {
  it("removes markdown and wikilink syntax", () => {
    expect(plainForSpeech("**Olá** [[Viagens/Islândia|Islândia]] e [[Casa]]")).toBe("Olá Islândia e Casa");
  });
  it("drops code blocks, embeds and urls", () => {
    const t = plainForSpeech("Veja:\n```js\nx=1\n```\n![[foto.png]] https://exemplo.com/a");
    expect(t).not.toContain("x=1");
    expect(t).not.toContain("foto.png");
    expect(t).not.toContain("https");
  });
  it("strips list bullets", () => {
    expect(plainForSpeech("- um\n- dois")).toBe("um dois");
  });
});
