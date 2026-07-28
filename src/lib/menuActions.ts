// Shared menu model + action dispatcher.
// Consumed by the custom in-window MenuBar (Windows/Linux) and the native
// macOS menu bar (via platformMenu.ts -> Rust muda).
import { undo, redo } from "@codemirror/commands";
import { findNext, findPrevious } from "@codemirror/search";
import { useStore } from "@/store/useStore";
import { translate } from "@/lib/i18n";
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
import { clamp, MOD, platform } from "@/lib/utils";
import { loadPrintSetup, pageSizeCss } from "@/lib/print";
import { basename } from "@/lib/backend";
import {
  ENCODINGS,
  LINE_ENDINGS,
  LOCALES,
  type Encoding,
  type LineEnding,
  type ThemeMode,
} from "@/types";

export interface MenuItemModel {
  id?: string;
  label?: string;
  /** Display shortcut text (platform-aware, e.g. "Ctrl+N"). */
  shortcut?: string;
  /** Native accelerator (e.g. "CommandOrControl+N"). */
  accel?: string;
  /**
   * Use Tauri/OS PredefinedMenuItem instead of a custom click handler.
   * Needed for cut/copy/paste/selectAll so Cmd/Ctrl+V etc. hit the webview
   * responder chain (no Web Clipboard "Paste" prompt).
   */
  predefined?: "cut" | "copy" | "paste" | "selectAll";
  checked?: boolean;
  disabled?: boolean;
  sep?: boolean;
  submenu?: MenuItemModel[];
}

export interface MenuModel {
  fileLabel: string;
  editLabel: string;
  viewLabel: string;
  file: MenuItemModel[];
  edit: MenuItemModel[];
  view: MenuItemModel[];
}

const isMac = platform() === "macos";

/** accelerator helper */
const A = (k: string) => `CmdOrCtrl+${k}`;

/** Open a new independent application window. */
async function createNewWindow(): Promise<void> {
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = `win-${Date.now()}`;
    const isMac = platform() === "macos";
    const win = new WebviewWindow(label, {
      title: "Jotpad",
      width: 980,
      height: 660,
      minWidth: 600,
      minHeight: 400,
      center: true,
      ...(isMac
        ? { titleBarStyle: "overlay" as const, hiddenTitle: true }
        : {}),
    });
    win.once("tauri://error", (e) => console.error("new window error", e));
  } catch (e) {
    console.error("createNewWindow failed", e);
  }
}

