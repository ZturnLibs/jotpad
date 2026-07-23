import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { basename } from "@/lib/backend";
import { Icon } from "./icons";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const newTab = useStore((s) => s.newTab);
  const requestClose = useStore((s) => s.requestClose);
  const renameTab = useStore((s) => s.renameTab);
  const t = useT();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const skipCommit = useRef(false);
  /** Ignore blur right after entering rename (dblclick can steal focus). */
  const armedAt = useRef(0);
  /** Fallback when OS/titlebar swallows native dblclick. */
  const lastClick = useRef<{ id: string; at: number } | null>(null);

  const tabLabel = useCallback(
    (tab: { filePath: string | null }) =>
      tab.filePath ? basename(tab.filePath) : t("tab.untitled"),
    [t],
  );

  const scrollActiveIntoView = useCallback(() => {
    const root = scrollRef.current;
    if (!root || !activeTabId) return;
    const el = root.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  useEffect(() => {
    scrollActiveIntoView();
    const id = window.requestAnimationFrame(scrollActiveIntoView);
    return () => window.cancelAnimationFrame(id);
  }, [activeTabId, tabs.length, scrollActiveIntoView]);

  useEffect(() => {
    if (!editingId) return;
    const id = window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const dot = draft.lastIndexOf(".");
      if (dot > 0) el.setSelectionRange(0, dot);
      else el.select();
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  const startRename = (id: string, filePath: string) => {
    skipCommit.current = false;
    armedAt.current = Date.now() + 250;
    setEditingId(id);
    setDraft(basename(filePath));
  };

  const cancelRename = () => {
    skipCommit.current = true;
    setEditingId(null);
    setDraft("");
  };

  const commitRename = async () => {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    if (Date.now() < armedAt.current) {
      inputRef.current?.focus();
      return;
    }
    const id = editingId;
    if (!id) return;
    const name = draft;
    setEditingId(null);
    await renameTab(id, name);
  };

  return (
    <div className="tabs">
      <div className="tabs-drag" data-tauri-drag-region />
      <div className="tabs-scroll" ref={scrollRef} role="tablist" aria-orientation="vertical">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const title = tabLabel(tab);
          const editing = editingId === tab.id;
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              role="tab"
              className={
                "tab" +
                (active ? " active" : "") +
                (editing ? " editing" : "") +
                (tab.dirty ? " dirty" : "")
              }
              onClick={() => {
                if (editing) return;
                setActiveTab(tab.id);
                if (!tab.filePath) {
                  lastClick.current = null;
                  return;
                }
                const now = Date.now();
                const prev = lastClick.current;
                if (prev && prev.id === tab.id && now - prev.at < 450) {
                  lastClick.current = null;
                  startRename(tab.id, tab.filePath);
                } else {
                  lastClick.current = { id: tab.id, at: now };
                }
              }}
              onDoubleClick={(e) => {
                if (!tab.filePath || editing) return;
                e.preventDefault();
                e.stopPropagation();
                lastClick.current = null;
                setActiveTab(tab.id);
                startRename(tab.id, tab.filePath);
              }}
              onAuxClick={(e) => {
                if (e.button === 1) requestClose(tab.id);
              }}
              title={
                tab.dirty
                  ? `${tab.filePath ?? title} — ${t("tab.unsaved")}`
                  : (tab.filePath ?? title)
              }
              aria-current={active ? "page" : undefined}
              aria-selected={active}
            >
              {editing ? (
                <input
                  ref={inputRef}
                  className="tab-title-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      armedAt.current = 0;
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  aria-label={t("tab.rename")}
                />
              ) : (
                <span className="tab-title">{title}</span>
              )}
              <span className="tab-trailing">
                {tab.dirty && (
                  <span
                    className="tab-dot"
                    title={t("tab.unsaved")}
                    aria-label={t("tab.unsaved")}
                    role="img"
                  />
                )}
                <button
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editing) cancelRename();
                    requestClose(tab.id);
                  }}
                  title={t("tab.close")}
                  aria-label={t("tab.close")}
                >
                  <Icon name="close" size={14} />
                </button>
              </span>
            </div>
          );
        })}
      </div>

      <button
        className="tab-new"
        onClick={() => newTab()}
        title={t("tab.new")}
        aria-label={t("tab.new")}
      >
        <Icon name="plus" size={16} />
        <span className="tab-new-label">{t("tab.new")}</span>
      </button>
    </div>
  );
}
