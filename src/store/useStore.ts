// Central application store (zustand). Owns tabs, settings, recents,
// file operations, draft persistence and confirm flows.
import { create } from "zustand";
import { nanoid } from "nanoid";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AppSettings,
  AppState,
  Encoding,
  LineEnding,
  TabState,
} from "@/types";
import { DEFAULT_SETTINGS } from "@/types";
import * as api from "@/lib/backend";
import { basename, dirname, joinPath } from "@/lib/backend";
import { getEditorView } from "@/lib/editorRef";

const STATE_VERSION = 1;
const MAX_RECENT = 20;

export type MenuKind = "file" | "edit" | "view" | null;

interface ConfirmState {
  kind: "close" | "exit";
  tabIds: string[];
}

interface ReloadPrompt {
  tabId: string;
  path: string;
}

interface Store {
  ready: boolean;
  tabs: TabState[];
  activeTabId: string | null;
  settings: AppSettings;
  recentFiles: string[];

  // Transient UI flags
  findOpen: boolean;
  replaceOpen: boolean;
  gotoOpen: boolean;
  settingsOpen: boolean;
  aboutOpen: boolean;
  pageSetupOpen: boolean;
  menuOpen: MenuKind;
  confirm: ConfirmState | null;
  reloadPrompt: ReloadPrompt | null;

  // Derived
  activeTab: () => TabState | undefined;

  // Lifecycle
  init: () => Promise<void>;
  persist: () => Promise<void>;

  // Tabs
  newTab: () => string;
  doCloseTabs: (ids: string[]) => void;
  requestClose: (id: string) => void;
  resolveConfirm: (choice: "save" | "discard" | "cancel") => Promise<void>;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<TabState>) => void;
  setContent: (id: string, content: string) => void;

  // File ops
  openPath: (path: string) => Promise<void>;
  openDialog: () => Promise<void>;
  saveTab: (id: string) => Promise<boolean>;
  saveAsTab: (id: string) => Promise<boolean>;
  saveTabs: (ids: string[]) => Promise<boolean>;
  /** Rename an on-disk tab by new file name (same directory). */
  renameTab: (id: string, newName: string) => Promise<boolean>;
  /** Permanently delete the on-disk file and close the tab. */
  deleteTabFile: (id: string) => Promise<boolean>;
  clearRecent: () => void;
  checkExternalChanges: () => Promise<void>;
  resolveReloadPrompt: (choice: "reload" | "keep") => Promise<void>;

  // Settings
  setSettings: (patch: Partial<AppSettings>) => void;
  setEncoding: (encoding: Encoding) => void;
  setLineEnding: (le: LineEnding) => void;
  toggleBom: () => void;

  // UI setters
  setFindOpen: (v: boolean) => void;
  setReplaceOpen: (v: boolean) => void;
  setGotoOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setAboutOpen: (v: boolean) => void;
  setPageSetupOpen: (v: boolean) => void;
  setMenuOpen: (m: MenuKind) => void;

  // Exit
  requestExit: () => Promise<void>;
}

function makeUntitled(encoding: Encoding = "UTF-8"): TabState {
  return {
    id: nanoid(8),
    title: "",
    filePath: null,
    content: "",
    encoding,
    hasBom: false,
    lineEnding: "CRLF",
    dirty: false,
    size: 0,
    diskMtimeMs: null,
    selection: null,
    scrollTop: 0,
  };
}

function normalizeTab(t: TabState): TabState {
  return {
    ...t,
    diskMtimeMs: typeof t.diskMtimeMs === "number" ? t.diskMtimeMs : null,
  };
}

function normalizeSettings(raw: Partial<AppSettings> & Record<string, unknown>): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  return {
    theme: merged.theme,
    locale: merged.locale,
    fontFamily: merged.fontFamily,
    fontSize: merged.fontSize,
    wordWrap: merged.wordWrap,
    zoom: merged.zoom,
    showStatusBar: merged.showStatusBar,
    showLineNumbers: !!merged.showLineNumbers,
    accent: merged.accent,
  };
}

