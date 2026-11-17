import type { ChatMessage, ScratchEntry, ToolDef } from "../types";
import type { AgentSettings } from "../settings/defaults";

export interface PromptInput {
  settings: AgentSettings;
  tools: ToolDef[];
  /** history including the newest user message as the last entry */
  history: ChatMessage[];
  summary: string;
  /** auto-retrieved context (current note, search snippets) */
  context: string;
  scratch: ScratchEntry[];
  note?: string; // extra instruction (e.g. repair request)
  today: string;
}

/** Real outcome of a tool, so the model knows what actually happened in earlier turns. */
const toolLine = (m: ChatMessage) => `Tool ${m.tool?.ok ? "OK" : "FAILED"}: ${m.text.slice(0, 160)}`;

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + "…");

export function buildSystem(input: Pick<PromptInput, "tools" | "settings" | "today">): string {
  const lines = [
    "You are Local Agent, an assistant inside the user's Obsidian vault. Answer in the user's language.",
    `Today is ${input.today}.`,
    "You can only act through the tools below. Reply with EXACTLY ONE JSON object and nothing else.",
    'Final answer: {"type":"final","message":"..."}',
    'Use tools: {"type":"tool_calls","calls":[{"name":"<tool>","arguments":{...}}]}',
    "Rules:",
    "1. The \"message\" value is plain human-readable text (Markdown ok), NEVER JSON or a data structure.",
    "2. You know NOTHING about the vault except the Context below and tool results. Never guess note names, paths or contents. If the Context does not clearly answer, call a tool first (search_notes to find, then read_note).",
    "3. Questions about tasks/checklists/to-dos: use list_tasks. Today's daily note: get_daily_note.",
    "3b. Attached images/PDFs cannot be read by you; you can only link them in a note with ![[path]] (images) or [[path]] using append_to_note/create_note. Text attachments appear in the Context.",
    "4. Use at most 3 calls at once. Prefer create_note/append_to_note over update_note. Paths are relative to the vault root. Escape newlines in JSON strings as \\n.",
    "5. To add/create/edit/rename anything you MUST call a tool. Never say you did something unless a tool result in this conversation (\"Tool OK\") confirms it.",
    "6. When you mention a note, write it as a link: [[path/to/note.md]].",
    "7. Do NOT ask the user for a path or folder: choose a sensible default and act. New note: use a short title as the file name at the vault root (or in a folder the user named, from the folder list). Adding text with no target note: use the current note; if there is none, use append_to_daily_note. The user can undo any change.",
    'Example: user says "add milk to this note" and the current note is Casa/Lista.md -> {"type":"tool_calls","calls":[{"name":"append_to_note","arguments":{"path":"Casa/Lista.md","content":"milk"}}]}',
    'Example: user asks "what is in my Iceland notes?" -> {"type":"tool_calls","calls":[{"name":"search_notes","arguments":{"query":"Iceland"}}]}',
    "Tools:",
    ...input.tools.map((t) => "- " + t.signature),
  ];
  if (input.settings.customInstructions.trim()) {
    lines.push("User instructions: " + input.settings.customInstructions.trim());
  }
  return lines.join("\n");
}

/**
 * Builds one prompt string within the character budget. Priority (kept first):
 * system > scratch (tool results this turn) > latest user message > context > recent history > summary.
 */
export function buildPrompt(input: PromptInput): string {
  const budget = input.settings.promptCharBudget;
  const system = buildSystem(input);
  // The newest user message is the request; tool lines after it are things already done for it.
  let lastUserIdx = -1;
  for (let i = input.history.length - 1; i >= 0; i--) {
    if (input.history[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const last = lastUserIdx >= 0 ? input.history[lastUserIdx] : undefined;
  const doneAlready = input.history
    .slice(lastUserIdx + 1)
    .filter((m) => m.role === "tool")
    .map((m) => toolLine(m));
  const attLine = last?.attachments?.length
    ? "\nAttached files (already saved in the vault): " +
      last.attachments
        .map((a) => `${a.path} (${a.kind === "other" ? "binary, contents unreadable" : a.kind === "image" ? "image, contents unreadable" : "text"})`)
        .join("; ")
    : "";
  const userBlock = last ? `User: ${clip(last.text, 1500)}${attLine}` : "";

  const scratchParts = input.scratch.map(
    (s, i) =>
      `Tool call ${i + 1}: ${s.call.name}(${clip(JSON.stringify(s.call.arguments), 300)})\nResult: ${clip(s.result, 1200)}`
  );
  let scratch = scratchParts.join("\n");
  const note = input.note ? `\nNOTE: ${input.note}` : "";
  const tail = "\nReply with one JSON object.";

  let remaining = budget - system.length - userBlock.length - scratch.length - note.length - tail.length - 80;
  if (remaining < 0 && scratch.length) {
    // squeeze tool results hard rather than dropping the system prompt
    scratch = scratchParts.map((p) => clip(p, 500)).join("\n");
    remaining = budget - system.length - userBlock.length - scratch.length - note.length - tail.length - 80;
  }

  const sections: string[] = [];
  const ctx = input.context.trim();
  if (ctx && remaining > 200) {
    const take = clip(ctx, Math.min(ctx.length, Math.floor(remaining * 0.6)));
    sections.push("Context:\n" + take);
    remaining -= take.length + 10;
  }

  const histLines: string[] = [];
  for (let i = lastUserIdx - 1; i >= 0 && remaining > 100; i--) {
    const m = input.history[i];
    if (m.role === "error") continue;
    const line = m.role === "tool" ? toolLine(m) : `${m.role === "user" ? "User" : "Assistant"}: ${clip(m.text, 400)}`;
    if (line.length + 1 > remaining) break;
    histLines.unshift(line);
    remaining -= line.length + 1;
  }
  const sum = input.summary.trim();
  if (sum && remaining > 150) {
    sections.push("Earlier conversation (summary):\n" + clip(sum, Math.min(remaining, 800)));
  }
  if (histLines.length) sections.push("Conversation:\n" + histLines.join("\n"));

  const parts = [system, ...sections, userBlock];
  if (doneAlready.length) parts.push("Already done for this request (do not repeat):\n" + doneAlready.join("\n"));
  if (scratch) parts.push("This turn so far:\n" + scratch);
  return parts.join("\n\n") + note + tail;
}

/** Cheap heuristic compression of messages that fell out of the prompt window. */
export function compressForSummary(prev: string, dropped: ChatMessage[]): string {
  const add = dropped
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "U" : "A"}: ${clip(m.text.replace(/\s+/g, " "), 120)}`)
    .join(" | ");
  const merged = prev ? prev + " | " + add : add;
  return merged.length > 1600 ? "…" + merged.slice(merged.length - 1600) : merged;
}
