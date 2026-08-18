import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { getEditorView } from "@/lib/editorRef";
import { fuzzyFilter } from "@/lib/fuzzy";
import { parseOutline } from "@/lib/outline";

export function Outline() {
  const open = useStore((s) => s.outlineOpen);
  const setOpen = useStore((s) => s.setOutlineOpen);
  const activeTabId = useStore((s) => s.activeTabId);
  const content = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.content);
  const t = useT();

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 打开时重置；tab 切换时保持打开并重置过滤（内容变化由 content 依赖驱动重解析）
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, activeTabId]);

  const items = useMemo(() => parseOutline(content ?? ""), [content]);

  const filtered = useMemo(
    () => (query.trim() ? fuzzyFilter(items, query.trim(), (it) => it.text) : items),
    [items, query],
  );

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-oi="${index}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [index, filtered.length]);

  // 打开时高亮当前光标所在的标题（跟随编辑器滚动位置）
  useEffect(() => {
    if (!open) return;
    const view = getEditorView();
    if (!view) return;
    const pos = view.state.selection.main.head;
    // 从后往前找第一个 from <= pos 的标题
    let hit = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]!.from <= pos) {
        hit = i;
        break;
      }
    }
    if (hit >= 0 && !query.trim()) setIndex(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTabId, items]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    getEditorView()?.focus();
  };

  const jump = (from: number) => {
    setOpen(false);
    requestAnimationFrame(() => {
      const v = getEditorView();
      if (v) {
        const pos = Math.min(from, v.state.doc.length);
        v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        v.focus();
      }
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!filtered.length) return;
      setIndex((i) => (i + 1) % filtered.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtered.length) return;
      setIndex((i) => (i - 1 + filtered.length) % filtered.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[index];
      if (it) jump(it.from);
    }
  };

  return (
    <div
      className="overlay quick-open-overlay outline-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="quick-open outline-panel" role="dialog" aria-label={t("outline.title")}>
        <input
          ref={inputRef}
          className="quick-open-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("outline.placeholder")}
          onKeyDown={onKeyDown}
          spellCheck={false}
          aria-autocomplete="list"
          aria-controls="outline-list"
        />
        <div className="quick-open-list" id="outline-list" ref={listRef} role="listbox">
          {filtered.length === 0 ? (
            <div className="quick-open-empty muted">
              {items.length === 0 ? t("outline.noHeadings") : t("quickOpen.empty")}
            </div>
          ) : (
            filtered.map((it, i) => (
              <div
                key={`${it.line}-${it.from}`}
                data-oi={i}
                role="option"
                aria-selected={i === index}
                className={"quick-open-row outline-row" + (i === index ? " active" : "")}
                style={{ paddingLeft: 10 + (it.level - 1) * 14 }}
                onMouseEnter={() => setIndex(i)}
                onClick={() => jump(it.from)}
              >
                <span className="outline-badge">H{it.level}</span>
                <span className="quick-open-label">{it.text}</span>
                <span className="quick-open-detail muted">L{it.line}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