async function doWrite(tab: TabState, path: string): Promise<{ size: number; mtime: number }> {
  await api.writeFile(path, tab.content, tab.encoding, tab.lineEnding, tab.hasBom);
  const size = new TextEncoder().encode(tab.content).length;
  const mtime = await api.fileMtime(path);
  return { size, mtime };
}

function applyDocToEditor(text: string): void {
  const view = getEditorView();
  if (!view) return;
  const current = view.state.doc.toString();
  if (current === text) return;
  view.dispatch({
    changes: { from: 0, to: current.length, insert: text },
  });
}

export const useStore = create<Store>((set, get) => ({
  ready: false,
  tabs: [],
  activeTabId: null,
  settings: DEFAULT_SETTINGS,
  recentFiles: [],

  findOpen: false,
  replaceOpen: false,
  gotoOpen: false,
  settingsOpen: false,
  aboutOpen: false,
  pageSetupOpen: false,
  menuOpen: null,
  confirm: null,
  reloadPrompt: null,

  activeTab: () => {
    const { tabs, activeTabId } = get();
    return tabs.find((t) => t.id === activeTabId);
  },

  init: async () => {
    let state: AppState | null = null;
    try {
      state = await api.readState();
    } catch {
      state = null;
    }
    if (state && Array.isArray(state.tabs) && state.tabs.length) {
      const settings = normalizeSettings({ ...(state.settings || {}) });
      const tabs = state.tabs.map(normalizeTab);
      const activeTabId =
        state.activeTabId && tabs.some((t) => t.id === state.activeTabId)
          ? state.activeTabId
          : tabs[0].id;
      set({
        tabs,
        activeTabId,
        settings,
        recentFiles: Array.isArray(state.recentFiles) ? state.recentFiles : [],
        ready: true,
      });
      // Backfill mtimes for restored file tabs (silent).
      for (const tab of tabs) {
        if (!tab.filePath || tab.diskMtimeMs != null) continue;
        try {
          const m = await api.fileMtime(tab.filePath);
          get().updateTab(tab.id, { diskMtimeMs: m });
        } catch {
          /* missing file — ignore */
        }
      }
    } else {
      const t = makeUntitled();
      set({ tabs: [t], activeTabId: t.id, settings: DEFAULT_SETTINGS, recentFiles: [], ready: true });
    }
  },

  persist: async () => {
    const { tabs, activeTabId, settings, recentFiles, ready } = get();
    if (!ready) return;
    const state: AppState = { version: STATE_VERSION, tabs, activeTabId, settings, recentFiles };
    try {
      await api.writeState(state);
    } catch {
      /* best-effort */
    }
  },

  newTab: () => {
    const t = makeUntitled(get().activeTab()?.encoding ?? "UTF-8");
    set((s) => ({ tabs: [...s.tabs, t], activeTabId: t.id, findOpen: false, replaceOpen: false }));
    return t.id;
  },

  doCloseTabs: (ids) => {
    const idSet = new Set(ids);
    set((s) => {
      let tabs = s.tabs.filter((t) => !idSet.has(t.id));
      let activeTabId = s.activeTabId;
      if (tabs.length === 0) {
        const t = makeUntitled();
        tabs = [t];
        activeTabId = t.id;
      } else if (s.activeTabId && idSet.has(s.activeTabId)) {
        activeTabId = tabs[tabs.length - 1].id;
      }
      const reloadPrompt =
        s.reloadPrompt && idSet.has(s.reloadPrompt.tabId) ? null : s.reloadPrompt;
      return { tabs, activeTabId, findOpen: false, replaceOpen: false, reloadPrompt };
    });
  },

  requestClose: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.dirty) {
      set({ confirm: { kind: "close", tabIds: [id] } });
    } else {
      get().doCloseTabs([id]);
    }
  },

  resolveConfirm: async (choice) => {
    const c = get().confirm;
    set({ confirm: null });
    if (!c || choice === "cancel") return;
    if (choice === "save") {
      const ok = await get().saveTabs(c.tabIds);
      if (!ok) return;
    }
    get().doCloseTabs(c.tabIds);
    if (c.kind === "exit") {
      await get().persist();
      try {
        await getCurrentWindow().destroy();
      } catch {
        /* ignore */
      }
    }
  },

  setActiveTab: (id) =>
    set({ activeTabId: id, findOpen: false, replaceOpen: false, menuOpen: null }),

  updateTab: (id, patch) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

  setContent: (id, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, content, dirty: true } : t)),
    })),

  openPath: async (path) => {
    const existing = get().tabs.find((t) => t.filePath === path);
    if (existing) {
      get().setActiveTab(existing.id);
      return;
    }
    try {
      const r = await api.readFile(path);
      const tab: TabState = {
        id: nanoid(8),
        title: basename(path),
        filePath: path,
        content: r.text,
        encoding: r.encoding,
        hasBom: r.has_bom,
        lineEnding: r.line_ending,
        dirty: false,
        size: r.size,
        diskMtimeMs: r.mtime_ms,
        selection: null,
        scrollTop: 0,
      };
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        recentFiles: [path, ...s.recentFiles.filter((p) => p !== path)].slice(0, MAX_RECENT),
        findOpen: false,
        replaceOpen: false,
      }));
    } catch (e) {
      await api.nativeMessage("Jotpad", String(e));
    }
  },

  openDialog: async () => {
    const path = await api.pickOpenFile();
    if (!path) return;
    await get().openPath(path);
  },

  saveTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return false;
    if (!tab.filePath) return get().saveAsTab(id);
    try {
      const { size, mtime } = await doWrite(tab, tab.filePath);
      get().updateTab(id, { dirty: false, size, diskMtimeMs: mtime });
      return true;
    } catch (e) {
      await api.nativeMessage("Jotpad", String(e));
      return false;
    }
  },

  saveAsTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return false;
    const untitled = get().settings.locale === "zh-CN" ? "新建.txt" : "Untitled.txt";
    const defaultName = tab.filePath ? basename(tab.filePath) : untitled;
    const path = await api.pickSaveFile(defaultName);
    if (!path) return false;
    try {
      const { size, mtime } = await doWrite(tab, path);
      get().updateTab(id, {
        filePath: path,
        title: basename(path),
        dirty: false,
        size,
        diskMtimeMs: mtime,
      });
      set((s) => ({
        recentFiles: [path, ...s.recentFiles.filter((p) => p !== path)].slice(0, MAX_RECENT),
      }));
      return true;
    } catch (e) {
      await api.nativeMessage("Jotpad", String(e));
      return false;
    }
  },

  saveTabs: async (ids) => {
    for (const id of ids) {
      const tab = get().tabs.find((t) => t.id === id);
      if (!tab || !tab.dirty) continue;
      if (!tab.filePath) {
        const ok = await get().saveAsTab(id);
        if (!ok) return false;
      } else {
        try {
          const { size, mtime } = await doWrite(tab, tab.filePath);
          get().updateTab(id, { dirty: false, size, diskMtimeMs: mtime });
        } catch (e) {
          await api.nativeMessage("Jotpad", String(e));
          return false;
        }
      }
    }
    return true;
  },

  renameTab: async (id, newName) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab?.filePath) return false;
    const name = newName.trim();
    if (!name || /[/\\]/.test(name) || name === "." || name === "..") {
      await api.nativeMessage(
        "Jotpad",
        get().settings.locale === "zh-CN" ? "文件名无效" : "Invalid file name",
      );
      return false;
    }
    const oldPath = tab.filePath;
    if (basename(oldPath) === name) return true;
    const newPath = joinPath(dirname(oldPath), name);
    if (get().tabs.some((t) => t.id !== id && t.filePath === newPath)) {
      await api.nativeMessage(
        "Jotpad",
        get().settings.locale === "zh-CN"
          ? "该文件已在另一个标签页中打开"
          : "That file is already open in another tab",
      );
      return false;
    }
    try {
      await api.renameFile(oldPath, newPath);
      let mtime = tab.diskMtimeMs;
      try {
        mtime = await api.fileMtime(newPath);
      } catch {
        /* keep previous */
      }
      get().updateTab(id, { filePath: newPath, title: name, diskMtimeMs: mtime });
      set((s) => ({
        recentFiles: s.recentFiles.map((p) => (p === oldPath ? newPath : p)),
      }));
      return true;
    } catch (e) {
      const msg = String(e);
      const friendly = msg.includes("target exists")
        ? get().settings.locale === "zh-CN"
          ? "同名文件已存在"
          : "A file with that name already exists"
        : msg;
      await api.nativeMessage("Jotpad", friendly);
      return false;
    }
  },

  deleteTabFile: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab?.filePath) return false;
    const name = basename(tab.filePath);
    const zh = get().settings.locale === "zh-CN";
    const ok = await api.nativeConfirm(
      "Jotpad",
      zh
        ? `确定永久删除「${name}」？此操作无法撤销。`
        : `Permanently delete “${name}”? This cannot be undone.`,
      zh ? "删除" : "Delete",
      zh ? "取消" : "Cancel",
    );
    if (!ok) return false;
    const path = tab.filePath;
    try {
      await api.deleteFile(path);
    } catch (e) {
      await api.nativeMessage("Jotpad", String(e));
      return false;
    }
    set((s) => ({
      recentFiles: s.recentFiles.filter((p) => p !== path),
    }));
    get().doCloseTabs([id]);
    return true;
  },

  clearRecent: () => set({ recentFiles: [] }),

  checkExternalChanges: async () => {
    if (get().reloadPrompt) return;
    for (const tab of get().tabs) {
      if (!tab.filePath || tab.diskMtimeMs == null) continue;
      try {
        const m = await api.fileMtime(tab.filePath);
        if (m !== tab.diskMtimeMs) {
          set({ reloadPrompt: { tabId: tab.id, path: tab.filePath } });
          return;
        }
      } catch {
        /* file missing — ignore until user interacts */
      }
    }
  },

  resolveReloadPrompt: async (choice) => {
    const prompt = get().reloadPrompt;
    set({ reloadPrompt: null });
    if (!prompt) return;
    const tab = get().tabs.find((t) => t.id === prompt.tabId);
    if (!tab?.filePath) return;

    if (choice === "keep") {
      try {
        const m = await api.fileMtime(tab.filePath);
        get().updateTab(tab.id, { diskMtimeMs: m });
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      const r = await api.readFile(tab.filePath);
      get().updateTab(tab.id, {
        content: r.text,
        encoding: r.encoding,
        hasBom: r.has_bom,
        lineEnding: r.line_ending,
        dirty: false,
        size: r.size,
        diskMtimeMs: r.mtime_ms,
      });
      if (get().activeTabId === tab.id) {
        applyDocToEditor(r.text);
      }
    } catch (e) {
      await api.nativeMessage("Jotpad", String(e));
    }
  },

  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  setEncoding: (encoding) => {
    const id = get().activeTabId;
    if (id) get().updateTab(id, { encoding, dirty: true });
  },

  setLineEnding: (lineEnding) => {
    const id = get().activeTabId;
    if (id) get().updateTab(id, { lineEnding, dirty: true });
  },

  toggleBom: () => {
    const id = get().activeTabId;
    const tab = get().activeTab();
    if (id && tab) get().updateTab(id, { hasBom: !tab.hasBom, dirty: true });
  },

  setFindOpen: (v) => set({ findOpen: v, replaceOpen: v ? get().replaceOpen : false }),
  setReplaceOpen: (v) => set({ replaceOpen: v, findOpen: v ? true : get().findOpen }),
  setGotoOpen: (v) => set({ gotoOpen: v }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setAboutOpen: (v) => set({ aboutOpen: v }),
  setPageSetupOpen: (v) => set({ pageSetupOpen: v }),
  setMenuOpen: (m) => set({ menuOpen: m }),

  requestExit: async () => {
    const dirtyIds = get()
      .tabs.filter((t) => t.dirty)
      .map((t) => t.id);
    if (dirtyIds.length) {
      set({ confirm: { kind: "exit", tabIds: dirtyIds } });
      return;
    }
    await get().persist();
    try {
      await getCurrentWindow().destroy();
    } catch {
      /* ignore */
    }
  },
}));
