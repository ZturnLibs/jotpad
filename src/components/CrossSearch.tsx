import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { listDirFiles, resolveDefaultSaveDirectory } from "@/lib/backend";
import { getEditorView } from "@/lib/editorRef";
import {
  buildSearchRegExp,
  buildSources,
  searchFiles,
  type FileHit,
  type LineHit,
} from "@/lib/crossSearch";

type Opt = { caseSensitive: boolean; regexp: boolean; wholeWord: boolean };

export function CrossSearch() {
  const open = useStore((s) => s.crossSearchOpen);
  const setOpen = useStore((s) => s.setCrossSearchOpen);
  const t = useT();

  const [query, setQuery] = useState("");
  const [opts, setOpts] = useState<Opt>({ caseSensitive: false, regexp: false, wholeWord: false });
  const [results, setResults] = useState<FileHit[]>([]);
  const [scanning, setScanning] = useState(false);
  const [index, setIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentCache = useRef<Map<string, string>>(new Map());
  const dirEntries = useRef<Awaited<ReturnType<typeof listDirFiles>>>([]);
  const reqToken = useRef(0);
  const warmed = useRef(false);

  // 打开时重置 + 聚焦 + 预热目录列表（一次）
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    setResults([]);
    setScanning(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (warmed.current) return;
    warmed.current = true;
    void (async () => {
      try {
        const dir = await resolveDefaultSaveDirectory(
          useStore.getState().settings.defaultSaveDirectory,
        );
        if (dir) dirEntries.current = await listDirFiles(dir, { recursive: true, maxFiles: 1000 });
      } catch {
        /* 无可用目录：降级为 tabs + recents */
      }
    })();
  }, [open]);

  // 输入/选项变化 → 防抖搜索
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setScanning(false);
      return;
    }
    const token = ++reqToken.current;
    setScanning(true);
    const id = window.setTimeout(async () => {
      const re = buildSearchRegExp(q, opts);
      if (!re) {
        if (token === reqToken.current) {
          setResults([]);
          setScanning(false);
        }
        return;
      }
      const s = useStore.getState();
      const sources = await buildSources({
        tabs: s.tabs,
        recentFiles: s.recentFiles,
        dirEntries: dirEntries.current,
        cache: contentCache.current,
      });
      const hits = await searchFiles(sources, re);
      if (token === reqToken.current) {
        setResults(hits);
        setScanning(false);
        setIndex(0);
      }
    }, 200);
    return () => window.clearTimeout(id);
  }, [query, opts, open]);

  // 拍平为行项 + 带文件头的渲染序列
  const flat = useMemo(() => {
    const out: { file: FileHit; line: LineHit }[] = [];
    for (const f of results) for (const line of f.lines) out.push({ file: f, line });
    return out;
  }, [results]);

  const rendered = useMemo(() => {
    type Row = { type: "file"; file: FileHit } | { type: "line"; file: FileHit; line: LineHit; idx: number };
    const out: Row[] = [];
    let idx = 0;
    for (const f of results) {
      out.push({ type: "file", file: f });
      for (const line of f.lines) out.push({ type: "line", file: f, line, idx: idx++ });
    }
    return out;
  }, [results]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-li="${index}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [index, flat.length]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    getEditorView()?.focus();
  };

  const pick = async (file: FileHit, line: LineHit) => {
    setOpen(false);
    const s = useStore.getState();
    if (file.tabId) s.setActiveTab(file.tabId);
    else if (file.path) await s.openPath(file.path);
    requestAnimationFrame(() => {
      const v = getEditorView();
      if (v) {
        const len = v.state.doc.length;
        const from = Math.min(line.from, len);
        const to = Math.min(line.to, len);
        v.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
        v.focus();
      }
    });
  };

  const totalFiles = results.length;
  const totalHits = flat.length;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!flat.length) return;
      setIndex((i) => (i + 1) % flat.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      setIndex((i) => (i - 1 + flat.length) % flat.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const it = flat[index];
      if (it) void pick(it.file, it.line);
    }
  };

  return (
    <div
      className="overlay cross-search-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="cross-search" role="dialog" aria-label={t("crossSearch.title")}>
        <div className="cross-search-head">
          <input
            ref={inputRef}
            className="cross-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("crossSearch.placeholder")}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          <div className="cross-search-toggles">
            <button
              className={"cs-toggle" + (opts.caseSensitive ? " active" : "")}
              onClick={() => setOpts((o) => ({ ...o, caseSensitive: !o.caseSensitive }))}
              title={t("crossSearch.caseSensitive")}
              aria-pressed={opts.caseSensitive}
            >
              Aa
            </button>
            <button
              className={"cs-toggle" + (opts.regexp ? " active" : "")}
              onClick={() => setOpts((o) => ({ ...o, regexp: !o.regexp }))}
              title={t("crossSearch.regexp")}
              aria-pressed={opts.regexp}
            >
              .*
            </button>
            <button
              className={"cs-toggle" + (opts.wholeWord ? " active" : "")}
              onClick={() => setOpts((o) => ({ ...o, wholeWord: !o.wholeWord }))}
              title={t("crossSearch.wholeWord")}
              aria-pressed={opts.wholeWord}
            >
              ab|
            </button>
          </div>
        </div>
        <div className="cross-search-status">
          {scanning
            ? t("crossSearch.scanning")
            : totalHits
              ? t("crossSearch.results", { n: totalHits, m: totalFiles })
              : query.trim()
                ? t("crossSearch.noResults")
                : ""}
        </div>
        <div className="cross-search-list" ref={listRef} role="listbox">
          {rendered.map((row) =>
            row.type === "file" ? (
              <div key={`f-${row.file.key}`} className="cs-file">
                <span className="cs-file-name">{row.file.label}</span>
                <span className="cs-file-rel muted" title={row.file.rel ?? ""}>
                  {row.file.rel ?? ""}
                </span>
                <span className="cs-file-count">{row.file.matchCount}</span>
              </div>
            ) : (
              <div
                key={`l-${row.file.key}-${row.line.from}`}
                data-li={row.idx}
                role="option"
                aria-selected={row.idx === index}
                className={"cs-line" + (row.idx === index ? " active" : "")}
                onMouseEnter={() => setIndex(row.idx)}
                onClick={() => void pick(row.file, row.line)}
              >
                <span className="cs-line-no muted">{row.line.line}</span>
                <span className="cs-line-text">{highlight(row.line.text, query, opts)}</span>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/** 在预览行里高亮命中（用与搜索相同的语义重新匹配预览文本）。 */
function highlight(text: string, query: string, opts: Opt): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const re = buildSearchRegExp(q, opts);
  if (!re) return text;
  const local = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = local.exec(text)) !== null) {
    if (m[0].length === 0) {
      local.lastIndex++;
      continue;
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <mark key={key++} className="cs-mark">
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
    if (key > 40) break;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
