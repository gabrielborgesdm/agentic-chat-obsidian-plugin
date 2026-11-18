/**
 * Picks which notes go into the prompt in full, for any part of the vault.
 * If several of the best search hits share a folder (a trip, a course, a work project),
 * that folder is the "project": its notes go in, most relevant first. Otherwise the
 * best hits go in. Pure (no Obsidian) so it can be unit-tested.
 */

export interface Hit {
  path: string;
  score: number;
}

export interface NoteInfo {
  path: string;
  size: number;
}

export interface ContextPick {
  /** notes to include in full, in order */
  paths: string[];
  /** the shared folder, when one was found */
  project: string | null;
  /** notes of the project that did not fit (listed by name only) */
  left: string[];
}

const parent = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** The folder holding at least 2 of the top 5 hits (most hits wins; ties: the best-ranked hit's folder). */
export function projectFolder(hits: Hit[]): string | null {
  const counts = new Map<string, number>();
  for (const h of hits.slice(0, 5)) {
    const f = parent(h.path);
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 1;
  for (const h of hits.slice(0, 5)) {
    const f = parent(h.path);
    const n = counts.get(f) ?? 0;
    if (f && n > bestN) {
      best = f;
      bestN = n;
    }
  }
  return best;
}

/**
 * @param notesIn every note directly inside a folder
 * @param cap characters available for full note text
 */
export function pickContextNotes(hits: Hit[], notesIn: (folder: string) => NoteInfo[], sizeOf: (path: string) => number, cap: number): ContextPick {
  if (!hits.length || cap < 500) return { paths: [], project: null, left: [] };
  // no folder shared by several hits: the best hit's own folder is the subject (a trip, a course…),
  // unless it is the vault root or a big catch-all folder
  const top = parent(hits[0].path);
  const topCount = top ? notesIn(top).length : 0;
  const project = projectFolder(hits) ?? (topCount >= 2 && topCount <= 30 ? top : null);
  // Every search hit first, by relevance (wherever it lives: "senha do cadeado" must reach
  // Pessoal/Senhas.md even if the top hit is a trip note), then the rest of the project folder.
  const candidates: NoteInfo[] = hits.map((h) => ({ path: h.path, size: sizeOf(h.path) }));
  if (project) {
    const rest = notesIn(project)
      .filter((n) => !candidates.some((c) => c.path === n.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    candidates.push(...rest);
  }

  const paths: string[] = [];
  const left: string[] = [];
  let used = 0;
  for (const n of candidates) {
    if (used + n.size + 40 <= cap) {
      paths.push(n.path);
      used += n.size + 40;
    } else left.push(n.path);
  }
  // The most relevant note always goes in. If it alone is too big, it goes last: a limited
  // model then loses the end of that note, not the small notes that fit before it.
  const best = candidates[0]?.path;
  if (best && !paths.includes(best)) {
    paths.push(best);
    left.splice(left.indexOf(best), 1);
  }
  return { paths, project, left };
}
