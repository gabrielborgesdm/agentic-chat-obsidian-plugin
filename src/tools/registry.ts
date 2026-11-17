import type { OperationRecord, OpKind, ToolContext, ToolDef, ToolResult } from "../types";
import type { VaultService } from "../vault/VaultService";
import { lineDiff } from "../vault/diff";
import { uid } from "../storage/ConversationStore";

const READ_CAP = 3000;

function str(args: Record<string, unknown>, key: string, opts: { optional?: boolean } = {}): string {
  const v = args[key];
  if (typeof v === "string") return v;
  if (opts.optional && (v === undefined || v === null)) return "";
  if (typeof v === "number") return String(v);
  throw new Error(`Missing or invalid argument "${key}".`);
}

function op(kind: OpKind, path: string, extra: Partial<OperationRecord> = {}): OperationRecord {
  return { id: uid(), ts: Date.now(), kind, path, ...extra };
}

function cap(text: string, offset = 0, n = READ_CAP): string {
  const slice = text.slice(offset, offset + n);
  const rest = text.length - (offset + slice.length);
  return slice + (rest > 0 ? `\n[truncated: ${rest} more characters. Call read_note with offset=${offset + slice.length} for more]` : "");
}

const ok = (output: string, o?: OperationRecord): ToolResult => ({ ok: true, output, op: o });

