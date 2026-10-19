import {
  cloneElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

/** 列表空白区（最后一个标签下方）：追加到本组末尾的落点。 */
const BLANK_ID = "tabs-blank";

/**
 * 矩形相交面积最大者为落点标签；仅与空白区相交时命中 BLANK；列表外无落点。
 * 用 collisionRect（当前传感器实时更新的拖动项矩形），不用 pointerCoordinates——
 * 它会残留上一次指针位置、污染后续键盘拖动。
 */
const tabCollisionDetection: CollisionDetection = ({
  active,
  collisionRect,
  droppableContainers,
  droppableRects,
}) => {
  let blank = false;
  let bestTab: string | null = null;
  let bestOverlap = 0;
  for (const container of droppableContainers) {
    const id = String(container.id);
    if (id === String(active?.id)) continue;
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    const w = Math.min(collisionRect.right, rect.right) - Math.max(collisionRect.left, rect.left);
    const h = Math.min(collisionRect.bottom, rect.bottom) - Math.max(collisionRect.top, rect.top);
    if (w <= 0 || h <= 0) continue;
    if (id === BLANK_ID) {
      blank = true;
      continue;
    }
    const area = w * h;
    if (area > bestOverlap) {
      bestOverlap = area;
      bestTab = id;
    }
  }
  if (bestTab != null) return [{ id: bestTab }];
  if (blank) return [{ id: BLANK_ID }];
  return [];
};

/**
 * 把 dnd-kit sortable 能力挂到现有标签 div 上（cloneElement，DOM 无额外包裹层）。
 * 手动合并 listeners：跳过从关闭按钮/重命名输入框发起的拖动，并保留 role="tab" 等原有 aria。
 */
function SortableTab({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: ReactElement<Record<string, unknown>>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id,
    disabled,
  });
  const rawPointerDown = listeners?.onPointerDown as
    | ((event: ReactPointerEvent) => void)
    | undefined;
  return cloneElement(children, {
    ref: setNodeRef,
    style: { transform: CSS.Transform.toString(transform), transition },
    tabIndex: attributes.tabIndex,
    "aria-roledescription": "sortable",
    ...listeners,
    onPointerDown: (e: ReactPointerEvent) => {
      if ((e.target as HTMLElement).closest(".tab-close, .tab-title-input")) return;
      rawPointerDown?.(e);
    },
  });
}