function printDoc(): void {
  const view = getEditorView();
  if (!view) return;
  const text = view.state.doc.toString();
  const ps = loadPrintSetup();
  const sizeCss = pageSizeCss(ps);
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
    `<html><head><title>${document.title}</title><style>@page{size:${sizeCss};margin:${ps.margin}mm}html,body{margin:0;padding:0}pre{white-space:pre-wrap;word-wrap:break-word;font:14px/1.6 Consolas,Menlo,monospace;padding:0}</style></head><body></body></html>`,
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

/** Build the menu model from current store state (i18n + check marks). */
export function getMenuModel(): MenuModel {
  const s = useStore.getState();
  const locale = s.settings.locale;
  const t = (k: string, p?: Record<string, string | number>) => translate(locale, k, p);
  const activeTab = s.activeTab();

  const recent = s.recentFiles;
  const recentItems: MenuItemModel[] =
    recent.length === 0
      ? [{ id: "recentEmpty", label: t("file.recentEmpty"), disabled: true }]
      : [
          ...recent.slice(0, 12).map((p, i) => ({
            id: `recent-${i}`,
            label: basename(p),
          })),
          { sep: true },
          { id: "clearRecent", label: t("file.clearRecent") },
        ];

  const file: MenuItemModel[] = [
    { id: "new", label: t("file.new"), shortcut: `${MOD}+N`, accel: A("N") },
    {
      id: "newWindow",
      label: t("file.newWindow"),
      shortcut: `${MOD}+Shift+N`,
      accel: A("Shift+N"),
    },
    { id: "open", label: t("file.open"), shortcut: `${MOD}+O`, accel: A("O") },
    {
      id: "recent",
      label: t("file.recent"),
      submenu: recentItems,
    },
    { sep: true },
    { id: "save", label: t("file.save"), shortcut: `${MOD}+S`, accel: A("S") },
    {
      id: "saveAs",
      label: t("file.saveAs"),
      shortcut: `${MOD}+Shift+S`,
      accel: A("Shift+S"),
    },
    { sep: true },
    { id: "pageSetup", label: t("file.pageSetup") },
    { id: "print", label: t("file.print"), shortcut: `${MOD}+P`, accel: A("P") },
    { sep: true },
    { id: "about", label: t("misc.about") },
    { id: "exit", label: t("file.exit"), accel: A("Q") },
  ];

  const edit: MenuItemModel[] = [
    { id: "undo", label: t("edit.undo"), shortcut: `${MOD}+Z`, accel: A("Z") },
    {
      id: "redo",
      label: t("edit.redo"),
      shortcut: isMac ? `${MOD}+Shift+Z` : `${MOD}+Y`,
      accel: isMac ? A("Shift+Z") : A("Y"),
    },
    { sep: true },
    // Native predefined items: OS owns accelerators + clipboard.
    { id: "cut", predefined: "cut", label: t("edit.cut"), shortcut: `${MOD}+X` },
    { id: "copy", predefined: "copy", label: t("edit.copy"), shortcut: `${MOD}+C` },
    { id: "paste", predefined: "paste", label: t("edit.paste"), shortcut: `${MOD}+V` },
    // No accelerator — Delete must reach the editor's native keymap.
    { id: "delete", label: t("edit.delete"), shortcut: "Del" },
    { sep: true },
    { id: "find", label: t("edit.find"), shortcut: `${MOD}+F`, accel: A("F") },
    { id: "findNext", label: t("edit.findNext"), shortcut: "F3", accel: "F3" },
    { id: "findPrev", label: t("edit.findPrev"), shortcut: "Shift+F3", accel: "Shift+F3" },
    {
      id: "replace",
      label: t("edit.replace"),
      shortcut: isMac ? `${MOD}+Option+F` : `${MOD}+H`,
      accel: isMac ? A("Alt+F") : A("H"),
    },
    { id: "goto", label: t("edit.goto"), shortcut: `${MOD}+G`, accel: A("G") },
    { sep: true },
    {
      id: "selectAll",
      predefined: "selectAll",
      label: t("edit.selectAll"),
      shortcut: `${MOD}+A`,
    },
    { id: "timeDate", label: t("edit.timeDate"), shortcut: "F5", accel: "F5" },
  ];

  const view: MenuItemModel[] = [
    {
      id: "zoom",
      label: t("view.zoom"),
      submenu: [
        { id: "zoomIn", label: t("view.zoomIn"), shortcut: `${MOD}+Plus`, accel: A("=") },
        { id: "zoomOut", label: t("view.zoomOut"), shortcut: `${MOD}+-`, accel: A("-") },
        { sep: true },
        { id: "zoomReset", label: t("view.zoomReset"), shortcut: `${MOD}+0`, accel: A("0") },
      ],
    },
    { sep: true },
    {
      id: "alwaysOnTop",
      label: t("view.alwaysOnTop"),
      checked: s.alwaysOnTop,
      shortcut: `${MOD}+Shift+T`,
      accel: A("Shift+T"),
    },
    {
      id: "wordWrap",
      label: t("view.wordWrap"),
      checked: s.settings.wordWrap,
    },
    {
      id: "lineNumbers",
      label: t("view.lineNumbers"),
      checked: s.settings.showLineNumbers,
    },
    {
      id: "statusBar",
      label: t("view.statusBar"),
      checked: s.settings.showStatusBar,
    },
    {
      id: "theme",
      label: t("view.theme"),
      submenu: (["light", "dark", "system"] as ThemeMode[]).map((m) => ({
        id: `theme-${m}`,
        label:
          m === "light" ? t("view.themeLight") : m === "dark" ? t("view.themeDark") : t("view.themeSystem"),
        checked: s.settings.theme === m,
      })),
    },
    {
      id: "language",
      label: t("view.language"),
      submenu: LOCALES.map((l) => ({
        id: `lang-${l}`,
        label: l === "zh-CN" ? "中文（简体）" : "English",
        checked: s.settings.locale === l,
      })),
    },
    {
      id: "encoding",
      label: t("view.encoding"),
      submenu: ENCODINGS.map((e: Encoding) => ({
        id: `enc-${e}`,
        label: e,
        checked: activeTab?.encoding === e,
      })),
    },
    {
      id: "lineEnding",
      label: t("view.lineEnding"),
      submenu: LINE_ENDINGS.map((le: LineEnding) => ({
        id: `le-${le}`,
        label: le,
        checked: activeTab?.lineEnding === le,
      })),
    },
    { sep: true },
    { id: "settings", label: t("toolbar.settings"), shortcut: `${MOD}+,`, accel: A(",") },
  ];

  return {
    fileLabel: t("menu.file"),
    editLabel: t("menu.edit"),
    viewLabel: t("menu.view"),
    file,
    edit,
    view,
  };
}

/** Execute a menu action by id (shared by all menu surfaces). */
export function runMenuAction(id: string): void {
  const s = useStore.getState();
  const v = getEditorView();

  switch (id) {
    case "new":
      s.newTab();
      break;
    case "newWindow":
      void createNewWindow();
      break;
    case "closeTab":
      if (s.activeTabId) s.requestClose(s.activeTabId);
      break;
    case "open":
      void s.openDialog();
      break;
    case "clearRecent":
      s.clearRecent();
      break;
    case "save":
      if (s.activeTabId) void s.saveTab(s.activeTabId);
      break;
    case "saveAs":
      if (s.activeTabId) void s.saveAsTab(s.activeTabId);
      break;
    case "print":
      printDoc();
      break;
    case "pageSetup":
      s.setPageSetupOpen(true);
      break;
    case "about":
      s.setAboutOpen(true);
      break;
    case "exit":
      void s.requestExit();
      break;

    case "undo":
      if (v) { undo(v); v.focus(); }
      break;
    case "redo":
      if (v) { redo(v); v.focus(); }
      break;
    case "cut":
      if (v) cmCut(v);
      break;
    case "copy":
      if (v) cmCopy(v);
      break;
    case "paste":
      if (v) void cmPaste(v);
      break;
    case "delete":
      if (v) cmDelete(v);
      break;
    case "find":
      s.setFindOpen(true);
      break;
    case "findNext":
      if (v) { findNext(v); v.focus(); }
      break;
    case "findPrev":
      if (v) { findPrevious(v); v.focus(); }
      break;
    case "replace":
      s.setReplaceOpen(true);
      break;
    case "goto":
      s.setGotoOpen(true);
      break;
    case "selectAll":
      if (v) selectAll(v);
      break;
    case "timeDate":
      if (v) insertAtCursor(v, timeDateString(s.settings.locale));
      break;

    case "zoomIn":
      s.setSettings({ zoom: clamp(s.settings.zoom + 10, 30, 500) });
      break;
    case "zoomOut":
      s.setSettings({ zoom: clamp(s.settings.zoom - 10, 30, 500) });
      break;
    case "zoomReset":
      s.setSettings({ zoom: 100 });
      break;
    case "alwaysOnTop":
      void s.toggleAlwaysOnTop();
      break;
    case "wordWrap":
      s.setSettings({ wordWrap: !s.settings.wordWrap });
      break;
    case "lineNumbers":
      s.setSettings({ showLineNumbers: !s.settings.showLineNumbers });
      break;
    case "statusBar":
      s.setSettings({ showStatusBar: !s.settings.showStatusBar });
      break;
    case "settings":
      s.setSettingsOpen(true);
      break;

    case "theme-light":
      s.setSettings({ theme: "light" });
      break;
    case "theme-dark":
      s.setSettings({ theme: "dark" });
      break;
    case "theme-system":
      s.setSettings({ theme: "system" });
      break;
    case "lang-zh-CN":
      s.setSettings({ locale: "zh-CN" });
      break;
    case "lang-en":
      s.setSettings({ locale: "en" });
      break;
    default:
      if (id.startsWith("recent-")) {
        const idx = parseInt(id.slice(7), 10);
        const path = s.recentFiles[idx];
        if (path) void s.openPath(path);
      } else if (id.startsWith("enc-")) {
        s.setEncoding(id.slice(4) as Encoding);
      } else if (id.startsWith("le-")) {
        s.setLineEnding(id.slice(3) as LineEnding);
      }
  }
}

/** IDs shown in the editor context menu (subset of edit actions). */
export const CONTEXT_MENU_IDS = [
  "cut",
  "copy",
  "paste",
  "delete",
  "sep",
  "find",
  "replace",
  "sep",
  "selectAll",
  "timeDate",
];
