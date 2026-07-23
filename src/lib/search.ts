// Find/replace helpers layered on top of @codemirror/search.
import type { EditorView } from "@codemirror/view";
import {
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  replaceAll,
  replaceNext,
} from "@codemirror/search";

export interface SearchOptions {
  search: string;
  caseSensitive: boolean;
  regexp: boolean;
  replace: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMatcher(q: SearchQuery): RegExp | null {
  if (!q.search) return null;
  let src: string;
  if (q.regexp) {
    src = q.search;
  } else {
    src = escapeRegExp(q.search);
  }
  try {
    return new RegExp(src, q.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

export function findMatches(text: string, re: RegExp): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ from: m.index, to: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

export function applySearchQuery(view: EditorView, opts: SearchOptions): void {
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: opts.search,
        caseSensitive: opts.caseSensitive,
        regexp: opts.regexp,
        replace: opts.replace,
      }),
    ),
  });
}

export function matchCount(view: EditorView): number {
  const q = getSearchQuery(view.state);
  const re = buildMatcher(q);
  if (!re) return 0;
  return findMatches(view.state.doc.toString(), re).length;
}

/** 1-based index of the match the cursor is on / will jump to next. */
export function currentMatchIndex(view: EditorView): number {
  const q = getSearchQuery(view.state);
  const re = buildMatcher(q);
  if (!re) return 0;
  const matches = findMatches(view.state.doc.toString(), re);
  if (!matches.length) return 0;
  const sel = view.state.selection.main;
  const exact = matches.findIndex((m) => m.from === sel.from && m.to === sel.to);
  if (exact >= 0) return exact + 1;
  const idx = matches.findIndex((m) => m.from >= sel.head);
  if (idx >= 0) return idx + 1;
  return matches.length;
}

export function doReplaceNext(view: EditorView): boolean {
  return replaceNext(view);
}

export function doReplaceAll(view: EditorView): number {
  const before = view.state.doc.length;
  const ok = replaceAll(view);
  if (!ok) return 0;
  // count is not returned by replaceAll; recompute via query on original text
  return before; // placeholder, FindBar recomputes properly
}
