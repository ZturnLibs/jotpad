import { useEffect, useRef, useState } from "react";
import { undo, redo } from "@codemirror/commands";
import { findNext, findPrevious } from "@codemirror/search";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { getEditorView } from "@/lib/editorRef";
import {
  cmCopy,
  cmCut,
  cmDelete,
  cmPaste,
  insertAtCursor,
  selectAll,
  timeDateString,
} from "@/lib/edit";
import {
  ENCODINGS,
  LINE_ENDINGS,
  LOCALES,
  type Encoding,
  type LineEnding,
  type Locale,
  type ThemeMode,
} from "@/types";
import { Icon } from "./icons";
import { MOD, ALT } from "@/lib/utils";

interface Item {
  id?: string;
  label?: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  sep?: boolean;
  onClick?: () => void;
  submenu?: Item[];
}

const THEME_OPTIONS: { mode: ThemeMode; key: string }[] = [
  { mode: "light", key: "view.themeLight" },
  { mode: "dark", key: "view.themeDark" },
  { mode: "system", key: "view.themeSystem" },
];

const LOCALE_NAMES: Record<Locale, string> = {
  "zh-CN": "中文（简体）",
  en: "English",
};

function printDoc(): void {
  const view = getEditorView();
  if (!view) return;
  const text = view.state.doc.toString();
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const cw = iframe.contentWindow;
  if (!cw) return;
  const doc = cw.document;
  doc.open();
  doc.write(
    `<html><head><title>${document.title}</title><style>body{margin:24px}pre{white-space:pre-wrap;word-wrap:break-word;font:14px/1.6 Consolas,Menlo,monospace}</style></head><body></body></html>`,
  );
  doc.close();
  const pre = doc.createElement("pre");
  pre.textContent = text;
  doc.body.appendChild(pre);
  cw.focus();
  setTimeout(() => {
    cw.print();
    setTimeout(() => document.body.removeChild(iframe), 500);
  }, 80);
}

