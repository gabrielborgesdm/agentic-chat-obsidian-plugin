import { App, TFile, TFolder, moment } from "obsidian";
import { STOPWORDS } from "./stopwords";
import { PathError, baseName, ensureMd, fold, looseRegex, normalizeVaultPath, numberedPath, parentFolder } from "./paths";

export interface SearchHit {
  path: string;
  score: number;
  snippet: string;
}

export interface TaskLine {
  path: string;
  line: number;
  done: boolean;
  text: string;
}

const TASK_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;

/**
 * All vault access goes through here. Every path is normalised and validated
 * before touching the vault. Uses only Obsidian APIs available on mobile.
 */
export class VaultService {
  private foldCache = new Map<string, { mtime: number; text: string }>();

  constructor(private app: App) {}

  // ---------- path / file resolution ----------

  /** Accepts "a/b.md", "a/b", "[[b]]", "[[b|alias]]". Returns an existing file or null. */
  resolve(input: unknown): TFile | null {
    if (typeof input !== "string") return null;
    let s = input.trim();
    const wl = s.match(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/);
    if (wl) s = wl[1];
    let norm: string;
    try {
      norm = normalizeVaultPath(s);
    } catch {
      return null;
    }
    for (const cand of [norm, ensureMd(norm)]) {
      const f = this.app.vault.getAbstractFileByPath(cand);
      if (f instanceof TFile) return f;
    }
    const link = this.app.metadataCache.getFirstLinkpathDest(norm.replace(/\.md$/i, ""), "");
    return link ?? null;
  }

  requireFile(input: unknown): TFile {
    const f = this.resolve(input);
    if (!f) throw new PathError(`Note not found: ${String(input)}`);
    return f;
  }

