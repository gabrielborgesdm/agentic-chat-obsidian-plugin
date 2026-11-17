/** Pure path helpers (no Obsidian runtime import so they can be unit-tested). */

export class PathError extends Error {}

/**
 * Normalises a user/model-supplied vault-relative path and rejects anything
 * that could escape the vault or touch hidden/config folders.
 */
export function normalizeVaultPath(input: unknown, opts: { allowEmpty?: boolean } = {}): string {
  if (typeof input !== "string") throw new PathError("Path must be a string.");
  let p = input.replace(/\\/g, "/").trim();
  if (p.includes("\0")) throw new PathError("Invalid character in path.");
  if (/^[a-zA-Z]:/.test(p)) throw new PathError("Absolute paths are not allowed.");
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  const parts = p.split("/").filter((s) => s.length > 0 && s !== ".");
  for (const seg of parts) {
    if (seg === "..") throw new PathError("Path traversal ('..') is not allowed.");
    if (seg.startsWith(".")) throw new PathError("Hidden files and folders are not allowed.");
    if (/[<>:"|?*]/.test(seg)) throw new PathError(`Illegal character in "${seg}".`);
  }
  const out = parts.join("/");
  if (!out && !opts.allowEmpty) throw new PathError("Path is empty.");
  return out;
}

/** Adds .md when the last segment has no extension. */
export function ensureMd(path: string): string {
  const last = path.split("/").pop() ?? "";
  return /\.[A-Za-z0-9]+$/.test(last) ? path : path + ".md";
}

/** "a/b.md" -> "a/b (1).md" (n=1), etc. */
export function numberedPath(path: string, n: number): string {
  const m = path.match(/^(.*?)(\.[A-Za-z0-9]+)?$/);
  const base = m?.[1] ?? path;
  const ext = m?.[2] ?? "";
  return `${base} (${n})${ext}`;
}

export function parentFolder(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function baseName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.[A-Za-z0-9]+$/, "");
}

/** Strips accents + lowercases for Portuguese-friendly matching. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
