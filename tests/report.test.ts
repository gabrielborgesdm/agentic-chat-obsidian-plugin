import { describe, expect, it } from "vitest";
import { buildReport } from "../src/storage/Report";
import { DEFAULT_SETTINGS } from "../src/settings/defaults";
import type { Conversation } from "../src/types";

const conv: Conversation = {
  id: "c1",
  title: "Roupas da viagem",
  created: 1000,
  updated: 5000,
  summary: "",
  messages: [
    { id: "1", ts: 1000, role: "user", text: "quais roupas levar?" },
    { id: "2", ts: 2000, role: "tool", text: "read_note(Viagens/checklist.md)", tool: { name: "read_note", args: { path: "Viagens/checklist.md" }, ok: true } },
    { id: "3", ts: 3000, role: "assistant", text: "Não há informações sobre roupas." },
  ],
};

const input = (trace: Parameters<typeof buildReport>[0]["trace"]) => ({
  version: "0.3.3",
  platform: "iOS",
  settings: DEFAULT_SETTINGS,
  route: '"Cloud Agent" (budget none)',
  conv,
  trace,
  now: new Date(6000),
});

describe("buildReport", () => {
  it("includes messages, settings, raw prompts, replies and tool results", () => {
    const r = buildReport(
      input([
        { kind: "model", convId: "c1", ts: 1100, step: 0, tier: "primary", shortcut: "Cloud Agent", prompt: "PROMPT-1", reply: '{"type":"tool_calls"}', ms: 4200 },
        { kind: "tool", convId: "c1", ts: 2000, tool: "read_note", args: { path: "Viagens/checklist.md" }, ok: true, output: "# Viagens/checklist.md\nPassaporte" },
        { kind: "model", convId: "c1", ts: 2100, step: 1, tier: "primary", shortcut: "Cloud Agent", prompt: "PROMPT-2", error: "timeout: no answer", ms: 120000 },
      ])
    );
    expect(r).toContain("v0.3.3 · iOS");
    expect(r).toContain("quais roupas levar?");
    expect(r).toContain('"cloudPromptCharBudget": 0');
    expect(r).toContain("PROMPT-1");
    expect(r).toContain('{"type":"tool_calls"}');
    expect(r).toContain("4.2s");
    expect(r).toContain("Passaporte");
    expect(r).toContain("ERROR timeout: no answer");
  });

  it("keeps code fences intact when a prompt contains backticks", () => {
    const r = buildReport(input([{ kind: "model", convId: "c1", ts: 1100, step: 0, tier: "primary", shortcut: "X", prompt: "a ```json\n{}\n``` b", reply: "ok" }]));
    expect(r).toContain("````text\na ```json");
  });

  it("says when no model calls were recorded", () => {
    expect(buildReport(input([]))).toContain("none recorded");
  });
});