  exists(path: string): boolean {
    return !!this.app.vault.getAbstractFileByPath(path);
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!folder) return;
    const parts = folder.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? cur + "/" + p : p;
      const f = this.app.vault.getAbstractFileByPath(cur);
      if (!f) await this.app.vault.createFolder(cur);
      else if (!(f instanceof TFolder)) throw new PathError(`"${cur}" is a file, not a folder.`);
    }
  }

  // ---------- reading ----------

  async read(input: unknown): Promise<{ path: string; content: string }> {
    const f = this.requireFile(input);
    return { path: f.path, content: await this.app.vault.read(f) };
  }

  listFiles(folderInput: unknown): { folders: string[]; files: string[]; path: string } {
    const norm = normalizeVaultPath(folderInput ?? "", { allowEmpty: true });
    const folder = norm ? this.app.vault.getAbstractFileByPath(norm) : this.app.vault.getRoot();
    if (!(folder instanceof TFolder)) throw new PathError(`Folder not found: ${norm}`);
    const folders: string[] = [];
    const files: string[] = [];
    for (const c of folder.children) {
      if (c.name.startsWith(".")) continue;
      if (c instanceof TFolder) folders.push(c.name + "/");
      else files.push(c.name);
    }
    folders.sort();
    files.sort();
    return { folders, files, path: norm || "/" };
  }

  /** Every folder path in the vault (hidden folders left out), sorted. */
  allFolders(): string[] {
    const out: string[] = [];
    const walk = (folder: TFolder) => {
      for (const c of folder.children) {
        if (c instanceof TFolder && !c.name.startsWith(".")) {
          out.push(c.path);
          walk(c);
        }
      }
    };
    walk(this.app.vault.getRoot());
    return out.sort((a, b) => a.localeCompare(b));
  }

  /** Folders holding the notes most similar to `text`, best first ("" = vault root). */
  async suggestFolders(text: string, limit = 4): Promise<string[]> {
    const hits = await this.search(text.slice(0, 400), 10);
    const score = new Map<string, number>();
    for (const h of hits) {
      const f = parentFolder(h.path);
      score.set(f, (score.get(f) ?? 0) + h.score);
    }
    return [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([f]) => f)
      .slice(0, limit);
  }

  metadata(input: unknown) {
    const f = this.requireFile(input);
    const c = this.app.metadataCache.getFileCache(f);
    const fm = { ...(c?.frontmatter ?? {}) } as Record<string, unknown>;
    delete (fm as any).position;
    return {
      path: f.path,
      size: f.stat.size,
      created: new Date(f.stat.ctime).toISOString(),
      modified: new Date(f.stat.mtime).toISOString(),
      frontmatter: fm,
      tags: (c?.tags ?? []).map((t) => t.tag),
      headings: (c?.headings ?? []).map((h) => "#".repeat(h.level) + " " + h.heading),
      links: (c?.links ?? []).map((l) => l.link),
    };
  }

  backlinks(input: unknown): string[] {
    const f = this.requireFile(input);
    const resolved = this.app.metadataCache.resolvedLinks;
    const out: string[] = [];
    for (const src of Object.keys(resolved)) {
      if (resolved[src][f.path]) out.push(src);
    }
    return out.sort();
  }

  // ---------- search ----------

  private tokens(query: string): string[] {
    const all = fold(query)
      .split(/[^\p{L}\p{N}#_-]+/u)
      .filter((x) => x.length >= 2);
    // crude plural stemming: checklists -> checklist, viagens -> viagem
    const stem = (w: string) => (w.length > 5 && w.endsWith("ns") ? w.slice(0, -2) + "m" : w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);
    const useful = all.filter((x) => !STOPWORDS.has(x)).map(stem);
    const t = useful.length ? useful : all;
    return t.length ? t : fold(query).trim() ? [fold(query).trim()] : [];
  }

  private async foldedContent(f: TFile): Promise<string> {
    const hit = this.foldCache.get(f.path);
    if (hit && hit.mtime === f.stat.mtime) return hit.text;
    const raw = (await this.app.vault.cachedRead(f)).slice(0, 30000);
    const text = fold(raw);
    this.foldCache.set(f.path, { mtime: f.stat.mtime, text });
    return text;
  }

  async search(query: string, limit = 5): Promise<SearchHit[]> {
    const toks = this.tokens(query);
    if (!toks.length) return [];
    const files = this.app.vault.getMarkdownFiles();
    const scored: SearchHit[] = [];
    const batch = 40;
    for (let i = 0; i < files.length; i += batch) {
      await Promise.all(
        files.slice(i, i + batch).map(async (f) => {
          const name = fold(f.path);
          const cache = this.app.metadataCache.getFileCache(f);
          const heads = fold((cache?.headings ?? []).map((h) => h.heading).join(" \n "));
          const tags = fold((cache?.tags ?? []).map((t) => t.tag).join(" "));
          const body = await this.foldedContent(f);
          let score = 0;
          let matched = 0;
          let firstIdx = -1;
          for (const t of toks) {
            let hit = false;
            if (name.includes(t)) {
              score += baseName(name).includes(t) ? 6 : 2;
              hit = true;
            }
            if (heads.includes(t)) {
              score += 3;
              hit = true;
            }
            if (tags.includes(t)) {
              score += 3;
              hit = true;
            }
            const idx = body.indexOf(t);
            if (idx >= 0) {
              let count = 0;
              let p = idx;
              while (p >= 0 && count < 5) {
                count++;
                p = body.indexOf(t, p + t.length);
              }
              score += count;
              if (firstIdx < 0 || idx < firstIdx) firstIdx = idx;
              hit = true;
            } else if (t.length >= 4) {
              // "teste123" should find "teste 123" / "teste-123": allow a space, - or _ between characters
              const m = looseRegex(t).exec(body);
              if (m) {
                score += 1;
                if (firstIdx < 0 || m.index < firstIdx) firstIdx = m.index;
                hit = true;
              }
            }
            if (hit) matched++;
          }
          if (matched === 0) return;
          if (matched === toks.length && toks.length > 1) score += 5;
          scored.push({ path: f.path, score, snippet: firstIdx >= 0 ? await this.snippet(f, firstIdx) : "" });
        })
      );
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return scored.slice(0, limit);
  }

  private async snippet(f: TFile, idx: number): Promise<string> {
    // folded text can differ in length from the raw text only for rare chars; good enough for a window
    const raw = (await this.app.vault.cachedRead(f)).slice(0, 30000);
    const start = Math.max(0, idx - 80);
    return raw
      .slice(start, start + 220)
      .replace(/\s+/g, " ")
      .trim();
  }

  // ---------- attachments & folders ----------

  private static TEXT_EXT = /\.(md|txt|csv|tsv|json|yaml|yml|xml|html?|log|ini|toml|js|ts|py|css|sql)$/i;
  private static IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/i;

  static kindOf(name: string): "image" | "text" | "other" {
    return VaultService.IMAGE_EXT.test(name) ? "image" : VaultService.TEXT_EXT.test(name) ? "text" : "other";
  }

  /** Saves a user-attached file into the attachment folder. Never overwrites (adds " (1)" etc). */
  async saveAttachment(folder: string, rawName: string, data: ArrayBuffer): Promise<{ path: string; name: string }> {
    const safeName = (rawName || "file").replace(/[<>:"|?*\\/]/g, "_").replace(/^\.+/, "") || "file";
    const dir = normalizeVaultPath(folder || "", { allowEmpty: true });
    let path = (dir ? dir + "/" : "") + safeName;
    let n = 1;
    while (this.exists(path)) path = numberedPath((dir ? dir + "/" : "") + safeName, n++);
    await this.ensureFolder(dir);
    const f = await this.app.vault.createBinary(path, data);
    return { path: f.path, name: f.name };
  }

  /** First `maxChars` characters of a text-like file, or null for binaries. */
  async textExcerpt(path: string, maxChars: number): Promise<string | null> {
    const f = this.resolve(path);
    if (!f || VaultService.kindOf(f.name) !== "text" || f.stat.size > 500_000) return null;
    const t = await this.app.vault.cachedRead(f);
    return t.length > maxChars ? t.slice(0, maxChars) + "…" : t;
  }

  async createFolder(pathInput: unknown): Promise<{ path: string }> {
    const path = normalizeVaultPath(pathInput);
    if (this.exists(path)) throw new PathError(`"${path}" already exists.`);
    await this.ensureFolder(path);
    return { path };
  }

  /** Renames or moves a folder (links are updated). Never overwrites. */
  async renameFolder(oldInput: unknown, newInput: unknown): Promise<{ oldPath: string; path: string }> {
    const oldPath = normalizeVaultPath(oldInput);
    const target = normalizeVaultPath(newInput);
    const f = this.app.vault.getAbstractFileByPath(oldPath);
    if (!(f instanceof TFolder)) throw new PathError(`Folder not found: ${oldPath}`);
    if (this.exists(target)) throw new PathError(`"${target}" already exists. Not overwritten.`);
    if (target.startsWith(oldPath + "/")) throw new PathError("Cannot move a folder into itself.");
    await this.ensureFolder(parentFolder(target));
    await this.app.fileManager.renameFile(f, target);
    return { oldPath, path: target };
  }

  // ---------- writing ----------

  /** Creates a note. NEVER overwrites: throws if the path exists. */
  async create(pathInput: unknown, content: string): Promise<{ path: string }> {
    const path = ensureMd(normalizeVaultPath(pathInput));
    if (this.exists(path)) {
      let n = 1;
      while (this.exists(numberedPath(path, n))) n++;
      throw new PathError(
        `"${path}" already exists. Not overwritten. Use append_to_note/update_note, or choose another name (e.g. "${numberedPath(path, n)}").`
      );
    }
    await this.ensureFolder(parentFolder(path));
    const f = await this.app.vault.create(path, content ?? "");
    return { path: f.path };
  }

  async update(input: unknown, content: string): Promise<{ path: string; before: string; after: string }> {
    const f = this.requireFile(input);
    let before = "";
    await this.app.vault.process(f, (d) => {
      before = d;
      return content;
    });
    return { path: f.path, before, after: content };
  }

  async append(input: unknown, text: string): Promise<{ path: string; before: string; after: string }> {
    const f = this.requireFile(input);
    let before = "";
    let after = "";
    await this.app.vault.process(f, (d) => {
      before = d;
      after = d + (d.length && !d.endsWith("\n") ? "\n" : "") + text;
      return after;
    });
    return { path: f.path, before, after };
  }

  async replaceIn(
    input: unknown,
    find: string,
    replacement: string
  ): Promise<{ path: string; before: string; after: string }> {
    const f = this.requireFile(input);
    const cur = await this.app.vault.read(f);
    const idx = cur.indexOf(find);
    if (!find || idx < 0) throw new PathError("Text to replace was not found in the note.");
    if (cur.indexOf(find, idx + find.length) >= 0) throw new PathError("Text to replace matches more than once; use a longer snippet.");
    const after = cur.slice(0, idx) + replacement + cur.slice(idx + find.length);
    await this.app.vault.process(f, () => after);
    return { path: f.path, before: cur, after };
  }

  /** Rename and/or move; uses fileManager so links are updated. Never overwrites. */
  async rename(oldInput: unknown, newInput: unknown): Promise<{ oldPath: string; path: string }> {
    const f = this.requireFile(oldInput);
    const target = ensureMd(normalizeVaultPath(newInput));
    if (this.exists(target)) throw new PathError(`"${target}" already exists. Not overwritten.`);
    await this.ensureFolder(parentFolder(target));
    const oldPath = f.path;
    await this.app.fileManager.renameFile(f, target);
    return { oldPath, path: target };
  }

  async move(input: unknown, destFolder: unknown): Promise<{ oldPath: string; path: string }> {
    const f = this.requireFile(input);
    const dest = normalizeVaultPath(destFolder, { allowEmpty: true });
    return this.rename(f.path, (dest ? dest + "/" : "") + f.name);
  }

  /** Moves to the system/vault trash (recoverable). */
  async trash(input: unknown): Promise<{ path: string; before: string }> {
    const f = this.requireFile(input);
    const before = await this.app.vault.read(f);
    await this.app.fileManager.trashFile(f);
    return { path: f.path, before };
  }

  // ---------- tasks ----------

  async listTasks(pathInput?: unknown, status: "open" | "done" | "all" = "open", limit = 30): Promise<TaskLine[]> {
    const files = pathInput ? this.notesAt(pathInput) : this.app.vault.getMarkdownFiles();
    const out: TaskLine[] = [];
    for (const f of files) {
      if (out.length >= limit) break;
      const text = await this.app.vault.cachedRead(f);
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(TASK_RE);
        if (!m) continue;
        const done = m[2].toLowerCase() === "x";
        if (status === "open" && done) continue;
        if (status === "done" && !done) continue;
        out.push({ path: f.path, line: i + 1, done, text: m[4].trim() });
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /**
   * Toggles the task at a known line (from a chat checkbox). If the note changed since,
   * finds the same task by its exact text instead of toggling the wrong line.
   */
  async toggleTaskAt(pathInput: unknown, lineNo: number, taskText: string): Promise<{ path: string; before: string; after: string; nowDone: boolean }> {
    const f = this.requireFile(pathInput);
    const cur = await this.app.vault.read(f);
    const lines = cur.split("\n");
    const same = (l: string | undefined) => {
      const m = l?.match(TASK_RE);
      return !!m && m[4].trim() === taskText.trim();
    };
    let i = lineNo - 1;
    if (!same(lines[i])) {
      i = lines.findIndex((l) => same(l));
      if (i < 0) throw new PathError("That task changed in the note. Ask again to refresh the list.");
    }
    const m = lines[i].match(TASK_RE)!;
    const nowDone = m[2] === " ";
    lines[i] = m[1] + (nowDone ? "x" : " ") + m[3] + m[4];
    const after = lines.join("\n");
    await this.app.vault.process(f, () => after);
    return { path: f.path, before: cur, after, nowDone };
  }

  /** A note, or every note inside a folder (models often pass a project's folder). */
  private notesAt(input: unknown): TFile[] {
    const file = this.resolve(input);
    if (file) return [file];
    if (typeof input === "string") {
      const norm = normalizeVaultPath(input.replace(/\/+$/, ""), { allowEmpty: true });
      const folder = norm ? this.app.vault.getAbstractFileByPath(norm) : this.app.vault.getRoot();
      if (folder instanceof TFolder) {
        const prefix = norm ? norm + "/" : "";
        return this.app.vault
          .getMarkdownFiles()
          .filter((f) => f.path.startsWith(prefix))
          .sort((a, b) => a.path.localeCompare(b.path));
      }
    }
    throw new PathError(`Note or folder not found: ${String(input)}`);
  }

  async toggleTask(input: unknown, taskText: string): Promise<{ path: string; before: string; after: string; nowDone: boolean }> {
    const f = this.requireFile(input);
    const cur = await this.app.vault.read(f);
    const lines = cur.split("\n");
    const want = fold(taskText).trim();
    const matches: number[] = [];
    lines.forEach((l, i) => {
      const m = l.match(TASK_RE);
      if (m && fold(m[4]).includes(want)) matches.push(i);
    });
    if (!want || matches.length === 0) throw new PathError("No matching task found.");
    if (matches.length > 1) throw new PathError(`${matches.length} tasks match; use more of the task text.`);
    const i = matches[0];
    const m = lines[i].match(TASK_RE)!;
    const nowDone = m[2] === " ";
    lines[i] = m[1] + (nowDone ? "x" : " ") + m[3] + m[4];
    const after = lines.join("\n");
    await this.app.vault.process(f, () => after);
    return { path: f.path, before: cur, after, nowDone };
  }

  // ---------- daily notes ----------

  private dailyConfig(): { folder: string; format: string; template: string } {
    const opts = (this.app as any).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options ?? {};
    return {
      folder: (opts.folder ?? "").trim().replace(/^\/+|\/+$/g, ""),
      format: (opts.format ?? "").trim() || "YYYY-MM-DD",
      template: (opts.template ?? "").trim(),
    };
  }

  dailyNotePath(date?: string): string {
    const cfg = this.dailyConfig();
    const mo = moment as unknown as (...a: unknown[]) => any;
    const m = date ? mo(date, "YYYY-MM-DD") : mo();
    if (!m.isValid()) throw new PathError("Invalid date; use YYYY-MM-DD.");
    return (cfg.folder ? cfg.folder + "/" : "") + m.format(cfg.format) + ".md";
  }

  async getOrCreateDaily(date?: string, create = true): Promise<TFile | null> {
    const path = this.dailyNotePath(date);
    const ex = this.app.vault.getAbstractFileByPath(path);
    if (ex instanceof TFile) return ex;
    if (!create) return null;
    let content = "";
    const tpl = this.dailyConfig().template;
    if (tpl) {
      const tf = this.app.vault.getAbstractFileByPath(ensureMd(tpl));
      if (tf instanceof TFile) content = await this.app.vault.read(tf);
    }
    await this.ensureFolder(parentFolder(path));
    return this.app.vault.create(path, content);
  }
}
