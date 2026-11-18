import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/ai/PromptBuilder";
import { DEFAULT_SETTINGS } from "../src/settings/defaults";

const prompt = (text: string) =>
  buildPrompt({
    settings: { ...DEFAULT_SETTINGS, promptCharBudget: 0 },
    tools: [],
    history: [{ id: "1", ts: 1, role: "user", text }],
    summary: "",
    context: "Open tasks found:\nViagens/checklist.md:3 fazer check-in online",
    scratch: [],
    today: "2026-11-18",
  });

describe("reply language in the prompt", () => {
  it("ends by quoting the user's message so the model answers in its language, whatever it is", () => {
    expect(prompt("What are my open checklist for the travel")).toMatch(
      /same language as this user message: «What are my open checklist for the travel» \(not the language of the notes\)\.\nReply with one JSON object\.$/
    );
    expect(prompt("Quels sont mes tâches ?")).toContain("«Quels sont mes tâches ?»");
  });
  it("falls back to a generic rule for slash commands", () => {
    expect(prompt("/tasks")).toContain("same language as the user's latest message");
  });
});
