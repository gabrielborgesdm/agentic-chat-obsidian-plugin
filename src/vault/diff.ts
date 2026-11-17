/** Tiny line diff (LCS) for approval previews. Pure, no dependencies. */
export function lineDiff(before: string, after: string, maxLines = 400): string {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > maxLines || b.length > maxLines) {
    return `(Large change: ${a.length} lines -> ${b.length} lines, ${before.length} -> ${after.length} chars)`;
  }
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push("  " + a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push("- " + a[i++]);
    } else {
      out.push("+ " + b[j++]);
    }
  }
  while (i < n) out.push("- " + a[i++]);
  while (j < m) out.push("+ " + b[j++]);

  // collapse long unchanged runs
  const res: string[] = [];
  let run = 0;
  for (let k = 0; k < out.length; k++) {
    const changed = out[k][0] !== " ";
    const nearChange = [-2, -1, 1, 2].some((d) => out[k + d] && out[k + d][0] !== " ");
    if (changed || nearChange) {
      if (run > 0) res.push(`  … ${run} unchanged line(s)`);
      run = 0;
      res.push(out[k]);
    } else run++;
  }
  if (run > 0) res.push(`  … ${run} unchanged line(s)`);
  return res.join("\n");
}
