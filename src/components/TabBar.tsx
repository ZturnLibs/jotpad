import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { basename, clipboardWriteText, nativeMessage, revealInFolder } from "@/lib/backend";
import { platform } from "@/lib/utils";
import { Icon } from "./icons";
import { PageDragRegion } from "./PageDragRegion";

interface CtxMenu {
  tabId: string;
  x: number;
  y: number;
}

type CtxAction = "copyPath" | "rename" | "reveal" | "delete" | "pin" | "close" | "closeOthers";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const pinnedPaths = useStore((s) => s.pinnedPaths);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const newTab = useStore((s) => s.newTab);
  const requestClose = useStore((s) => s.requestClose);
  const renameTab = useStore((s) => s.renameTab);
  const deleteTabFile = useStore((s) => s.deleteTabFile);
  const doCloseTabs = useStore((s) => s.doCloseTabs);
  const moveTab = useStore((s) => s.moveTab);
  const t = useT();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [filter, setFilter] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ overId: string; place: "before" | "after" } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const skipCommit = useRef(false);
  /** Ignore blur right after entering rename (dblclick can steal focus). */
  const armedAt = useRef(0);
  /** Fallback when OS/titlebar swallows native dblclick. */
  const lastClick = useRef<{ id: string; at: number } | null>(null);

  // ---- 指针拖动排序 ----
  // 不用 HTML5 DnD：Tauri 的原生文件拖放处理（dragDropEnabled）会拦截 WebView
  // 内的 dragover/drop，页面内拖拽在打包应用里失效，故用指针事件自绘。
  const dragIdRef = useRef<string | null>(null);
  const dropRef = useRef<{ overId: string; place: "before" | "after" } | null>(null);
  const dragPt = useRef<{ x: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  /** 拖动结束后吞掉紧随的 click（指针拖动松手仍会派发 click）。 */
  const suppressClick = useRef(false);

  const pinnedSet = useMemo(() => new Set(pinnedPaths), [pinnedPaths]);

  const tabLabel = useCallback(
    (tab: { filePath: string | null }) =>
      tab.filePath ? basename(tab.filePath) : t("tab.untitled"),
    [t],
  );

  /** 由指针坐标计算落点：标签上/下半区 → 前/后；列表空白区 → 本组末尾；跨组/越界 → 无。 */
  const updateDropFromPoint = useCallback((srcId: string, x: number, y: number) => {
    const { tabs: all, pinnedPaths } = useStore.getState();
    const src = all.find((t) => t.id === srcId);
    if (!src) return;
    const pinned = new Set(pinnedPaths);
    const isPinned = (t: { filePath: string | null }) => !!t.filePath && pinned.has(t.filePath);

    const apply = (next: { overId: string; place: "before" | "after" } | null) => {
      dropRef.current = next;
      setDrop((prev) =>
        prev?.overId === next?.overId && prev?.place === next?.place ? prev : next,
      );
    };

    const root = scrollRef.current;
    const hit = document.elementFromPoint(x, y);
    const tabEl = hit ? (hit.closest(".tab") as HTMLElement | null) : null;
    if (tabEl && root && root.contains(tabEl)) {
      const overId = tabEl.dataset.tabId ?? "";
      const over = overId && overId !== srcId ? all.find((t) => t.id === overId) : undefined;
      if (over && isPinned(src) === isPinned(over)) {
        const r = tabEl.getBoundingClientRect();
        const place = y < r.top + r.height / 2 ? "before" : "after";
        apply({ overId, place });
        return;
      }
      apply(null);
      return;
    }
    // 悬在列表空白区：追加到本组（置顶/普通）末尾
    if (root) {
      const r = root.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        for (let i = all.length - 1; i >= 0; i--) {
          const t = all[i];
          if (t.id !== src.id && isPinned(t) === isPinned(src)) {
            apply({ overId: t.id, place: "after" });
            return;
          }
        }
      }
    }
    apply(null);
  }, []);

  const makeGhost = (el: HTMLElement) => {
    const g = el.cloneNode(true) as HTMLElement;
    g.className = "tab tab-ghost" + (el.classList.contains("active") ? " active" : "");
    const r = el.getBoundingClientRect();
    g.style.left = `${r.left}px`;
    g.style.width = `${r.width}px`;
    g.style.top = `${r.top}px`;
    document.body.appendChild(g);
    ghostRef.current = g;
  };

  const moveGhost = (y: number) => {
    const g = ghostRef.current;
    if (g) g.style.top = `${y - g.offsetHeight / 2}px`;
  };

  const removeGhost = () => {
    ghostRef.current?.remove();
    ghostRef.current = null;
  };

  const endDrag = () => {
    dragIdRef.current = null;
    dropRef.current = null;
    dragPt.current = null;
    setDragId(null);
    setDrop(null);
    document.body.classList.remove("tab-dragging");
    removeGhost();
  };

  /** 按下即挂监听；位移超阈值才算拖动（不影响单击/双击重命名）。 */
  const beginPressTracking = (
    id: string,
    el: HTMLElement,
    pointerId: number,
    startX: number,
    startY: number,
  ) => {
    suppressClick.current = false;
    const onMove = (ev: PointerEvent) => {
      if (!dragIdRef.current) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        dragIdRef.current = id;
        suppressClick.current = true;
        // 捕获保证指针移出窗口后 move/up 仍送达本元素
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* 已松开等异常：忽略 */
        }
        document.body.classList.add("tab-dragging");
        window.getSelection()?.removeAllRanges();
        makeGhost(el);
        setDragId(id);
      }
      dragPt.current = { x: ev.clientX, y: ev.clientY };
      moveGhost(ev.clientY);
      updateDropFromPoint(id, ev.clientX, ev.clientY);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
      if (dragIdRef.current === id) {
        const target = commit ? dropRef.current : null;
        endDrag();
        if (target) moveTab(id, target.overId, target.place);
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onBlur = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
  };

  // 拖动期间：靠近列表上下缘持续滚动；内容从指针下滚过时同步刷新指示线。
  useEffect(() => {
    if (!dragId) return;
    let raf = 0;
    const tick = () => {
      const root = scrollRef.current;
      const pt = dragPt.current;
      if (root && pt) {
        const r = root.getBoundingClientRect();
        let v = 0;
        if (pt.y < r.top + 28) v = -10;
        else if (pt.y > r.bottom - 28) v = 10;
        if (v) {
          root.scrollBy({ top: v });
          if (dragIdRef.current) updateDropFromPoint(dragIdRef.current, pt.x, pt.y);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragId, updateDropFromPoint]);

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
      case "pin": {
        if (tab.filePath) useStore.getState().togglePinned(tab.filePath);
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
  const visibleTabs = (
    filterNorm
      ? tabs.filter((tab) => tabLabel(tab).toLowerCase().includes(filterNorm))
      : [...tabs]
  ).sort((a, b) => {
    const pa = a.filePath ? (pinnedSet.has(a.filePath) ? 0 : 1) : 1;
    const pb = b.filePath ? (pinnedSet.has(b.filePath) ? 0 : 1) : 1;
    return pa - pb; // 稳定排序：不改变同组内原有顺序
  });
  const showFilter = tabs.length >= 2;

  return (
    <div className="tabs">
      <PageDragRegion />
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
                (tab.dirty ? " dirty" : "") +
                (tab.readOnly ? " readonly" : "") +
                (tab.filePath && pinnedSet.has(tab.filePath) ? " pinned" : "") +
                (dragId === tab.id ? " dragging" : "") +
                (drop?.overId === tab.id
                  ? drop.place === "before"
                    ? " drop-before"
                    : " drop-after"
                  : "")
              }
              onPointerDown={(e) => {
                if (e.button !== 0 || editing || filterNorm) return;
                if (dragIdRef.current) return;
                if ((e.target as HTMLElement).closest(".tab-close, .tab-title-input")) return;
                beginPressTracking(tab.id, e.currentTarget, e.pointerId, e.clientX, e.clientY);
              }}
              onClick={() => {
                if (editing) return;
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
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
                <>
                  {tab.filePath && pinnedSet.has(tab.filePath) && (
                    <span className="tab-pin" title={t("tab.pinned")} role="img" aria-label={t("tab.pinned")}>
                      <Icon name="pin" size={12} />
                    </span>
                  )}
                  {tab.readOnly && (
                    <span
                      className="tab-lock"
                      title={t("view.readOnly")}
                      role="img"
                      aria-label={t("view.readOnly")}
                    >
                      <Icon name="lock" size={13} />
                    </span>
                  )}
                  <span className="tab-title">{title}</span>
                </>
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
          <div
            className={"menu-row" + (hasFile ? "" : " disabled")}
            role="menuitem"
            onClick={() => hasFile && void runCtxAction("pin")}
          >
            <span className="check" />
            <span className="label">{ctxTab?.filePath && pinnedSet.has(ctxTab.filePath) ? t("tab.unpin") : t("tab.pin")}</span>
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
