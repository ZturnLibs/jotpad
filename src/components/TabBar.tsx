import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { basename, clipboardWriteText, nativeMessage, revealInFolder } from "@/lib/backend";
import { platform } from "@/lib/utils";
import { Icon } from "./icons";

interface CtxMenu {
  tabId: string;
  x: number;
  y: number;
}

type CtxAction = "copyPath" | "rename" | "reveal" | "delete" | "close" | "closeOthers";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const newTab = useStore((s) => s.newTab);
  const requestClose = useStore((s) => s.requestClose);
  const renameTab = useStore((s) => s.renameTab);
  const deleteTabFile = useStore((s) => s.deleteTabFile);
  const doCloseTabs = useStore((s) => s.doCloseTabs);
  const t = useT();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [filter, setFilter] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
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

  const revealLabel = (() => {
    const p = platform();
    if (p === "windows") return t("tab.revealWin");
    if (p === "linux") return t("tab.revealLinux");
    return t("tab.reveal");
  })();

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

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    const onDown = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctx]);

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

  const runCtxAction = async (action: CtxAction) => {
    if (!ctx) return;
    const { tabId } = ctx;
    setCtx(null);
    const tab = useStore.getState().tabs.find((x) => x.id === tabId);
    if (!tab) return;

    switch (action) {
      case "copyPath": {
        if (!tab.filePath) {
          await nativeMessage("Jotpad", t("tab.noFile"));
          return;
        }
        try {
          await clipboardWriteText(tab.filePath);
        } catch (e) {
          await nativeMessage("Jotpad", String(e));
        }
        break;
      }
      case "rename": {
        if (!tab.filePath) {
          await nativeMessage("Jotpad", t("tab.noFile"));
          return;
        }
        setActiveTab(tabId);
        startRename(tabId, tab.filePath);
        break;
      }
      case "reveal": {
        if (!tab.filePath) {
          await nativeMessage("Jotpad", t("tab.noFile"));
          return;
        }
        try {
          await revealInFolder(tab.filePath);
        } catch (e) {
          await nativeMessage("Jotpad", String(e));
        }
        break;
      }
      case "delete": {
        await deleteTabFile(tabId);
        break;
      }
      case "close": {
        if (editingId === tabId) cancelRename();
        requestClose(tabId);
        break;
      }
      case "closeOthers": {
        const others = useStore
          .getState()
          .tabs.filter((x) => x.id !== tabId)
          .map((x) => x.id);
        if (!others.length) return;
        setActiveTab(tabId);
        const dirty = others.some(
          (id) => useStore.getState().tabs.find((x) => x.id === id)?.dirty,
        );
        if (dirty) {
          useStore.setState({ confirm: { kind: "close", tabIds: others } });
        } else {
          doCloseTabs(others);
        }
        break;
      }
    }
  };

  const ctxTab = ctx ? tabs.find((x) => x.id === ctx.tabId) : null;
  const hasFile = !!ctxTab?.filePath;
  const canCloseOthers = tabs.length > 1;

  const filterNorm = filter.trim().toLowerCase();
  const visibleTabs = filterNorm
    ? tabs.filter((tab) => tabLabel(tab).toLowerCase().includes(filterNorm))
    : tabs;
  const showFilter = tabs.length >= 2;

  return (
    <div className="tabs">
      <div className="tabs-drag" data-tauri-drag-region />
      {showFilter ? (
        <div className="tabs-filter">
          <input
            className="tabs-filter-input"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("tab.filterPlaceholder")}
            aria-label={t("tab.filterPlaceholder")}
          />
        </div>
      ) : null}
      <div className="tabs-scroll" ref={scrollRef} role="tablist" aria-orientation="vertical">
        {visibleTabs.length === 0 && filterNorm ? (
          <div className="tabs-filter-empty muted">{t("tab.filterEmpty")}</div>
        ) : null}
        {visibleTabs.map((tab) => {
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
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (editing) return;
                setActiveTab(tab.id);
                setCtx({
                  tabId: tab.id,
                  x: Math.min(e.clientX, window.innerWidth - 220),
                  y: Math.min(e.clientY, window.innerHeight - 260),
                });
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

      {ctx ? (
        <div
          className="context-menu"
          ref={ctxRef}
          style={{ left: ctx.x, top: ctx.y }}
          role="menu"
        >
          <div
            className={"menu-row" + (hasFile ? "" : " disabled")}
            role="menuitem"
            onClick={() => hasFile && void runCtxAction("copyPath")}
          >
            <span className="check" />
            <span className="label">{t("tab.copyPath")}</span>
          </div>
          <div
            className={"menu-row" + (hasFile ? "" : " disabled")}
            role="menuitem"
            onClick={() => hasFile && void runCtxAction("rename")}
          >
            <span className="check" />
            <span className="label">{t("tab.rename")}</span>
          </div>
          <div
            className={"menu-row" + (hasFile ? "" : " disabled")}
            role="menuitem"
            onClick={() => hasFile && void runCtxAction("reveal")}
          >
            <span className="check" />
            <span className="label">{revealLabel}</span>
          </div>
          <div className="menu-sep" />
          <div
            className={"menu-row" + (hasFile ? "" : " disabled")}
            role="menuitem"
            onClick={() => hasFile && void runCtxAction("delete")}
          >
            <span className="check" />
            <span className="label">{t("tab.deleteFile")}</span>
          </div>
          <div className="menu-sep" />
          <div className="menu-row" role="menuitem" onClick={() => void runCtxAction("close")}>
            <span className="check" />
            <span className="label">{t("tab.close")}</span>
          </div>
          <div
            className={"menu-row" + (canCloseOthers ? "" : " disabled")}
            role="menuitem"
            onClick={() => canCloseOthers && void runCtxAction("closeOthers")}
          >
            <span className="check" />
            <span className="label">{t("tab.closeOthers")}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
