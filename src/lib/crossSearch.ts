// 跨文件全文搜索：在 tabs + recents + 默认保存目录范围内按内容检索。
// 设计详见 docs/design-cross-file-search.md。
import { buildMatcher } from "@/lib/search";
import { SearchQuery } from "@codemirror/search";
import { basename, readFile, type DirEntry } from "@/lib/backend";

export interface LineHit {
  line: number; // 1-based
  col: number; // 1-based
  from: number; // 文本内绝对偏移（跳转选区用）
  to: number;
  text: string; // 行预览（已 trim/截断）
}

export interface FileHit {
  key: string;
  path: string | null;
  label: string;
  rel: string | null;
  tabId: string | null;
  matchCount: number;
  lines: LineHit[];
}

export interface SearchSource {
  key: string;
  path: string | null;
  label: string;
  rel: string | null;
  tabId: string | null;
  getText(): string | Promise<string>;
}

const MAX_LINE_PREVIEW = 120;
export const MAX_LINES_PER_FILE = 50;
export const MAX_TOTAL_HITS = 200;
const BIG_FILE = 2_000_000;

/** 前若干字符出现 NUL 视为二进制，搜索时跳过。 */
export function isBinary(text: string): boolean {
  const sample = text.length > 8000 ? text.slice(0, 8000) : text;
  return sample.includes("\u0000");
}

function previewLine(text: string, lineStart: number, lineEnd: number): string {
  let s = text.slice(lineStart, lineEnd);
  if (s.length > MAX_LINE_PREVIEW) s = s.slice(0, MAX_LINE_PREVIEW) + "…";
  return s.trim();
}

/** 对单个文本跑匹配，返回行级命中（带绝对偏移）。re 需带 g 标志。 */
export function searchText(text: string, re: RegExp, cap = MAX_LINES_PER_FILE): LineHit[] {
  const hits: LineHit[] = [];
  re.lastIndex = 0;
  let lineStart = 0;
  let line = 1;
  let lastHitLine = 0; // 同一行只展示首条命中（预览去重，对齐 VS Code 行为）
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const from = m.index;
    const to = from + m[0].length;
    // 推进到 from 所在行
    while (lineStart < from) {
      const nl = text.indexOf("\n", lineStart);
      if (nl === -1 || nl >= from) break;
      line++;
      lineStart = nl + 1;
    }
    if (line === lastHitLine) continue; // 同行后续命中跳过（预览不重复）
    lastHitLine = line;
    let lineEnd = text.indexOf("\n", from);
    if (lineEnd === -1) lineEnd = text.length;
    hits.push({
      line,
      col: from - lineStart + 1,
      from,
      to,
      text: previewLine(text, lineStart, lineEnd),
    });
    if (hits.length >= cap) break;
  }
  return hits;
}

/** 简易并发限流：最多 n 个 fn 同时执行，保持顺序。 */
export async function pooled<T, R>(
  items: T[],
  n: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 对一批源跑搜索，返回按文件分组、命中数降序的结果。 */
export async function searchFiles(sources: SearchSource[], re: RegExp): Promise<FileHit[]> {
  const out: FileHit[] = [];
  let total = 0;
  const texts = await pooled(sources, 8, async (s) => {
    try {
      const t = await s.getText();
      return { s, t: t ?? "" };
    } catch {
      return { s, t: null as string | null };
    }
  });
  for (const { s, t } of texts) {
    if (total >= MAX_TOTAL_HITS) break;
    if (t == null || t.length === 0 || t.length > BIG_FILE || isBinary(t)) continue;
    const lines = searchText(t, re);
    if (!lines.length) continue;
    out.push({
      key: s.key,
      path: s.path,
      label: s.label,
      rel: s.rel,
      tabId: s.tabId,
      matchCount: lines.length,
      lines,
    });
    total += lines.length;
  }
  out.sort((a, b) => b.matchCount - a.matchCount);
  return out;
}

export interface SearchOpts {
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

/** 构造用于跨文件搜索的正则（复用 search.ts 的 buildMatcher，叠加整词）。 */
export function buildSearchRegExp(query: string, opts: SearchOpts): RegExp | null {
  const re = buildMatcher(
    new SearchQuery({
      search: query,
      caseSensitive: opts.caseSensitive,
      regexp: opts.regexp,
      replace: "",
    }),
  );
  if (!re) return null;
  if (opts.wholeWord && !opts.regexp) {
    try {
      return new RegExp(`\\b(?:${re.source})\\b`, re.flags);
    } catch {
      return null;
    }
  }
  return re;
}

/** 构造搜索源：tabs（内存）→ recents / 目录文件（去重后并发读盘 + 缓存）。 */
export async function buildSources(opts: {
  tabs: { id: string; filePath: string | null; title: string; content: string }[];
  recentFiles: string[];
  dirEntries: DirEntry[];
  cache: Map<string, string>;
}): Promise<SearchSource[]> {
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  for (const tb of opts.tabs) {
    const key = tb.filePath ?? tb.id;
    if (tb.filePath) seen.add(tb.filePath);
    out.push({
      key,
      path: tb.filePath,
      label: tb.title,
      rel: tb.filePath,
      tabId: tb.id,
      getText: () => tb.content,
    });
  }
  interface ToRead {
    path: string;
    label: string;
    rel: string;
  }
  const toRead: ToRead[] = [];
  for (const p of opts.recentFiles) {
    if (!seen.has(p)) {
      seen.add(p);
      toRead.push({ path: p, label: basename(p), rel: p });
    }
  }
  for (const e of opts.dirEntries) {
    if (!seen.has(e.path)) {
      seen.add(e.path);
      toRead.push({ path: e.path, label: e.name, rel: e.rel });
    }
  }
  await pooled(toRead, 8, async (it) => {
    if (opts.cache.has(it.path)) return;
    try {
      opts.cache.set(it.path, (await readFile(it.path)).text);
    } catch {
      /* 已删除 / 移动：留空，getText 返回 "" 被跳过 */
    }
  });
  for (const it of toRead) {
    out.push({
      key: it.path,
      path: it.path,
      label: it.label,
      rel: it.rel,
      tabId: null,
      getText: () => opts.cache.get(it.path) ?? "",
    });
  }
  return out;
}
