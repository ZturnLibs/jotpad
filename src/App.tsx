import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { basename } from "@/lib/backend";
import { clamp, platform } from "@/lib/utils";
import { getEditorView } from "@/lib/editorRef";
import { insertAtCursor, timeDateString } from "@/lib/edit";
import { applyNativeMenuDebounced, startNativeMenuListener } from "@/lib/platformMenu";
import { TabBar } from "@/components/TabBar";
import { MenuBar } from "@/components/MenuBar";
import { Toolbar } from "@/components/Toolbar";
import { Editor } from "@/components/Editor";
import { FindBar } from "@/components/FindBar";
import { StatusBar } from "@/components/StatusBar";
import { Settings } from "@/components/Settings";
import { ContextMenu } from "@/components/ContextMenu";
import { About, ConfirmDialog, GotoDialog } from "@/components/Dialogs";

function applyTheme(mode: "light" | "dark" | "system") {
  const effective =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  document.documentElement.setAttribute("data-theme", effective);
}

export function App() {
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const theme = useStore((s) => s.settings.theme);
  const locale = useStore((s) => s.settings.locale);
  const settings = useStore((s) => s.settings);
  const activeTabId = useStore((s) => s.activeTabId);
  const tabsLen = useStore((s) => s.tabs.length);
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const t = useT();
  // macOS + Linux use the native menu bar; Windows keeps the custom in-window menu.
  const useNativeMenu = platform() === "macos" || platform() === "linux";

  // Boot: load persisted state.
  useEffect(() => {
    void init();
  }, [init]);

  // Expose the platform on <html> for platform-specific CSS.
  useEffect(() => {
    document.documentElement.dataset.platform = platform();
  }, []);

  // macOS / Linux: drive the native menu bar.
  useEffect(() => {
    if (!useNativeMenu || !ready) return;
    void startNativeMenuListener();
    applyNativeMenuDebounced();
  }, [useNativeMenu, ready, settings, activeTabId, tabsLen]);

  // Apply theme; react to system changes when in "system" mode.
  useEffect(() => {
    applyTheme(theme);
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  // Update window title with the active document.
  useEffect(() => {
    document.documentElement.lang = locale;
    const name = activeTab
      ? activeTab.filePath
        ? basename(activeTab.filePath)
        : t("tab.untitled")
      : "Jotpad";
    document.title = `${name} — Jotpad`;
    void getCurrentWindow().setTitle(`${name} — Jotpad`);
  }, [activeTab, t, locale]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const isMac = platform() === "macos";
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const k = e.key.toLowerCase();

      const eat = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (mod && k === "n" && !e.shiftKey) {
        eat();
        s.newTab();
        return;
      }
      if (mod && k === "o") {
        eat();
        void s.openDialog();
        return;
      }
      if (mod && !e.shiftKey && k === "s") {
        eat();
        if (s.activeTabId) void s.saveTab(s.activeTabId);
        return;
      }
      if (mod && e.shiftKey && k === "s") {
        eat();
        if (s.activeTabId) void s.saveAsTab(s.activeTabId);
        return;
      }
      if (mod && k === "w") {
        eat();
        if (s.activeTabId) s.requestClose(s.activeTabId);
        return;
      }
      if (mod && k === "f") {
        eat();
        s.setFindOpen(true);
        return;
      }
      if (isMac ? mod && e.altKey && k === "f" : mod && k === "h") {
        eat();
        s.setReplaceOpen(true);
        return;
      }
      if (mod && k === "g") {
        eat();
        s.setGotoOpen(true);
        return;
      }
      if (mod && k === ",") {
        eat();
        s.setSettingsOpen(true);
        return;
      }
      if (e.key === "F5") {
        eat();
        const v = getEditorView();
        if (v) insertAtCursor(v, timeDateString(locale));
        return;
      }
      if (mod && (k === "=" || k === "+")) {
        eat();
        s.setSettings({ zoom: clamp(s.settings.zoom + 10, 30, 500) });
        return;
      }
      if (mod && k === "-") {
        eat();
        s.setSettings({ zoom: clamp(s.settings.zoom - 10, 30, 500) });
        return;
      }
      if (mod && k === "0") {
        eat();
        s.setSettings({ zoom: 100 });
        return;
      }
      if (e.ctrlKey && e.key === "Tab") {
        eat();
        const idx = s.tabs.findIndex((t2) => t2.id === s.activeTabId);
        const dir = e.shiftKey ? -1 : 1;
        const n = (idx + dir + s.tabs.length) % s.tabs.length;
        if (s.tabs[n]) s.setActiveTab(s.tabs[n].id);
        return;
      }
      if (e.key === "Escape") {
        if (s.findOpen || s.gotoOpen || s.settingsOpen || s.menuOpen) {
          eat();
          if (s.findOpen) {
            s.setFindOpen(false);
            s.setReplaceOpen(false);
            getEditorView()?.focus();
          } else if (s.gotoOpen) {
            s.setGotoOpen(false);
          } else if (s.settingsOpen) {
            s.setSettingsOpen(false);
          } else if (s.menuOpen) {
            s.setMenuOpen(null);
          }
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [locale]);

  // Intercept window close to save drafts / prompt for unsaved changes.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    win.onCloseRequested(async (event) => {
      event.preventDefault();
      await useStore.getState().requestExit();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // File drop: open dropped files.
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
    };
    document.addEventListener("dragover", prevent);
    document.addEventListener("drop", prevent);
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onDragDropEvent((e) => {
        if (e.payload.type === "drop" && e.payload.paths.length) {
          void useStore.getState().openPath(e.payload.paths[0]);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
      document.removeEventListener("dragover", prevent);
      document.removeEventListener("drop", prevent);
    };
  }, []);

  if (!ready) {
    return (
      <div className="app" style={{ alignItems: "center", justifyContent: "center" }}>
        <span className="muted">Jotpad…</span>
      </div>
    );
  }

  return (
    <div className="app">
      <TabBar />
      {!useNativeMenu && <MenuBar />}
      <Toolbar />
      <div className="editor-wrap-host" style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <Editor />
        <FindBar />
      </div>
      <StatusBar />
      <ContextMenu />
      <ConfirmDialog />
      <GotoDialog />
      <Settings />
      <About />
    </div>
  );
}
