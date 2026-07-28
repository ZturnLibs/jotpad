import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { basename } from "@/lib/backend";
import { fuzzyFilter } from "@/lib/fuzzy";
import { getEditorView } from "@/lib/editorRef";
import { MOD } from "@/lib/utils";

type QuickItem =
  | { kind: "tab"; id: string; label: string; detail: string }
  | { kind: "recent"; path: string; label: string; detail: string };

export function QuickOpen() {
  const open = useStore((s) => s.quickOpenOpen);
  const setOpen = useStore((s) => s.setQuickOpenOpen);
  const tabs = useStore((s) => s.tabs);
  const recentFiles = useStore((s) => s.recentFiles);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const openPath = useStore((s) => s.openPath);
  const t = useT();

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const openPaths = new Set(tabs.map((tb) => tb.filePath).filter(Boolean) as string[]);
    const tabItems: QuickItem[] = tabs.map((tb) => ({
      kind: "tab",
      id: tb.id,
      label: tb.filePath ? basename(tb.filePath) : t("tab.untitled"),
      detail: tb.filePath ?? t("quickOpen.openTab"),
    }));
    const recentItems: QuickItem[] = recentFiles
      .filter((p) => !openPaths.has(p))
      .map((path) => ({
        kind: "recent" as const,
        path,
        label: basename(path),
        detail: path,
      }));
    const all = [...tabItems, ...recentItems];
    return fuzzyFilter(all, query, (it) => `${it.label} ${it.detail}`);
  }, [tabs, recentFiles, query, t]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-qi="${index}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [index, items.length]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    getEditorView()?.focus();
  };

  const pick = (item: QuickItem) => {
    setOpen(false);
    if (item.kind === "tab") {
      setActiveTab(item.id);
      getEditorView()?.focus();
    } else {
      void openPath(item.path);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!items.length) return;
      setIndex((i) => (i + 1) % items.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      setIndex((i) => (i - 1 + items.length) % items.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = items[index];
      if (item) pick(item);
    }
  };

  return (
    <div className="overlay quick-open-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="quick-open" role="dialog" aria-label={t("quickOpen.title")} onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className="quick-open-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("quickOpen.placeholder", { mod: MOD })}
          aria-autocomplete="list"
          aria-controls="quick-open-list"
        />
        <div className="quick-open-list" id="quick-open-list" ref={listRef} role="listbox">
          {items.length === 0 ? (
            <div className="quick-open-empty muted">{t("quickOpen.empty")}</div>
          ) : (
            items.map((item, i) => (
              <div
                key={item.kind === "tab" ? `tab-${item.id}` : `recent-${item.path}`}
                data-qi={i}
                role="option"
                aria-selected={i === index}
                className={"quick-open-row" + (i === index ? " active" : "")}
                onMouseEnter={() => setIndex(i)}
                onClick={() => pick(item)}
              >
                <span className="quick-open-badge">
                  {item.kind === "tab" ? t("quickOpen.badgeOpen") : t("quickOpen.badgeRecent")}
                </span>
                <span className="quick-open-label">{item.label}</span>
                <span className="quick-open-detail muted" title={item.detail}>
                  {item.detail}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
