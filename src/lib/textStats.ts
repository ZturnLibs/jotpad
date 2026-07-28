// Text statistics helpers for the status bar.

/** Count “words”: each CJK ideograph = 1; Latin/other tokens split on whitespace. */
export function countWords(text: string): number {
  if (!text) return 0;
  const cjkRe = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
  let cjk = 0;
  for (const m of text.matchAll(cjkRe)) cjk += m[0].length;
  const rest = text.replace(cjkRe, " ").trim();
  const latin = rest ? rest.split(/\s+/).filter(Boolean).length : 0;
  return cjk + latin;
}

/** Lines spanned by a selection (0 when caret only). */
export function selectedLineCount(from: number, to: number, lineAt: (pos: number) => number): number {
  if (from === to) return 0;
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  return lineAt(b) - lineAt(a) + 1;
}
