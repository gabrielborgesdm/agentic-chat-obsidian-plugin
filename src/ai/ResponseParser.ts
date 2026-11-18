import type { ParsedReply, ToolCall, ModelReply } from "../types";

/** Finds the first balanced {...} block, respecting JSON strings. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Escapes raw line breaks and tabs inside JSON strings. Small models often write a
 * multi-line "message" with real newlines, which JSON.parse rejects.
 */
export function escapeControlCharsInStrings(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const c of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      else if (c === "\n") {
        out += "\\n";
        continue;
      } else if (c === "\r") {
        out += "\\r";
        continue;
      } else if (c === "\t") {
        out += "\\t";
        continue;
      }
    } else if (c === '"') inStr = true;
    out += c;
  }
  return out;
}

function tryParse(s: string): unknown {
  const fixed = escapeControlCharsInStrings(s);
  const attempts = [
    s,
    // raw newlines/tabs inside strings
    fixed,
    // smart quotes -> straight quotes
    s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"),
    // trailing commas
    s.replace(/,\s*([}\]])/g, "$1"),
    fixed.replace(/,\s*([}\]])/g, "$1"),
    s.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, "$1"),
  ];
  for (const a of attempts) {
    try {
      return JSON.parse(a);
    } catch {
      /* next */
    }
  }
  return undefined;
}

function toCall(o: any): ToolCall | null {
  if (!o || typeof o !== "object") return null;
  const name = o.name ?? o.tool;
  if (typeof name !== "string" || !name) return null;
  const args = o.arguments ?? o.args ?? o.parameters ?? {};
  return { name, arguments: args && typeof args === "object" && !Array.isArray(args) ? args : {} };
}

function normalize(obj: any): ModelReply | null {
  if (!obj || typeof obj !== "object") return null;
  const t = obj.type;
  if (t === "final" || t === "answer" || t === "response") {
    const m = obj.message ?? obj.content ?? obj.text ?? obj.answer;
    if (typeof m === "string") return { type: "final", message: m };
    return null;
  }
  if (t === "tool_calls" && Array.isArray(obj.calls)) {
    const calls = obj.calls.map(toCall).filter((c: ToolCall | null): c is ToolCall => !!c);
    return calls.length ? { type: "tool_calls", calls } : null;
  }
  if (t === "tool_call" || (t === undefined && (obj.name || obj.tool) && (obj.arguments || obj.args))) {
    const c = toCall(obj);
    return c ? { type: "tool_calls", calls: [c] } : null;
  }
  return null;
}

/**
 * Tolerant parser. Never throws. Anything that cannot be understood becomes a
 * plain final message (so nothing is ever executed from unparsed text).
 */
export function parseReply(raw: string): ParsedReply {
  const text = (raw ?? "").trim();
  if (!text) return { reply: { type: "final", message: "" }, malformed: true };
  // "{{tasks: path}}" answers start with "{" but are plain text, not broken JSON (no repair round trip)
  if (/^\{\{\s*tasks?\s*:/i.test(text) && !/"type"\s*:/.test(text)) return { reply: { type: "final", message: text }, malformed: false };
  const unfenced = text.replace(/```(?:json)?/gi, "").trim();
  const block = extractJsonObject(unfenced);
  if (block) {
    const reply = normalize(tryParse(block));
    if (reply) {
      if (reply.type === "final" && /^\s*[{`]/.test(reply.message)) {
        // The model nested JSON inside "message". Unwrap a real reply; a bare data object is malformed.
        const inner = extractJsonObject(reply.message.replace(/```(?:json)?/gi, ""));
        const innerReply = inner ? normalize(tryParse(inner)) : null;
        if (innerReply) return { reply: innerReply, malformed: false };
        return { reply, malformed: true };
      }
      return { reply, malformed: false };
    }
  }
  const looksLikeJson = /^\s*[{`]/.test(text) || /"type"\s*:/.test(text);
  return { reply: { type: "final", message: text }, malformed: looksLikeJson };
}
