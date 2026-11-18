import { describe, expect, it } from "vitest";
import { detectFastPath } from "../src/ai/FastPath";
import { buildPrompt } from "../src/ai/PromptBuilder";
import { formatToolOutput, parseSlash } from "../src/ai/SlashCommands";
import { DEFAULT_SETTINGS } from "../src/settings/defaults";
import type { ChatMessage } from "../src/types";
import { detectLang } from "../src/voice/Voice";

describe("slash commands", () => {
  it("/add appends to the current note", () => {
    expect(parseSlash("/add comprar leite", "Casa/Lista.md")).toEqual({
      kind: "tools",
      calls: [{ name: "append_to_note", arguments: { path: "Casa/Lista.md", content: "comprar leite" } }],
    });
  });
  it("/add without an open note goes to the daily note instead of asking", () => {
    expect(parseSlash("/add x", null)).toMatchObject({ kind: "tools", calls: [{ name: "append_to_daily_note", arguments: { content: "x" } }] });
  });
  it("/new takes the title from the first line and the body from the rest", () => {
    const r = parseSlash("/new Quick Notes/Ideias\nlinha 1\nlinha 2", null);
    expect(r).toEqual({ kind: "tools", calls: [{ name: "create_note", arguments: { path: "Quick Notes/Ideias", content: "linha 1\nlinha 2" } }] });
  });
  it("/tasks, /search, /daily, /undo, /help, Portuguese aliases", () => {
    expect(parseSlash("/tasks", null)).toMatchObject({ kind: "tools", calls: [{ name: "list_tasks" }] });
    expect(parseSlash("/busca islândia", null)).toMatchObject({ calls: [{ name: "search_notes", arguments: { query: "islândia" } }] });
    expect(parseSlash("/daily oi", null)).toMatchObject({ calls: [{ name: "append_to_daily_note" }] });
    expect(parseSlash("/undo", null)).toEqual({ kind: "undo" });
    expect(parseSlash("/help", null)?.kind).toBe("message");
  });
  it("ignores normal text and paths", () => {
    expect(parseSlash("what about /tasks?", null)).toBeNull();
    expect(parseSlash("hello", null)).toBeNull();
  });
  it("formats search output as links and keeps task lines linkable", () => {
    expect(formatToolOutput("search_notes", "Viagens/a.md :: snippet")).toBe("- [[Viagens/a.md]] — snippet");
    // tasks stay as "path:line [ ] text" so the chat can link each line to a checkbox
    expect(formatToolOutput("list_tasks", "Viagens/checklist.md:22 [ ] Apps gerais")).toBe("Viagens/checklist.md:22 [ ] Apps gerais");
  });
});

describe("fast path with named notes", () => {
  const resolve = (n: string) => (n.toLowerCase() === "lista" ? "Casa/Lista.md" : null);
  it("adds to a named note when it exists", () => {
    expect(detectFastPath("add milk to note Lista", [], "Other.md", resolve)?.[0].arguments).toEqual({ path: "Casa/Lista.md", content: "milk" });
    expect(detectFastPath("adiciona leite na nota Lista", [], null, resolve)?.[0].arguments).toEqual({ path: "Casa/Lista.md", content: "leite" });
    expect(detectFastPath("add milk to [[Lista]]", [], null, resolve)?.[0].arguments).toEqual({ path: "Casa/Lista.md", content: "milk" });
  });
  it("never sends a named-note request to the current note", () => {
    expect(detectFastPath("add milk to note Unknown", [], "Other.md", resolve)).toBeNull();
  });
  it("still handles 'this note' forms", () => {
    expect(detectFastPath("adiciona oi nessa nota", [], "A.md")?.[0].arguments).toEqual({ path: "A.md", content: "oi" });
  });
});

describe("prompt grounding", () => {
  const msg = (role: ChatMessage["role"], text: string, ok = true): ChatMessage => ({
    id: Math.random().toString(),
    ts: 1,
    role,
    text,
    tool: role === "tool" ? { name: "append_to_note", args: {}, ok } : undefined,
  });
  const base = { settings: DEFAULT_SETTINGS, tools: [], summary: "", context: "", scratch: [], today: "2026-01-01" };

  it("shows past tool outcomes so the model knows what really happened", () => {
    const p = buildPrompt({
      ...base,
      history: [msg("user", "add the photo"), msg("tool", "append_to_note(Untitled.md)", false), msg("assistant", "Done"), msg("user", "where did you add it?")],
    });
    expect(p).toContain("Tool FAILED: append_to_note(Untitled.md)");
    expect(p).toContain("User: where did you add it?");
  });
  it("lists work already done for the current request (retry safety)", () => {
    const p = buildPrompt({ ...base, history: [msg("user", "add hi to X"), msg("tool", "append_to_note(X.md)")] });
    expect(p).toContain("User: add hi to X");
    expect(p).toContain("Already done for this request");
  });
});

describe("voice language", () => {
  it("detects Portuguese and English from the answer text", () => {
    expect(detectLang("Você tem três tarefas abertas na nota de viagem, não esqueça.", "auto")).toMatch(/^pt/);
    expect(detectLang("You have three open tasks in this note and the trip is soon.", "auto")).toMatch(/^en/);
  });
  it("respects a forced language", () => {
    expect(detectLang("Você tem tarefas", "en-GB")).toBe("en-GB");
  });
});
