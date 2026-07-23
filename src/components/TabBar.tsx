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
  const [hasOverflow, setHasOverflow] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
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

  const measureOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 1px slack avoids flicker from subpixel rounding.
    setHasOverflow(el.scrollWidth > el.clientWidth + 1);
  }, []);

  const scrollActiveIntoView = useCallback(() => {
    const root = scrollRef.current;
    if (!root || !activeTabId) return;
    const el = root.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTabId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measureOverflow();
    const ro = new ResizeObserver(() => {
      measureOverflow();
      scrollActiveIntoView();
    });
    ro.observe(el);
    // Also watch content width changes (tabs added/removed/renamed).
    const mo = new MutationObserver(() => measureOverflow());
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", measureOverflow, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", measureOverflow);
    };
  }, [measureOverflow, scrollActiveIntoView, tabs.length]);

  useEffect(() => {
    scrollActiveIntoView();
    // Re-measure after layout settles from tab switch / open.
    const id = window.requestAnimationFrame(() => {
      measureOverflow();
      scrollActiveIntoView();
    });
    return () => window.cancelAnimationFrame(id);
  }, [activeTabId, tabs.length, measureOverflow, scrollActiveIntoView]);

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

  useEffect(() => {
    if (!hasOverflow) setOverflowOpen(false);
  }, [hasOverflow]);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

  // Vertical wheel → horizontal scroll on the tab strip.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

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

  const pickTab = (id: string) => {
    setOverflowOpen(false);
    setActiveTab(id);
  };

  return (
    <div className="tabs">
      <div className="tabs-scroll" ref={scrollRef}>
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const title = tabLabel(tab);
          const editing = editingId === tab.id;
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
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
      </button>

      {hasOverflow && (
        <div className="tabs-overflow" ref={overflowRef}>
          <button
            className={"tab-overflow-btn" + (overflowOpen ? " open" : "")}
            onClick={() => setOverflowOpen((v) => !v)}
            title={t("tab.more")}
            aria-label={t("tab.more")}
            aria-expanded={overflowOpen}
            aria-haspopup="listbox"
          >
            <Icon name="chevronDown" size={16} />
          </button>
          {overflowOpen && (
            <div className="tabs-overflow-menu" role="listbox">
              {tabs.map((tab) => {
                const active = tab.id === activeTabId;
                const title = tabLabel(tab);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={
                      "tabs-overflow-item" +
                      (active ? " active" : "") +
                      (tab.dirty ? " dirty" : "")
                    }
                    title={tab.filePath ?? title}
                    onClick={() => pickTab(tab.id)}
                  >
                    <span className="tabs-overflow-check">
                      {active ? <Icon name="check" size={14} /> : null}
                    </span>
                    <span className="tabs-overflow-label">{title}</span>
                    {tab.dirty && (
                      <span
                        className="tab-dot tabs-overflow-dot"
                        title={t("tab.unsaved")}
                        aria-label={t("tab.unsaved")}
                        role="img"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="tabs-spacer" data-tauri-drag-region />
    </div>
  );
}
