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