/** Creates every tool. Write tools return an OperationRecord so the host can log + roll back. */
export function buildTools(vault: VaultService): ToolDef[] {
  const tools: ToolDef[] = [
    // ---------------- read ----------------
    {
      name: "search_notes",
      signature: 'search_notes(query) - find notes by words in title/headings/tags/content; returns paths + snippets',
      permission: "read",
      async run(a) {
        const hits = await vault.search(str(a, "query"), 6);
        if (!hits.length) return ok("No notes found.");
        return ok(hits.map((h) => `${h.path}${h.snippet ? " :: " + h.snippet : ""}`).join("\n"));
      },
    },
    {
      name: "read_note",
      signature: "read_note(path, offset?) - read a note's text (long notes are truncated; use offset to continue)",
      permission: "read",
      async run(a) {
        const r = await vault.read(str(a, "path"));
        const off = Math.max(0, parseInt(String(a.offset ?? "0"), 10) || 0);
        return ok(`# ${r.path}\n` + cap(r.content, off));
      },
    },
    {
      name: "list_files",
      signature: 'list_files(folder?) - list files/folders in a folder ("" = vault root)',
      permission: "read",
      async run(a) {
        const r = vault.listFiles(str(a, "folder", { optional: true }));
        const lines = [...r.folders, ...r.files];
        return ok(`${r.path}\n` + (lines.slice(0, 80).join("\n") || "(empty)") + (lines.length > 80 ? `\n… ${lines.length - 80} more` : ""));
      },
    },
    {
      name: "get_current_note",
      signature: "get_current_note() - path and text of the note the user is looking at",
      permission: "read",
      async run(_a, ctx) {
        const p = ctx.currentPath();
        if (!p) return { ok: false, output: "No note is currently open." };
        const r = await vault.read(p);
        return ok(`# ${r.path}\n` + cap(r.content));
      },
    },
    {
      name: "get_note_metadata",
      signature: "get_note_metadata(path) - frontmatter, tags, headings, links, dates",
      permission: "read",
      async run(a) {
        return ok(JSON.stringify(vault.metadata(str(a, "path"))));
      },
    },
    {
      name: "find_backlinks",
      signature: "find_backlinks(path) - notes that link to this note",
      permission: "read",
      async run(a) {
        const l = vault.backlinks(str(a, "path"));
        return ok(l.length ? l.join("\n") : "No backlinks.");
      },
    },
    {
      name: "get_daily_note",
      signature: "get_daily_note(date?) - text of the daily note (date as YYYY-MM-DD, default today)",
      permission: "read",
      async run(a) {
        const date = str(a, "date", { optional: true }) || undefined;
        const f = await vault.getOrCreateDaily(date, false);
        if (!f) return ok(`No daily note exists for ${date ?? "today"} (path would be ${vault.dailyNotePath(date)}).`);
        const r = await vault.read(f.path);
        return ok(`# ${r.path}\n` + cap(r.content));
      },
    },
    {
      name: "list_tasks",
      signature: "list_tasks(path?, status?) - checkbox tasks; status open|done|all (default open); path optional (default whole vault)",
      permission: "read",
      async run(a) {
        const p = str(a, "path", { optional: true });
        const st = (str(a, "status", { optional: true }) || "open") as "open" | "done" | "all";
        const t = await vault.listTasks(p || undefined, st);
        if (!t.length) return ok("No tasks found.");
        return ok(t.map((x) => `${x.path}:${x.line} [${x.done ? "x" : " "}] ${x.text}`).join("\n"));
      },
    },

    // ---------------- write ----------------
    {
      name: "create_note",
      signature: "create_note(path, content) - create a NEW note (fails if it exists; never overwrites)",
      permission: "create",
      async preview(a) {
        return `Create ${str(a, "path")}\n\n${str(a, "content", { optional: true }).slice(0, 800)}`;
      },
      async run(a) {
        const content = str(a, "content", { optional: true });
        const r = await vault.create(str(a, "path"), content);
        return ok(`Created ${r.path}`, op("create", r.path, { after: content }));
      },
    },
    {
      name: "append_to_note",
      signature: "append_to_note(path, content) - add text at the end of an existing note",
      permission: "append",
      async preview(a) {
        return `Append to ${str(a, "path")}:\n\n${str(a, "content").slice(0, 800)}`;
      },
      async run(a) {
        const r = await vault.append(str(a, "path"), str(a, "content"));
        return ok(`Appended to ${r.path}`, op("append", r.path, { before: r.before, after: r.after }));
      },
    },
    {
      name: "update_note",
      signature: "update_note(path, content) - REPLACE the whole text of an existing note (asks the user first)",
      permission: "edit",
      async preview(a) {
        const cur = await vault.read(str(a, "path"));
        return `Replace ${cur.path}\n\n` + lineDiff(cur.content, str(a, "content", { optional: true }));
      },
      async run(a) {
        const r = await vault.update(str(a, "path"), str(a, "content", { optional: true }));
        return ok(`Updated ${r.path}`, op("update", r.path, { before: r.before, after: r.after }));
      },
    },
    {
      name: "replace_in_note",
      signature: "replace_in_note(path, find, replace) - replace one exact piece of text in a note (asks the user first)",
      permission: "edit",
      async preview(a) {
        const cur = await vault.read(str(a, "path"));
        const find = str(a, "find");
        const idx = cur.content.indexOf(find);
        if (idx < 0) return `Text not found in ${cur.path}`;
        const after = cur.content.slice(0, idx) + str(a, "replace", { optional: true }) + cur.content.slice(idx + find.length);
        return `Edit ${cur.path}\n\n` + lineDiff(cur.content, after);
      },
      async run(a) {
        const r = await vault.replaceIn(str(a, "path"), str(a, "find"), str(a, "replace", { optional: true }));
        return ok(`Edited ${r.path}`, op("update", r.path, { before: r.before, after: r.after }));
      },
    },
    {
      name: "rename_note",
      signature: "rename_note(oldPath, newPath) - rename a note (links are updated; asks the user first)",
      permission: "rename",
      async preview(a) {
        return `Rename\n${str(a, "oldPath")}\n→ ${str(a, "newPath")}`;
      },
      async run(a) {
        const r = await vault.rename(str(a, "oldPath"), str(a, "newPath"));
        return ok(`Renamed ${r.oldPath} -> ${r.path}`, op("rename", r.path, { oldPath: r.oldPath }));
      },
    },
    {
      name: "move_note",
      signature: "move_note(path, destination) - move a note into another folder (asks the user first)",
      permission: "rename",
      async preview(a) {
        return `Move ${str(a, "path")}\n→ folder "${str(a, "destination")}"`;
      },
      async run(a) {
        const r = await vault.move(str(a, "path"), str(a, "destination"));
        return ok(`Moved ${r.oldPath} -> ${r.path}`, op("rename", r.path, { oldPath: r.oldPath }));
      },
    },
    {
      name: "delete_note",
      signature: "delete_note(path) - move a note to the trash (always asks the user first)",
      permission: "delete",
      async preview(a) {
        const cur = await vault.read(str(a, "path"));
        return `DELETE ${cur.path} (moved to trash)\n\n${cur.content.slice(0, 500)}`;
      },
      async run(a) {
        const r = await vault.trash(str(a, "path"));
        return ok(`Moved ${r.path} to trash`, op("delete", r.path, { before: r.before }));
      },
    },
    {
      name: "append_to_daily_note",
      signature: "append_to_daily_note(content, date?) - add text to the daily note (created if missing)",
      permission: "append",
      async preview(a) {
        return `Append to daily note ${vault.dailyNotePath(str(a, "date", { optional: true }) || undefined)}:\n\n${str(a, "content").slice(0, 800)}`;
      },
      async run(a) {
        const date = str(a, "date", { optional: true }) || undefined;
        const existed = !!(await vault.getOrCreateDaily(date, false));
        const f = await vault.getOrCreateDaily(date, true);
        const r = await vault.append(f!.path, str(a, "content"));
        return ok(`Appended to ${r.path}`, op(existed ? "append" : "create", r.path, { before: existed ? r.before : undefined, after: r.after }));
      },
    },
    {
      name: "create_folder",
      signature: "create_folder(path) - create a new folder",
      permission: "create",
      async preview(a) {
        return `Create folder ${str(a, "path")}`;
      },
      async run(a) {
        const r = await vault.createFolder(str(a, "path"));
        return ok(`Created folder ${r.path}`);
      },
    },
    {
      name: "rename_folder",
      signature: "rename_folder(oldPath, newPath) - rename or move a whole folder (asks the user first; cannot be undone from the chat)",
      permission: "rename",
      async preview(a) {
        return `Rename/move FOLDER\n${str(a, "oldPath")}\n→ ${str(a, "newPath")}`;
      },
      async run(a) {
        const r = await vault.renameFolder(str(a, "oldPath"), str(a, "newPath"));
        return ok(`Renamed folder ${r.oldPath} -> ${r.path}`);
      },
    },
    {
      name: "toggle_task",
      signature: "toggle_task(path, task) - check/uncheck the task whose text contains `task` (asks the user first)",
      permission: "edit",
      async preview(a) {
        return `Toggle task in ${str(a, "path")}:\n"${str(a, "task")}"`;
      },
      async run(a) {
        const r = await vault.toggleTask(str(a, "path"), str(a, "task"));
        return ok(`Task is now ${r.nowDone ? "done" : "open"} in ${r.path}`, op("update", r.path, { before: r.before, after: r.after }));
      },
    },
  ];
  return tools;
}

export function toolMap(tools: ToolDef[]): Map<string, ToolDef> {
  return new Map(tools.map((t) => [t.name, t]));
}

export type { ToolContext };