/** 列表空白区落点：必须挂在 DndContext 内部才能注册。 */
function BlankDropZone() {
  const { setNodeRef } = useDroppable({ id: BLANK_ID });
  return <div ref={setNodeRef} className="tabs-blank" aria-hidden="true" />;
}

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
  const reorderTabs = useStore((s) => s.reorderTabs);
  const t = useT();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [filter, setFilter] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  /** 拖动结束时间：吞掉松手后紧随的 click（dnd-kit 不拦截 click）。 */
  const draggedAt = useRef(0);
  const skipCommit = useRef(false);
  /** Ignore blur right after entering rename (dblclick can steal focus). */
  const armedAt = useRef(0);
  /** Fallback when OS/titlebar swallows native dblclick. */
  const lastClick = useRef<{ id: string; at: number } | null>(null);

  const pinnedSet = useMemo(() => new Set(pinnedPaths), [pinnedPaths]);
  const isPinnedOf = useCallback(
    (tab: { filePath: string | null }) => !!tab.filePath && pinnedSet.has(tab.filePath),
    [pinnedSet],
  );

  const tabLabel = useCallback(
    (tab: { filePath: string | null }) =>
      tab.filePath ? basename(tab.filePath) : t("tab.untitled"),
    [t],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const dragTab = dragId ? (tabs.find((x) => x.id === dragId) ?? null) : null;
  /** 空白区落点高亮目标：拖动标签所在组的最后一个其他标签。 */
  const blankTargetId = dragTab
    ? ([...tabs].reverse().find((x) => x.id !== dragTab.id && isPinnedOf(x) === isPinnedOf(dragTab))
        ?.id ?? null)
    : null;

  const clearDragFeedback = () => {
    draggedAt.current = Date.now();
    setDragId(null);
    setOverId(null);
    document.body.classList.remove("tab-dragging");
  };

  const onDragStart = (e: DragStartEvent) => {
    setDragId(String(e.active.id));
    document.body.classList.add("tab-dragging");
  };

  const onDragOver = (e: DragOverEvent) => {
    setOverId(e.over ? String(e.over.id) : null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const activeId = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    clearDragFeedback();
    if (!over || over === activeId) return;
    const src = useStore.getState().tabs.find((x) => x.id === activeId);
    if (!src) return;
    const { tabs: all, pinnedPaths: pins } = useStore.getState();
    const pinned = new Set(pins);
    const isPinned = (x: { filePath: string | null }) => !!x.filePath && pinned.has(x.filePath);
    const srcPinned = isPinned(src);

    if (over === BLANK_ID) {
      // 空白区：追加到本组末尾
      for (let i = all.length - 1; i >= 0; i--) {
        const x = all[i];
        if (x.id !== activeId && isPinned(x) === srcPinned) {
          moveTab(activeId, x.id, "after");
          return;
        }
      }
      return;
    }

    const target = all.find((x) => x.id === over);
    if (!target || isPinned(target) !== srcPinned) return; // 置顶组与普通组不可互拖

    const display = [...all].sort((a, b) => {
      const pa = a.filePath ? (pinned.has(a.filePath) ? 0 : 1) : 1;
      const pb = b.filePath ? (pinned.has(b.filePath) ? 0 : 1) : 1;
      return pa - pb;
    });
    const from = display.findIndex((x) => x.id === activeId);
    const to = display.findIndex((x) => x.id === over);
    if (from < 0 || to < 0) return;
    reorderTabs(arrayMove(display, from, to).map((x) => x.id));
  };

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
      <DndContext
        sensors={sensors}
        collisionDetection={tabCollisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={clearDragFeedback}
      >
        <div className="tabs-scroll" ref={scrollRef} role="tablist" aria-orientation="vertical">
          {visibleTabs.length === 0 && filterNorm ? (
            <div className="tabs-filter-empty muted">{t("tab.filterEmpty")}</div>
          ) : null}
          <SortableContext
            items={visibleTabs.map((x) => x.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleTabs.map((tab) => {
              const active = tab.id === activeTabId;
              const title = tabLabel(tab);
              const editing = editingId === tab.id;
              const overThis =
                overId === tab.id && (!dragTab || isPinnedOf(dragTab) === isPinnedOf(tab));
              return (
                <SortableTab key={tab.id} id={tab.id} disabled={!!filterNorm || editing}>
                  <div
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
                      (overThis ? " drop-over" : "") +
                      (overId === BLANK_ID && blankTargetId === tab.id ? " drop-after" : "")
                    }
                    onClick={() => {
                      if (editing) return;
                      if (Date.now() - draggedAt.current < 150) return;
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
                </SortableTab>
              );
            })}
          </SortableContext>
          {/* 列表空白区：占满剩余高度的「追加到组末」落点 */}
          <BlankDropZone />
        </div>
        <DragOverlay dropAnimation={null}>
          {dragTab ? (
            <div
              className={"tab tab-ghost" + (dragTab.id === activeTabId ? " active" : "")}
            >
              {dragTab.filePath && pinnedSet.has(dragTab.filePath) && (
                <span className="tab-pin">
                  <Icon name="pin" size={12} />
                </span>
              )}
              {dragTab.readOnly && (
                <span className="tab-lock">
                  <Icon name="lock" size={13} />
                </span>
              )}
              <span className="tab-title">{tabLabel(dragTab)}</span>
              <span className="tab-trailing">
                {dragTab.dirty && <span className="tab-dot" />}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
