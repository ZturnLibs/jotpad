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
import { clamp, platform } from "@/lib/utils";
import { sc } from "@/lib/shortcuts";
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
  windowLabel: string;
  file: MenuItemModel[];
  edit: MenuItemModel[];
  view: MenuItemModel[];
  window: MenuItemModel[];
}

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

  const sessions = s.sessions;
  const sessionItems: MenuItemModel[] =
    sessions.length === 0
      ? [{ id: "sessionEmpty", label: t("file.sessionEmpty"), disabled: true }]
      : [
          ...sessions.slice(0, 12).map((sess) => ({
            id: `session-${sess.id}`,
            label: sess.name,
          })),
          { sep: true },
          { id: "clearSessions", label: t("file.clearSessions") },
        ];

  // Shortcut labels / accelerators come from `@/lib/shortcuts` via `sc(id)`.
  const file: MenuItemModel[] = [
    { id: "new", label: t("file.new"), ...sc("new") },
    { id: "newWindow", label: t("file.newWindow"), ...sc("newWindow") },
    { id: "open", label: t("file.open"), ...sc("open") },
    { id: "quickOpen", label: t("file.quickOpen"), ...sc("quickOpen") },
    {
      id: "recent",
      label: t("file.recent"),
      submenu: recentItems,
    },
    { sep: true },
    { id: "saveSession", label: t("file.saveSession") },
    {
      id: "sessions",
      label: t("file.sessions"),
      submenu: sessionItems,
    },
    { sep: true },
    { id: "save", label: t("file.save"), ...sc("save") },
    { id: "saveAs", label: t("file.saveAs"), ...sc("saveAs") },
    { sep: true },
    { id: "pageSetup", label: t("file.pageSetup") },
    { id: "print", label: t("file.print") },
    { sep: true },
    { id: "about", label: t("misc.about") },
    { id: "checkUpdate", label: t("misc.checkUpdate") },
    { id: "exit", label: t("file.exit"), ...sc("exit") },
  ];

  const edit: MenuItemModel[] = [
    { id: "undo", label: t("edit.undo"), ...sc("undo") },
    { id: "redo", label: t("edit.redo"), ...sc("redo") },
    { sep: true },
    // Native predefined items: OS owns accelerators + clipboard.
    { id: "cut", predefined: "cut", label: t("edit.cut"), ...sc("cut") },
    { id: "copy", predefined: "copy", label: t("edit.copy"), ...sc("copy") },
    { id: "paste", predefined: "paste", label: t("edit.paste"), ...sc("paste") },
    // No accelerator — Delete must reach the editor's native keymap.
    { id: "delete", label: t("edit.delete"), ...sc("delete") },
    { sep: true },
    { id: "find", label: t("edit.find"), ...sc("find") },
    { id: "findNext", label: t("edit.findNext"), ...sc("findNext") },
    { id: "findPrev", label: t("edit.findPrev"), ...sc("findPrev") },
    { id: "replace", label: t("edit.replace"), ...sc("replace") },
    { id: "goto", label: t("edit.goto"), ...sc("goto") },
    { id: "voice", label: t("edit.voice"), ...sc("voice") },
    { sep: true },
    {
      id: "selectAll",
      predefined: "selectAll",
      label: t("edit.selectAll"),
      ...sc("selectAll"),
    },
    { id: "timeDate", label: t("edit.timeDate"), ...sc("timeDate") },
  ];

  const view: MenuItemModel[] = [
    {
      id: "zoom",
      label: t("view.zoom"),
      submenu: [
        { id: "zoomIn", label: t("view.zoomIn"), ...sc("zoomIn") },
        { id: "zoomOut", label: t("view.zoomOut"), ...sc("zoomOut") },
        { sep: true },
        { id: "zoomReset", label: t("view.zoomReset"), ...sc("zoomReset") },
      ],
    },
    { sep: true },
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
      id: "spellCheck",
      label: t("view.spellCheck"),
      checked: s.settings.spellCheck,
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
    { id: "settings", label: t("toolbar.settings"), ...sc("settings") },
  ];

  // Window — document/window chrome (TextEdit / browsers / VS Code pattern).
  const windowMenu: MenuItemModel[] = [
    { id: "nextTab", label: t("window.nextTab"), ...sc("nextTab") },
    { id: "prevTab", label: t("window.prevTab"), ...sc("prevTab") },
    { sep: true },
    {
      id: "alwaysOnTop",
      label: t("window.alwaysOnTop"),
      checked: s.alwaysOnTop,
      ...sc("alwaysOnTop"),
    },
  ];

  return {
    fileLabel: t("menu.file"),
    editLabel: t("menu.edit"),
    viewLabel: t("menu.view"),
    windowLabel: t("menu.window"),
    file,
    edit,
    view,
    window: windowMenu,
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
    case "quickOpen":
      s.setQuickOpenOpen(true);
      break;
    case "clearRecent":
      s.clearRecent();
      break;
    case "saveSession":
      s.requestSaveSession();
      break;
    case "clearSessions":
      s.clearSessions();
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
    case "checkUpdate":
      void s.checkForUpdates({ manual: true });
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
    case "voice":
      void s.requestVoiceDictation();
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
    case "nextTab":
    case "prevTab": {
      const tabs = s.tabs;
      if (tabs.length < 2) break;
      const idx = tabs.findIndex((t2) => t2.id === s.activeTabId);
      const delta = id === "nextTab" ? 1 : -1;
      const n = (idx + delta + tabs.length) % tabs.length;
      if (tabs[n]) {
        s.setActiveTab(tabs[n].id);
        requestAnimationFrame(() => getEditorView()?.focus());
      }
      break;
    }
    case "wordWrap":
      s.setSettings({ wordWrap: !s.settings.wordWrap });
      break;
    case "lineNumbers":
      s.setSettings({ showLineNumbers: !s.settings.showLineNumbers });
      break;
    case "spellCheck":
      s.setSettings({ spellCheck: !s.settings.spellCheck });
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
      } else if (id.startsWith("session-")) {
        s.requestOpenSession(id.slice(8));
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
