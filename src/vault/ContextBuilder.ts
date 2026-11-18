import type { VaultService } from "./VaultService";

/**
 * Automatic retrieval: gathers a small amount of context BEFORE the first model
 * call so most questions finish in a single Shortcuts round trip.
 */
export async function buildContext(
  vault: VaultService,
  userText: string,
  currentPath: string | null,
  opts: { retrieve: boolean }
): Promise<string> {
  const parts: string[] = [];
  try {
    // lets the model pick a real folder instead of asking the user
    const folders = vault.allFolders();
    if (folders.length) parts.push("Vault folders: " + folders.slice(0, 300).join(", "));
  } catch {
    /* ignore */
  }
  if (!currentPath) parts.push("Current note: none open (for 'add' requests use append_to_daily_note).");
  if (currentPath) {
    try {
      const r = await vault.read(currentPath);
      // Questions about the open note get much more of it (summaries, "what does this say", etc.).
      const aboutNote =
        /\b(this|that|current|open)\s+note\b|\b(essa|esta|nessa|nesta)\s+nota\b|\bnota\s+(atual|aberta)\b|\b(summar\w*|resum\w*|tl;?dr|explain|explica\w*|translate|traduz\w*|revis\w*|review)\b/i.test(
          userText
        );
      const n = aboutNote ? 2800 : 700;
      parts.push(
        `Current note (the user's "this/that/current note"): path "${r.path}"\n${r.content.slice(0, n)}${r.content.length > n ? "…" : ""}`
      );
    } catch {
      /* note vanished */
    }
  }
  if (opts.retrieve && userText.trim().length >= 3) {
    let hits: { path: string; snippet: string }[] = [];
    try {
      hits = (await vault.search(userText, 4)).filter((h) => h.path !== currentPath).slice(0, 3);
      if (hits.length) {
        parts.push("Possibly relevant notes:\n" + hits.map((h) => `- ${h.path}${h.snippet ? ": " + h.snippet.slice(0, 220) : ""}`).join("\n"));
      }
    } catch {
      /* ignore retrieval failures */
    }
    // Task/checklist questions: prefetch open tasks, preferring files that matched the search.
    if (/checklist|check list|tarefa|\btasks?\b|to-?do|pendente|afazer|a fazer/i.test(userText)) {
      try {
        const all = await vault.listTasks(undefined, "open", 500);
        const hitPaths = new Set(hits.map((h) => h.path));
        const preferred = all.filter((t) => hitPaths.has(t.path));
        // generous: the prompt builder trims the context to fit a limited model
        const pick = preferred.length ? preferred.slice(0, 250) : all.slice(0, 80);
        if (pick.length) {
          parts.push(
            "Open tasks found (path:line text):\n" +
              pick.map((t) => `${t.path}:${t.line} ${t.text.slice(0, 180)}${t.text.length > 180 ? "…" : ""}`).join("\n") +
              (all.length > pick.length
                ? preferred.length && pick.length === preferred.length
                  ? `\n(These are ALL open tasks of the matching note. ${all.length - pick.length} more are in other notes.)`
                  : `\n(${all.length - pick.length} more; call list_tasks with a path to get them)`
                : "")
          );
        }
      } catch {
        /* ignore */
      }
    }
  }
  return parts.join("\n\n");
}
