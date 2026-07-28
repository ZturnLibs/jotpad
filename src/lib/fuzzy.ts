// Lightweight fuzzy match for Quick Open (subsequence, case-insensitive).

/** Higher is better. `null` means no match. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    if (found === ti) {
      streak += 1;
      score += 2 + streak;
    } else {
      streak = 0;
      score += 1;
    }
    // Bonus for matching at start / after separator.
    if (found === 0 || /[/\\._\-\s]/.test(t[found - 1] ?? "")) score += 4;
    ti = found + 1;
  }
  // Prefer shorter labels when equally matched.
  score -= Math.max(0, t.length - q.length) * 0.01;
  return score;
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  const q = query.trim();
  if (!q) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(q, getText(item)) }))
    .filter((x): x is { item: T; score: number } => x.score != null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}
