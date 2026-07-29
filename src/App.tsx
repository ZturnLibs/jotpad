import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { basename, getSystemAccent, takePendingOpenPaths } from "@/lib/backend";
import { darken, lighten, platform, rgbToHex } from "@/lib/utils";
import { getEditorView } from "@/lib/editorRef";
import { runMenuAction } from "@/lib/menuActions";
import { matchShortcut } from "@/lib/shortcuts";
import { applyNativeMenuDebounced, startNativeMenuListener } from "@/lib/platformMenu";
import { TabBar } from "@/components/TabBar";
import { Toolbar } from "@/components/Toolbar";
import { Editor } from "@/components/Editor";
import { FindBar } from "@/components/FindBar";
import { VoiceBar, VoiceSetupDialog } from "@/components/VoiceBar";
import { StatusBar } from "@/components/StatusBar";
import { Settings } from "@/components/Settings";
import { ContextMenu } from "@/components/ContextMenu";
import { PageSetup } from "@/components/PageSetup";
import { QuickOpen } from "@/components/QuickOpen";
import { About, ConfirmDialog, GotoDialog, ReloadDialog, SessionNameDialog } from "@/components/Dialogs";
import { HistoryPanel } from "@/components/HistoryPanel";
import { ToastHost } from "@/components/ToastHost";

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
  const recentLen = useStore((s) => s.recentFiles.length);
  const sessionsLen = useStore((s) => s.sessions.length);
  const alwaysOnTop = useStore((s) => s.alwaysOnTop);
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const t = useT();

  // Boot: load persisted state.
  useEffect(() => {
    void init();
  }, [init]);

  // Expose the platform on <html> for platform-specific CSS.
  useEffect(() => {
    document.documentElement.dataset.platform = platform();
  }, []);

  // Suppress the WebView/browser native context menu app-wide.
  // Custom menus (editor / sidebar tabs) still work; they only need preventDefault too.
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);

  // Native system menu bar on every platform (macOS top bar / Win·Linux window menu).
  useEffect(() => {
    if (!ready) return;
    void startNativeMenuListener();
    applyNativeMenuDebounced();
  }, [ready, settings, activeTabId, tabsLen, recentLen, sessionsLen, alwaysOnTop]);

  // 启动后延迟静默检查更新（可在设置关闭）。
  useEffect(() => {
    if (!ready || !settings.autoCheckUpdates) return;
    const timer = window.setTimeout(() => {
      void useStore.getState().checkForUpdates({ manual: false });
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [ready, settings.autoCheckUpdates]);

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

  // Apply accent color (follow system or custom), theme-aware contrast.
  useEffect(() => {
    let cancelled = false;
    const effective =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    void (async () => {
      let hex = settings.accent;
      if (hex === "system") {
        try {
          const [r, g, b] = await getSystemAccent();
          hex = rgbToHex(r, g, b);
        } catch {
          hex = "#0067C0";
        }
      }
      if (cancelled) return;
      const acc = effective === "dark" ? lighten(hex, 72) : hex;
      const hover = effective === "dark" ? lighten(hex, 96) : darken(hex, 20);
      const root = document.documentElement.style;
      root.setProperty("--accent", acc);
      root.setProperty("--accent-hover", hover);
      const m = /^#?([0-9a-f]{6})$/i.exec(acc);
      let lum = 128;
      if (m) {
        const n = parseInt(m[1], 16);
        lum = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
      }
      root.setProperty("--accent-contrast", lum > 145 ? "#0a0a0a" : "#ffffff");
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.accent, theme]);

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

  // Detect external disk changes for open files.
  useEffect(() => {
    if (!ready) return;
    const check = () => void useStore.getState().checkExternalChanges();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    const iv = window.setInterval(check, 2500);
    check();
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(iv);
    };
  }, [ready]);

  // Global keyboard shortcuts — matching lives in `@/lib/shortcuts`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hit = matchShortcut(e);
      if (!hit) return;

      if (hit.kind === "escape") {
        const s = useStore.getState();
        if (
          !(
            s.voiceOpen ||
            s.voiceSetupOpen ||
            s.quickOpenOpen ||
            s.findOpen ||
            s.gotoOpen ||
            s.settingsOpen ||
            s.sessionNameOpen ||
            s.menuOpen
          )
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (s.voiceSetupOpen) {
          s.setVoiceSetupOpen(false);
        } else if (s.voiceOpen) {
          s.setVoiceOpen(false);
          getEditorView()?.focus();
        } else if (s.quickOpenOpen) {
          s.setQuickOpenOpen(false);
          getEditorView()?.focus();
        } else if (s.findOpen) {
          s.setFindOpen(false);
          s.setReplaceOpen(false);
          getEditorView()?.focus();
        } else if (s.gotoOpen) {
          s.setGotoOpen(false);
        } else if (s.settingsOpen) {
          s.setSettingsOpen(false);
        } else if (s.sessionNameOpen) {
          s.setSessionNameOpen(false);
        } else if (s.menuOpen) {
          s.setMenuOpen(null);
        }
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (hit.kind === "action") {
        runMenuAction(hit.id);
        return;
      }

      // tabJump
      const s = useStore.getState();
      if (!s.tabs.length) return;
      const i = hit.index >= 9 ? s.tabs.length - 1 : hit.index - 1;
      if (s.tabs[i]) {
        s.setActiveTab(s.tabs[i].id);
        requestAnimationFrame(() => getEditorView()?.focus());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

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

  // Open With / argv / Finder service: paths from the native shell.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const openAll = (paths: string[]) => {
      for (const p of paths) {
        void useStore.getState().openPath(p);
      }
    };

    void (async () => {
      try {
        // Listen first so runtime Opened events are not missed, then drain cold-start queue.
        unlisten = await listen<string[]>("open-paths", (e) => {
          if (Array.isArray(e.payload) && e.payload.length) openAll(e.payload);
        });
      } catch {
        /* ignore */
      }
      try {
        const pending = await takePendingOpenPaths();
        if (!cancelled && pending.length) openAll(pending);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ready]);

  if (!ready) {
    return (
      <div className="app" style={{ alignItems: "center", justifyContent: "center" }}>
        <span className="muted">Jotpad…</span>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-body">
        <aside className="sidebar">
          <TabBar />
        </aside>
        <main className="main">
          <Toolbar />
          <div className="editor-wrap-host" style={{ flex: 1, position: "relative", minHeight: 0 }}>
            <Editor />
            <FindBar />
            <VoiceBar />
          </div>
          <StatusBar />
        </main>
      </div>
      <ContextMenu />
      <QuickOpen />
      <ConfirmDialog />
      <SessionNameDialog />
      <ReloadDialog />
      <GotoDialog />
      <VoiceSetupDialog />
      <PageSetup />
      <Settings />
      <About />
      <HistoryPanel />
      <ToastHost />
    </div>
  );
}
