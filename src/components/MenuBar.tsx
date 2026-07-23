import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { getMenuModel, runMenuAction, type MenuItemModel } from "@/lib/menuActions";
import { Icon } from "./icons";

export function MenuBar() {
  const menuOpen = useStore((s) => s.menuOpen);
  const setMenuOpen = useStore((s) => s.setMenuOpen);
  // Subscribe to slices that affect menu labels / check marks so we re-render.
  useStore((s) => s.settings);
  useStore((s) => s.activeTabId);
  useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.encoding);
  useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.lineEnding);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverSub, setHoverSub] = useState<string | null>(null);

  const model = getMenuModel();
  const menus: { key: "file" | "edit" | "view"; label: string; items: MenuItemModel[] }[] = [
    { key: "file", label: model.fileLabel, items: model.file },
    { key: "edit", label: model.editLabel, items: model.edit },
    { key: "view", label: model.viewLabel, items: model.view },
  ];

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, setMenuOpen]);

  return (
    <div className="menubar" ref={wrapRef}>
      {menus.map((m) => (
        <button
          key={m.key}
          className={"menu-item" + (menuOpen === m.key ? " open" : "")}
          onClick={() => {
            setMenuOpen(menuOpen === m.key ? null : m.key);
            setHoverSub(null);
          }}
          onMouseEnter={() => {
            if (menuOpen && menuOpen !== m.key) {
              setMenuOpen(m.key);
              setHoverSub(null);
            }
          }}
        >
          {m.label}
        </button>
      ))}

      {menuOpen && (
        <div className="menu-dropdown" style={{ left: dropdownLeft(menuOpen) }} role="menu">
          {menus
            .find((m) => m.key === menuOpen)!
            .items.map((item, i) => (
              <MenuRow
                key={item.id ?? i}
                item={item}
                hoverSub={hoverSub}
                setHoverSub={setHoverSub}
                onPick={() => {
                  setMenuOpen(null);
                  setHoverSub(null);
                }}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function dropdownLeft(key: string): number {
  const idx = { file: 0, edit: 1, view: 2 }[key] ?? 0;
  return 6 + idx * 52;
}

function MenuRow({
  item,
  hoverSub,
  setHoverSub,
  onPick,
}: {
  item: MenuItemModel;
  hoverSub: string | null;
  setHoverSub: (v: string | null) => void;
  onPick: () => void;
}) {
  if (item.sep) return <div className="menu-sep" />;

  const pick = () => {
    if (item.disabled) return;
    onPick();
    if (item.id) runMenuAction(item.id);
  };

  if (item.submenu) {
    const open = hoverSub === item.id;
    return (
      <div className="menu-row" onMouseEnter={() => setHoverSub(item.id!)}>
        <span className="check" />
        <span className="label">{item.label}</span>
        <span className="sub-arrow">
          <Icon name="chevronRight" size={14} />
        </span>
        {open && (
          <div className="menu-submenu">
            {item.submenu.map((sub, i) => (
              <MenuRow
                key={sub.id ?? i}
                item={sub}
                hoverSub={null}
                setHoverSub={() => {}}
                onPick={onPick}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={"menu-row" + (item.disabled ? " disabled" : "")}
      onClick={pick}
      onMouseEnter={() => setHoverSub(null)}
    >
      <span className="check">{item.checked ? <Icon name="check" size={14} /> : null}</span>
      <span className="label">{item.label}</span>
      {item.shortcut ? <span className="shortcut">{item.shortcut}</span> : null}
    </div>
  );
}
