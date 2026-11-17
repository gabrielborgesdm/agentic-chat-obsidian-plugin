import type { ToolCall } from "../types";

/**
 * Slash commands run deterministically in the plugin: no model call, no trip
 * to the Shortcuts app, always correct. Pure module (unit-tested).
 */
export type SlashResult =
  | { kind: "tools"; calls: ToolCall[] }
  | { kind: "undo" }
  | { kind: "message"; text: string };

export const SLASH_HELP = [
  "**Commands** (instant, no AI needed):",
  "- `/add texto` adds text to the current note",
  "- `/new Pasta/Título` + new line + text creates a note",
  "- `/daily texto` adds to today's daily note",
  "- `/tasks` lists open tasks (`/tasks nota` for one note)",
  "- `/search palavras` searches the vault",
  "- `/read nota` shows a note",
  "- `/undo` undoes the last change",
].join("\n");

export function parseSlash(input: string, currentPath: string | null): SlashResult | null {
  const text = input.trim();
  const m = text.match(/^\/(\w+)(?:[ \t]+([\s\S]*))?$/);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const arg = (m[2] ?? "").trim();
  const need = (what: string): SlashResult => ({ kind: "message", text: `Usage: ${what}\n\n${SLASH_HELP}` });

  switch (cmd) {
    case "help":
    case "ajuda":
      return { kind: "message", text: SLASH_HELP };
    case "add":
    case "adiciona": {
      if (!arg) return need("`/add texto`");
      // No note open: today's daily note instead of asking.
      if (!currentPath) return { kind: "tools", calls: [{ name: "append_to_daily_note", arguments: { content: arg } }] };
      return { kind: "tools", calls: [{ name: "append_to_note", arguments: { path: currentPath, content: arg } }] };
    }
    case "new":
    case "nova": {
      if (!arg) return need("`/new Pasta/Título` then the text on the next lines");
      const [first, ...rest] = arg.split("\n");
      return { kind: "tools", calls: [{ name: "create_note", arguments: { path: first.trim(), content: rest.join("\n").trim() } }] };
    }
    case "daily":
    case "diario":
    case "diário":
      if (!arg) return need("`/daily texto`");
      return { kind: "tools", calls: [{ name: "append_to_daily_note", arguments: { content: arg } }] };
    case "tasks":
    case "tarefas":
      return { kind: "tools", calls: [{ name: "list_tasks", arguments: arg ? { path: arg, status: "open" } : { status: "open" } }] };
    case "search":
    case "busca":
    case "buscar":
      if (!arg) return need("`/search palavras`");
      return { kind: "tools", calls: [{ name: "search_notes", arguments: { query: arg } }] };
    case "read":
    case "ler":
      if (!arg) return need("`/read nota`");
      return { kind: "tools", calls: [{ name: "read_note", arguments: { path: arg } }] };
    case "undo":
    case "desfazer":
      return { kind: "undo" };
    default:
      return { kind: "message", text: `Unknown command /${cmd}.\n\n${SLASH_HELP}` };
  }
}

/** Turns raw tool output into readable Markdown with clickable [[links]]. */
export function formatToolOutput(name: string, output: string): string {
  switch (name) {
    case "search_notes":
      if (output.startsWith("No notes")) return output;
      return output
        .split("\n")
        .map((l) => {
          const [path, snippet] = l.split(" :: ");
          return `- [[${path}]]${snippet ? ` — ${snippet}` : ""}`;
        })
        .join("\n");
    case "list_tasks":
      if (output.startsWith("No tasks")) return output;
      return output
        .split("\n")
        .map((l) => {
          const mm = l.match(/^(.*?):(\d+) \[(.)\] (.*)$/);
          return mm ? `- ${mm[4]} — [[${mm[1]}]]` : l;
        })
        .join("\n");
    case "read_note":
    case "get_daily_note":
    case "get_current_note":
      return output.replace(/^# (.*)$/m, "**[[$1]]**\n");
    default:
      return output;
  }
}
