/** A checkbox task that exists in the vault. */
export interface TaskRef {
  path: string;
  /** 1-based line number */
  line: number;
  text: string;
  done: boolean;
}

/** A piece of an answer: Markdown to render as is, or one vault task to show as a checkbox row. */
export type AnswerPart = { kind: "md"; text: string } | { kind: "task"; ref: TaskRef };

export interface LinkedTasks {
  /** the message rewritten so every recognized task is a "- [ ]" / "- [x]" line */
  markdown: string;
  /** one entry per checkbox line in `markdown`, in order; null = not a vault task */
  refs: (TaskRef | null)[];
  /** the answer in order: Markdown runs and linked tasks (what the chat renders) */
  parts: AnswerPart[];
}

/** Splits a task's text into the task itself and its trailing details (note links, "⏰ date"). */
export function splitTaskText(text: string): { main: string; meta: string } {
  const cut = [text.indexOf("[["), text.indexOf("⏰"), text.search(/\bhttps?:\/\//)].filter((i) => i > 0);
  if (!cut.length) return { main: text.trim(), meta: "" };
  const i = Math.min(...cut);
  return { main: text.slice(0, i).trim(), meta: text.slice(i).trim() };
}

/** "Viagens/x/checklist.md: 29 text" or "path.md:29 [ ] text" (the format the context gives the model) */
const PATH_LINE = /^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?(\S.*?\.md)\s*:\s*(\d+)\s*[:\-–]?\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;
/** "- [ ] text" */
const CHECK_LINE = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\.\.\.|…)\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const baseName = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "");

/** The vault task a model's (possibly shortened) task text refers to, if exactly one fits. */
function findByText(text: string, tasks: TaskRef[], path?: string): TaskRef | null {
  const want = norm(text);
  if (want.length < 8) return null;
  const pool = path ? tasks.filter((t) => t.path === path) : tasks;
  const exact = pool.filter((t) => norm(t.text) === want);
  if (exact.length === 1) return exact[0];
  // the model often cuts long tasks ("…"): accept a unique prefix match either way
  const prefix = pool.filter((t) => {
    const have = norm(t.text);
    return have.startsWith(want) || (want.length >= 20 && want.startsWith(have));
  });
  return prefix.length === 1 ? prefix[0] : null;
}

/** "{{tasks: path}}" / "{{tasks: path | all}}": the model points at a note or folder instead of copying its tasks */
const EMBED = /^\s*\{\{\s*tasks?\s*:\s*(.+?)(?:\s*\|\s*(open|all|done))?\s*\}\}\s*$/i;

/**
 * Expands "{{tasks: path}}" lines into that note's (or folder's) tasks, read live from the vault.
 * Writing only the reference keeps the model's answer short (fast) and the list always current.
 */
export function expandTaskEmbeds(text: string, tasks: TaskRef[]): string {
  if (!/\{\{\s*tasks?\s*:/i.test(text)) return text;
  return text
    .split("\n")
    .map((line) => {
      const m = line.match(EMBED);
      if (!m) return line;
      const target = m[1].replace(/^\[\[|\]\]$/g, "").trim();
      const status = (m[2] ?? "open").toLowerCase();
      const withMd = /\.md$/i.test(target) ? target : `${target}.md`;
      const folder = target.replace(/\/+$/, "") + "/";
      const picked = tasks.filter(
        (t) =>
          (t.path === target || t.path === withMd || t.path.startsWith(folder) || baseName(t.path) === baseName(withMd)) &&
          (status === "all" || (status === "done" ? t.done : !t.done))
      );
      if (!picked.length) return `_(no ${status === "all" ? "" : status + " "}tasks in ${target})_`;
      return picked.map((t) => `${t.path}:${t.line} [${t.done ? "x" : " "}] ${t.text}`).join("\n");
    })
    .join("\n");
}

/**
 * Finds the lines of an answer that list vault tasks and turns them into checkbox lines
 * linked to the real task (path + line), so the chat can show working checkboxes.
 * Returns null when the answer lists no vault tasks.
 */
export function linkTaskLines(text: string, tasks: TaskRef[]): LinkedTasks | null {
  if (!tasks.length) return null;
  const byPos = new Map(tasks.map((t) => [`${t.path}:${t.line}`, t]));
  const out: string[] = [];
  const refs: (TaskRef | null)[] = [];
  const parts: AnswerPart[] = [];
  const md = (s: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === "md") last.text += "\n" + s;
    else parts.push({ kind: "md", text: s });
  };
  let lastPath = "";
  let linked = 0;

  for (const line of text.split("\n")) {
    const pl = line.match(PATH_LINE);
    if (pl) {
      const [, path, n, rest] = pl;
      const hit = byPos.get(`${path}:${n}`);
      const t = hit && norm(hit.text).startsWith(norm(rest).slice(0, 25)) ? hit : findByText(rest, tasks, path) ?? findByText(rest, tasks);
      if (t) {
        if (t.path !== lastPath) {
          // group by note: a small heading with a link to it
          const heading = `**[[${t.path}|${baseName(t.path)}]]**`;
          out.push(`${out.length ? "\n" : ""}${heading}`);
          md(heading);
          lastPath = t.path;
        }
        out.push(`- [${t.done ? "x" : " "}] ${t.text}`);
        refs.push(t);
        parts.push({ kind: "task", ref: t });
        linked++;
        continue;
      }
    }
    const cl = line.match(CHECK_LINE);
    if (cl) {
      const [, indent, , rest] = cl;
      const t = findByText(rest, tasks);
      out.push(t ? `${indent}- [${t.done ? "x" : " "}] ${rest}` : line);
      refs.push(t);
      if (t) {
        parts.push({ kind: "task", ref: t });
        linked++;
      } else md(line);
      continue;
    }
    out.push(line);
    md(line);
  }
  return linked ? { markdown: out.join("\n"), refs, parts } : null;
}
