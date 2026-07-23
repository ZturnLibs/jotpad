import { useEffect, useRef, useState } from "react";
import {
  CONTEXT_MENU_IDS,
  getMenuModel,
  runMenuAction,
  type MenuItemModel,
} from "@/lib/menuActions";

interface Pos {
  x: number;
  y: number;
}

export function ContextMenu() {
  const [pos, setPos] = useState<Pos | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(".cm-content") ||
        target.closest(".cm-editor") ||
        target.closest(".cm-line")
      ) {
        e.preventDefault();
        setPos({
          x: Math.min(e.clientX, window.innerWidth - 230),
          y: Math.min(e.clientY, window.innerHeight - 340),
        });
      }
    };
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", (e2) => {
      if (e2.key === "Escape") close();
    });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  if (!pos) return null;

  const model = getMenuModel();
  const byId = new Map(model.edit.map((i) => [i.id, i]));
  const items: (MenuItemModel | { sep: true })[] = CONTEXT_MENU_IDS.map((id) =>
    id === "sep" ? { sep: true as const } : byId.get(id),
  ).filter(Boolean) as (MenuItemModel | { sep: true })[];

  return (
    <div className="context-menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        "sep" in it ? (
          <div className="menu-sep" key={i} />
        ) : (
          <div
            key={i}
            className={"menu-row" + (it.disabled ? " disabled" : "")}
            onClick={() => {
              setPos(null);
              if (it.id) runMenuAction(it.id);
            }}
          >
            <span className="check" />
            <span className="label">{it.label}</span>
            {it.shortcut ? <span className="shortcut">{it.shortcut}</span> : null}
          </div>
        ),
      )}
    </div>
  );
}
