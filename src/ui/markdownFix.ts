/** Pure fixes for Markdown that models get slightly wrong, applied before the chat renders an answer. */

const FENCE = /(^|\n)[ \t]*```[ \t]*([\w-]*)[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*(?=\n|$)/g;

/** True when text holds a Markdown table: a header row, a "---" separator row, and table rows. */
export function looksLikeTable(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim());
  const row = (l: string) => /^\|.*\|$/.test(l) || (l.includes("|") && l.split("|").length >= 3);
  const sep = (l: string) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(l);
  return lines.some((l, i) => i > 0 && sep(l) && row(lines[i - 1]));
}

/**
 * Removes code fences that wrap Markdown instead of code: fences marked markdown/md, and
 * unmarked fences around a table. Models often do this, and the chat would show raw pipes.
 */
export function unwrapMarkdownFences(text: string): string {
  if (!text.includes("```")) return text;
  return text.replace(FENCE, (all, lead: string, lang: string, inner: string) => {
    const l = lang.toLowerCase();
    if (l === "markdown" || l === "md" || (!l && looksLikeTable(inner))) return `${lead}${inner}`;
    return all;
  });
}
