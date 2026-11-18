import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/ai/PromptBuilder";
import { DEFAULT_SETTINGS } from "../src/settings/defaults";
import { noteFolders } from "../src/vault/ContextBuilder";

const prompt = (text: string, budget = 0, context = "Open tasks found:\nViagens/checklist.md:3 fazer check-in online") =>
  buildPrompt({
    settings: { ...DEFAULT_SETTINGS, promptCharBudget: budget },
    tools: [],
    history: [{ id: "1", ts: 1, role: "user", text }],
    summary: "",
    context,
    scratch: [],
    today: "2026-11-18",
  });

describe("reply language in the prompt", () => {
  it("ends with a language rule that points at the User line", () => {
    expect(prompt("What are my open checklist for the travel")).toMatch(
      /Write the "message" in the language of that User line, not the language of the notes\.\nReply with one JSON object\.$/
    );
  });
  it("does not quote the user's words again (the small model copied them back)", () => {
    const p = prompt("Cheque nas minhas notas de viagem quais são todos os check list abertos");
    expect(p.split("Cheque nas minhas notas").length - 1).toBe(1);
    expect(p).not.toContain("«");
  });
});

describe("context order and folders", () => {
  it("drops attachment, hidden and code-cache folders from the folder list", () => {
    const folders = [
      "Casa",
      "anexos",
      "anexos/soltos",
      "Viagens/2026-11-travel",
      "Viagens/2026-11-travel/anexos/voos",
      "Viagens/2026-11-travel/scripts/__pycache__",
      ".trash",
      "Estudo/_templates",
    ];
    expect(noteFolders(folders, "anexos")).toEqual(["Casa", "Viagens/2026-11-travel"]);
  });
  it("keeps the tasks when a small budget cuts the context (folders come last)", () => {
    const ctx =
      "Open tasks found (path:line text):\nViagens/checklist.md:29 TASK-THAT-MATTERS\n\nVault folders: " + "Pasta/Sub, ".repeat(2000);
    const p = prompt("quais tarefas abertas", 7000, ctx);
    expect(p).toContain("TASK-THAT-MATTERS");
  });
});

import { isTaskQuestion } from "../src/vault/ContextBuilder";
describe("isTaskQuestion", () => {
  it("does not treat 'todos' (all) as a to-do question", () => {
    expect(isTaskQuestion("Eu quero que cê olhe em todos os passeios e tours e o itinerário")).toBe(false);
    expect(isTaskQuestion("me dá todo o roteiro")).toBe(false);
  });
  it("recognizes real task questions", () => {
    expect(isTaskQuestion("quais check list estão abertos")).toBe(true);
    expect(isTaskQuestion("What are my open checklist for the travel")).toBe(true);
    expect(isTaskQuestion("Quais são as minhas tarefas abertas")).toBe(true);
    expect(isTaskQuestion("show my to-dos")).toBe(true);
    expect(isTaskQuestion("o que falta fazer pra viagem")).toBe(true);
  });
});
