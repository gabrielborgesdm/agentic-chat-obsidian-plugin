import { describe, expect, it } from "vitest";
import { parseReply } from "../src/ai/ResponseParser";

describe("parseReply", () => {
  it("parses a final reply", () => {
    const r = parseReply('{"type":"final","message":"Olá"}');
    expect(r.malformed).toBe(false);
    expect(r.reply).toEqual({ type: "final", message: "Olá" });
  });

  it("parses the single tool_call form from the spec", () => {
    const r = parseReply('{"type":"tool_call","name":"search_notes","arguments":{"query":"Iceland travel"}}');
    expect(r.reply).toEqual({ type: "tool_calls", calls: [{ name: "search_notes", arguments: { query: "Iceland travel" } }] });
  });

  it("parses tool_calls arrays", () => {
    const r = parseReply('{"type":"tool_calls","calls":[{"name":"a","arguments":{}},{"name":"b","arguments":{"x":1}}]}');
    expect(r.reply.type).toBe("tool_calls");
    if (r.reply.type === "tool_calls") expect(r.reply.calls).toHaveLength(2);
  });

  it("handles code fences and surrounding prose", () => {
    const r = parseReply('Sure! Here you go:\n```json\n{"type":"final","message":"ok"}\n```\nHope that helps');
    expect(r.reply).toEqual({ type: "final", message: "ok" });
  });

  it("handles braces inside strings", () => {
    const r = parseReply('{"type":"final","message":"use { and } carefully"}');
    expect(r.reply).toEqual({ type: "final", message: "use { and } carefully" });
  });

  it("repairs smart quotes and trailing commas", () => {
    const r = parseReply('{“type”:“final”,“message”:“hi”,}');
    expect(r.reply).toEqual({ type: "final", message: "hi" });
  });

  it("treats plain prose as a final message, not malformed", () => {
    const r = parseReply("Just a normal sentence.");
    expect(r.malformed).toBe(false);
    expect(r.reply).toEqual({ type: "final", message: "Just a normal sentence." });
  });

  it("flags broken JSON as malformed and never turns it into a tool call", () => {
    const r = parseReply('{"type":"tool_calls","calls":[{"name":"delete_note","arguments":{"path":"a.md"');
    expect(r.malformed).toBe(true);
    expect(r.reply.type).toBe("final");
  });

  it("flags empty output", () => {
    expect(parseReply("").malformed).toBe(true);
  });
});

describe("nested JSON in message", () => {
  it("unwraps a reply nested inside message", () => {
    const inner = JSON.stringify({ type: "tool_calls", calls: [{ name: "list_tasks", arguments: {} }] });
    const r = parseReply(JSON.stringify({ type: "final", message: inner }));
    expect(r.malformed).toBe(false);
    expect(r.reply.type).toBe("tool_calls");
  });
  it("flags a bare data object in message as malformed (triggers a repair)", () => {
    const r = parseReply('{"type":"final","message":"{\\"tasks\\":[{\\"path\\":\\"a.md\\"}]}"}');
    expect(r.malformed).toBe(true);
  });
});

describe("parseReply with raw newlines (small on-device model)", () => {
  it("accepts a multi-line message written with real line breaks inside the JSON string", () => {
    const raw =
      '{"type":"final","message":"Para as notas de viagem, aqui estão as listas e endereços:\n\n- [[hospedagem#Edimburgo]]: St Christopher\'s, check-in online.\n\t- Guinness Storehouse, 05/12"}';
    const r = parseReply(raw);
    expect(r.malformed).toBe(false);
    expect(r.reply).toEqual({
      type: "final",
      message: "Para as notas de viagem, aqui estão as listas e endereços:\n\n- [[hospedagem#Edimburgo]]: St Christopher's, check-in online.\n\t- Guinness Storehouse, 05/12",
    });
  });
  it("still parses tool calls whose arguments contain raw newlines", () => {
    const r = parseReply('{"type":"tool_calls","calls":[{"name":"append_to_note","arguments":{"path":"a.md","content":"linha 1\nlinha 2"}}]}');
    expect(r.malformed).toBe(false);
    expect(r.reply).toEqual({ type: "tool_calls", calls: [{ name: "append_to_note", arguments: { path: "a.md", content: "linha 1\nlinha 2" } }] });
  });
});

describe("task list references", () => {
  it("accepts a reply that starts with {{tasks: …}} as a final answer (no repair call)", () => {
    const r = parseReply("{{tasks: Viagens/2026-11-travel/checklist.md}}\n\nAs tarefas estão acima.");
    expect(r.malformed).toBe(false);
    expect(r.reply).toEqual({ type: "final", message: "{{tasks: Viagens/2026-11-travel/checklist.md}}\n\nAs tarefas estão acima." });
  });
});

describe("code answers", () => {
  it("accepts a reply that is only a C code block (the real chat) without a repair call", () => {
    const raw = '```c\n#include <stdio.h>\n\nint main() {\n    printf("216\n");\n    return 0;\n}\n```';
    const r = parseReply(raw);
    expect(r.malformed).toBe(false);
    expect(r.reply).toEqual({ type: "final", message: raw });
  });
  it("still repairs a broken ```json reply", () => {
    expect(parseReply('```json\n{"type":"final","message":"oops\n```').malformed).toBe(true);
  });
  it("keeps a final message that is a code block", () => {
    const r = parseReply(JSON.stringify({ type: "final", message: "```python\nprint(216)\n```" }));
    expect(r).toEqual({ reply: { type: "final", message: "```python\nprint(216)\n```" }, malformed: false });
  });
});
