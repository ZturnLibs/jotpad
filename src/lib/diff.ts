// Lightweight line-level diff (LCS) for "compare with disk".
export type DiffLineType = "same" | "add" | "del";
export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  same: boolean;
}

/**
 * Compute a unified line diff between `a` (current buffer) and `b` (disk).
 * Uses classic LCS dynamic programming; fine for files up to ~10k lines.
 */
export function diffLines(a: string, b: string): DiffResult {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;

  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const cur = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      cur[j] = A[i] === B[j] ? next[j + 1] + 1 : Math.max(next[j], cur[j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      lines.push({ type: "same", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: "del", text: A[i] });
      i++;
    } else {
      lines.push({ type: "add", text: B[j] });
      j++;
    }
  }
  while (i < n) lines.push({ type: "del", text: A[i++] });
  while (j < m) lines.push({ type: "add", text: B[j++] });

  return { lines, same: lines.every((l) => l.type === "same") };
}