export function MenuBar() {
  const t = useT();
  const menuOpen = useStore((s) => s.menuOpen);
  const setMenuOpen = useStore((s) => s.setMenuOpen);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverSub, setHoverSub] = useState<string | null>(null);

  const newTab = useStore((s) => s.newTab);
  const openDialog = useStore((s) => s.openDialog);
  const saveTab = useStore((s) => s.saveTab);
  const saveAsTab = useStore((s) => s.saveAsTab);
  const requestExit = useStore((s) => s.requestExit);
  const activeTabId = useStore((s) => s.activeTabId);
  const setFindOpen = useStore((s) => s.setFindOpen);
  const setReplaceOpen = useStore((s) => s.setReplaceOpen);
  const setGotoOpen = useStore((s) => s.setGotoOpen);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setEncoding = useStore((s) => s.setEncoding);
  const setLineEnding = useStore((s) => s.setLineEnding);
  const activeTab = useStore((s) => s.tabs.find((x) => x.id === s.activeTabId));

  // Close menu on outside click / escape.
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

  const run = (fn: () => void) => () => {
    setMenuOpen(null);
    setHoverSub(null);
    fn();
  };

  const withView = (fn: (v: NonNullable<ReturnType<typeof getEditorView>>) => void) =>
    run(() => {
      const v = getEditorView();
      if (v) fn(v);
    });

  const fileItems: Item[] = [
    { id: "new", label: t("file.new"), shortcut: `${MOD}+N`, onClick: run(() => newTab()) },
    { id: "open", label: t("file.open"), shortcut: `${MOD}+O`, onClick: run(() => openDialog()) },
    { sep: true },
    {
      id: "save",
      label: t("file.save"),
      shortcut: `${MOD}+S`,
      onClick: run(() => activeTabId && saveTab(activeTabId)),
    },
    {
      id: "saveAs",
      label: t("file.saveAs"),
      shortcut: `${MOD}+Shift+S`,
      onClick: run(() => activeTabId && saveAsTab(activeTabId)),
    },
    { sep: true },
    { id: "print", label: t("file.print"), shortcut: `${MOD}+P`, onClick: run(printDoc) },
    { sep: true },
    { id: "exit", label: t("file.exit"), onClick: run(() => requestExit()) },
  ];

  const editItems: Item[] = [
    { id: "undo", label: t("edit.undo"), shortcut: `${MOD}+Z`, onClick: withView((v) => undo(v)) },
    { id: "redo", label: t("edit.redo"), shortcut: `${MOD}+Y`, onClick: withView((v) => redo(v)) },
    { sep: true },
    { id: "cut", label: t("edit.cut"), shortcut: `${MOD}+X`, onClick: withView(cmCut) },
    { id: "copy", label: t("edit.copy"), shortcut: `${MOD}+C`, onClick: withView(cmCopy) },
    { id: "paste", label: t("edit.paste"), shortcut: `${MOD}+V`, onClick: withView(cmPaste) },
    { id: "delete", label: t("edit.delete"), shortcut: "Del", onClick: withView(cmDelete) },
    { sep: true },
    { id: "find", label: t("edit.find"), shortcut: `${MOD}+F`, onClick: run(() => setFindOpen(true)) },
    {
      id: "findNext",
      label: t("edit.findNext"),
      shortcut: "F3",
      onClick: withView((v) => findNext(v)),
    },
    {
      id: "findPrev",
      label: t("edit.findPrev"),
      shortcut: "Shift+F3",
      onClick: withView((v) => findPrevious(v)),
    },
    {
      id: "replace",
      label: t("edit.replace"),
      shortcut: platformReplaceKey(),
      onClick: run(() => setReplaceOpen(true)),
    },
    { id: "goto", label: t("edit.goto"), shortcut: `${MOD}+G`, onClick: run(() => setGotoOpen(true)) },
    { sep: true },
    { id: "selectAll", label: t("edit.selectAll"), shortcut: `${MOD}+A`, onClick: withView(selectAll) },
    {
      id: "timeDate",
      label: t("edit.timeDate"),
      shortcut: "F5",
      onClick: withView((v) => insertAtCursor(v, timeDateString(settings.locale))),
    },
  ];

  const viewItems: Item[] = [
    {
      id: "zoom",
      label: t("view.zoom"),
      submenu: [
        {
          id: "zoomIn",
          label: t("view.zoomIn"),
          shortcut: `${MOD}+Plus`,
          onClick: run(() => setSettings({ zoom: clampZoom(settings.zoom + 10) })),
        },
        {
          id: "zoomOut",
          label: t("view.zoomOut"),
          shortcut: `${MOD}+-`,
          onClick: run(() => setSettings({ zoom: clampZoom(settings.zoom - 10) })),
        },
        { sep: true },
        {
          id: "zoomReset",
          label: t("view.zoomReset"),
          shortcut: `${MOD}+0`,
          onClick: run(() => setSettings({ zoom: 100 })),
        },
      ],
    },
    { sep: true },
    {
      id: "wordWrap",
      label: t("view.wordWrap"),
      checked: settings.wordWrap,
      onClick: run(() => setSettings({ wordWrap: !settings.wordWrap })),
    },
    {
      id: "statusBar",
      label: t("view.statusBar"),
      checked: settings.showStatusBar,
      onClick: run(() => setSettings({ showStatusBar: !settings.showStatusBar })),
    },
    {
      id: "theme",
      label: t("view.theme"),
      submenu: THEME_OPTIONS.map((o) => ({
        id: "theme-" + o.mode,
        label: t(o.key),
        checked: settings.theme === o.mode,
        onClick: run(() => setSettings({ theme: o.mode })),
      })),
    },
    {
      id: "language",
      label: t("view.language"),
      submenu: LOCALES.map((l) => ({
        id: "lang-" + l,
        label: LOCALE_NAMES[l],
        checked: settings.locale === l,
        onClick: run(() => setSettings({ locale: l })),
      })),
    },
    {
      id: "encoding",
      label: t("view.encoding"),
      submenu: ENCODINGS.map((e: Encoding) => ({
        id: "enc-" + e,
        label: e,
        checked: activeTab?.encoding === e,
        onClick: run(() => setEncoding(e)),
      })),
    },
    {
      id: "lineEnding",
      label: t("view.lineEnding"),
      submenu: LINE_ENDINGS.map((le: LineEnding) => ({
        id: "le-" + le,
        label: `${le}`,
        checked: activeTab?.lineEnding === le,
        onClick: run(() => setLineEnding(le)),
      })),
    },
  ];

  const menus: { key: "file" | "edit" | "view"; label: string; items: Item[] }[] = [
    { key: "file", label: t("menu.file"), items: fileItems },
    { key: "edit", label: t("menu.edit"), items: editItems },
    { key: "view", label: t("menu.view"), items: viewItems },
  ];

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
                t={t}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function dropdownLeft(key: string): number {
  // Approximate: each menu title ~50px wide, 6px padding.
  const idx = { file: 0, edit: 1, view: 2 }[key] ?? 0;
  return 6 + idx * 52;
}

function clampZoom(v: number): number {
  return Math.min(500, Math.max(30, v));
}

function platformReplaceKey(): string {
  return MOD === "Cmd" ? `${MOD}+${ALT}+F` : `${MOD}+H`;
}

function MenuRow({
  item,
  hoverSub,
  setHoverSub,
  t,
}: {
  item: Item;
  hoverSub: string | null;
  setHoverSub: (v: string | null) => void;
  t: (k: string) => string;
}) {
  if (item.sep) return <div className="menu-sep" />;

  if (item.submenu) {
    const open = hoverSub === item.id;
    return (
      <div
        className="menu-row"
        onMouseEnter={() => setHoverSub(item.id!)}
      >
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
                t={t}
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
      onClick={item.disabled ? undefined : item.onClick}
      onMouseEnter={() => setHoverSub(null)}
    >
      <span className="check">{item.checked ? <Icon name="check" size={14} /> : null}</span>
      <span className="label">{item.label}</span>
      {item.shortcut ? <span className="shortcut">{item.shortcut}</span> : null}
    </div>
  );
}
