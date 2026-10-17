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
  NamedSession,
  StartupMode,
  TabState,
} from "@/types";
import { DEFAULT_SETTINGS } from "@/types";
import * as api from "@/lib/backend";
import { basename, dirname, joinPath } from "@/lib/backend";
import { getEditorView, beginProgrammaticDocChange, endProgrammaticDocChange } from "@/lib/editorRef";
import { diffLines } from "@/lib/diff";
import { translate } from "@/lib/i18n";
import { dismissToast, showToast, updateToast } from "@/lib/toast";
import {
  UPDATE_TOAST_ID,
  checkForAppUpdate,
  discardPendingUpdate,
  downloadPending,
  getCanInstallInApp,
  getPendingUpdateVersion,
  installPending,
  openReleasesPage,
} from "@/lib/updater";

const STATE_VERSION = 2;
const MAX_RECENT = 20;

/** Files larger than this are opened read-only to avoid lag. */
const BIG_FILE_THRESHOLD = 2_000_000;
const MAX_SESSIONS = 20;
/** 自己写入后忽略外部变更检测的宽限期（Documents/iCloud 等可能立刻再改 mtime）。 */
const SELF_WRITE_GRACE_MS = 4000;

/** path → 最近一次由本应用写入的时间戳 */
const recentSelfWrites = new Map<string, number>();
/** 原生打开/保存对话框打开期间，暂停外部变更检测（避免失焦误报）。 */
let nativeFileDialogDepth = 0;
/** 编辑/标签变化后防抖落盘间隔：崩溃或被强退也能恢复草稿与最新 mtime 基准。 */
const PERSIST_DEBOUNCE_MS = 2000;

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** 防抖持久化：高频编辑只触发一次落盘。 */
function schedulePersist(): void {
  if (persistTimer != null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void useStore.getState().persist();
  }, PERSIST_DEBOUNCE_MS);
}

function markSelfWrite(path: string): void {
  recentSelfWrites.set(path, Date.now());
}

function isRecentSelfWrite(path: string): boolean {
  const at = recentSelfWrites.get(path);
  if (at == null) return false;
  if (Date.now() - at <= SELF_WRITE_GRACE_MS) return true;
  recentSelfWrites.delete(path);
  return false;
}

async function withNativeFileDialog<T>(fn: () => Promise<T>): Promise<T> {
  nativeFileDialogDepth += 1;
  try {
    return await fn();
  } finally {
    nativeFileDialogDepth -= 1;
  }
}

export type MenuKind = "file" | "edit" | "view" | null;

interface ConfirmState {
  kind: "close" | "exit" | "openSession" | "update";
  tabIds: string[];
  sessionId?: string;
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
  pinnedPaths: string[];
  sessions: NamedSession[];

  // Transient UI flags
  findOpen: boolean;
  replaceOpen: boolean;
  gotoOpen: boolean;
  quickOpenOpen: boolean;
  crossSearchOpen: boolean;
  outlineOpen: boolean;
  previewOpen: boolean;
  settingsOpen: boolean;
  aboutOpen: boolean;
  pageSetupOpen: boolean;
  diffOpen: boolean;
  diffData: { name: string; lines: import("@/lib/diff").DiffLine[]; same: boolean } | null;
  sessionNameOpen: boolean;
  historyOpen: boolean;
  menuOpen: MenuKind;
  confirm: ConfirmState | null;
  reloadPrompt: ReloadPrompt | null;
  /** Window always-on-top (not persisted). */
  alwaysOnTop: boolean;

  /** 语音包状态（不持久化，启动/下载后刷新）。 */
  voicePack: api.VoicePackStatus | null;
  voiceOpen: boolean;
  voiceSetupOpen: boolean;
  /** 打开设置时定位到语音区块。 */
  settingsFocus: "voice" | null;

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
  togglePinned: (path: string) => void;
  clearRecent: () => void;
  /** Prompt UI then save current on-disk tabs as a named session. */
  requestSaveSession: () => void;
  saveSession: (name: string) => Promise<boolean>;
  /** Open a named session (prompts if dirty tabs exist). */
  requestOpenSession: (id: string) => void;
  /** Replace tabs with files from a named session. */
  openSession: (id: string) => Promise<void>;
  clearSessions: () => void;
  checkExternalChanges: () => Promise<void>;
  resolveReloadPrompt: (choice: "reload" | "keep") => Promise<void>;

  // Settings
  setSettings: (patch: Partial<AppSettings>) => void;
  setEncoding: (encoding: Encoding) => void;
  setLineEnding: (le: LineEnding) => void;
  toggleBom: () => void;
  toggleReadOnly: () => void;

  // UI setters
  setFindOpen: (v: boolean) => void;
  setReplaceOpen: (v: boolean) => void;
  setGotoOpen: (v: boolean) => void;
  setQuickOpenOpen: (v: boolean) => void;
  setCrossSearchOpen: (v: boolean) => void;
  setOutlineOpen: (v: boolean) => void;
  setPreviewOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setAboutOpen: (v: boolean) => void;
  setPageSetupOpen: (v: boolean) => void;
  setDiffOpen: (v: boolean) => void;
  openDiff: () => Promise<void>;
  setSessionNameOpen: (v: boolean) => void;
  setHistoryOpen: (v: boolean) => void;
  setMenuOpen: (m: MenuKind) => void;
  toggleAlwaysOnTop: () => Promise<void>;
  setVoiceOpen: (v: boolean) => void;
  setVoiceSetupOpen: (v: boolean) => void;
  setSettingsFocus: (v: "voice" | null) => void;
  refreshVoicePack: () => Promise<void>;
  /** 菜单/快捷键入口：未就绪则引导下载，就绪则开录音条。 */
  requestVoiceDictation: () => Promise<void>;

  /** 检查更新；结果以右下角 Toast 展示（不阻塞编辑）。 */
  checkForUpdates: (opts?: { manual?: boolean }) => Promise<void>;
  skipPendingUpdate: () => Promise<void>;
  installPendingUpdate: () => Promise<void>;
  /** 已处理未保存确认后的实际安装重启。 */
  proceedInstallUpdate: () => Promise<void>;
  openUpdateDownloadPage: () => Promise<void>;

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
    readOnly: false,
    size: 0,
    diskMtimeMs: null,
    selection: null,
    scrollTop: 0,
  };
}

function normalizeTab(t: TabState): TabState {
  return {
    ...t,
    readOnly: t.readOnly ?? false,
    diskMtimeMs: typeof t.diskMtimeMs === "number" ? t.diskMtimeMs : null,
  };
}

function normalizeSettings(raw: Partial<AppSettings> & Record<string, unknown>): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  const startupMode: StartupMode =
    merged.startupMode === "blank" ? "blank" : "restore";
  const skipped =
    typeof merged.skippedUpdateVersion === "string" && merged.skippedUpdateVersion
      ? merged.skippedUpdateVersion
      : null;
  const defaultSaveDirectory =
    typeof merged.defaultSaveDirectory === "string" && merged.defaultSaveDirectory.trim()
      ? merged.defaultSaveDirectory
      : null;
  const experimental: Record<string, boolean> = {};
  if (merged.experimental && typeof merged.experimental === "object") {
    for (const [k, v] of Object.entries(merged.experimental as Record<string, unknown>)) {
      if (typeof k === "string" && k) experimental[k] = !!v;
    }
  }
  return {
    theme: merged.theme,
    locale: merged.locale,
    fontFamily: merged.fontFamily,
    fontSize: merged.fontSize,
    wordWrap: merged.wordWrap,
    zoom: merged.zoom,
    showStatusBar: merged.showStatusBar,
    showLineNumbers: !!merged.showLineNumbers,
    spellCheck: !!merged.spellCheck,
    startupMode,
    accent: merged.accent,
    autoCheckUpdates: merged.autoCheckUpdates !== false,
    skippedUpdateVersion: skipped,
    localHistoryEnabled: merged.localHistoryEnabled !== false,
    defaultSaveDirectory,
    experimental,
  };
}

function normalizeSessions(raw: unknown): NamedSession[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedSession[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Partial<NamedSession>;
    if (typeof s.id !== "string" || typeof s.name !== "string") continue;
    if (!Array.isArray(s.paths)) continue;
    const paths = s.paths.filter((p): p is string => typeof p === "string" && !!p);
    if (!paths.length) continue;
    out.push({
      id: s.id,
      name: s.name,
      paths,
      activePath: typeof s.activePath === "string" ? s.activePath : null,
      updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
    });
  }
  return out
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
}

async function doWrite(tab: TabState, path: string): Promise<{ size: number; mtime: number }> {
  await api.writeFile(path, tab.content, tab.encoding, tab.lineEnding, tab.hasBom);
  const size = new TextEncoder().encode(tab.content).length;
  const mtime = await api.fileMtime(path);
  // 标记为自己写入，避免保存对话框关闭后的 focus/轮询把本次写入当成外部修改
  markSelfWrite(path);
  return { size, mtime };
}

function applyDocToEditor(text: string): void {
  const view = getEditorView();
  if (!view) return;
  const current = view.state.doc.toString();
  if (current === text) return;
  beginProgrammaticDocChange();
  try {
    view.dispatch({
      changes: { from: 0, to: current.length, insert: text },
    });
  } finally {
    endProgrammaticDocChange();
  }
}

async function loadTabFromPath(path: string): Promise<TabState | null> {
  try {
    const r = await api.readFile(path);
    return {
      id: nanoid(8),
      title: basename(path),
      filePath: path,
      content: r.text,
      encoding: r.encoding,
      hasBom: r.has_bom,
      lineEnding: r.line_ending,
      dirty: false,
      readOnly: r.size > BIG_FILE_THRESHOLD,
      size: r.size,
      diskMtimeMs: r.mtime_ms,
      selection: null,
      scrollTop: 0,
    };
  } catch {
    return null;
  }
}

export const useStore = create<Store>((set, get) => ({
  ready: false,
  tabs: [],
  activeTabId: null,
  settings: DEFAULT_SETTINGS,
  recentFiles: [],
  pinnedPaths: [],
  sessions: [],

  findOpen: false,
  replaceOpen: false,
  gotoOpen: false,
  quickOpenOpen: false,
  crossSearchOpen: false,
  outlineOpen: false,
  previewOpen: false,
  settingsOpen: false,
  aboutOpen: false,
  pageSetupOpen: false,
  diffOpen: false,
  diffData: null,
  sessionNameOpen: false,
  historyOpen: false,
  menuOpen: null,
  confirm: null,
  reloadPrompt: null,
  alwaysOnTop: false,
  voicePack: null,
  voiceOpen: false,
  voiceSetupOpen: false,
  settingsFocus: null,

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
    const settings = normalizeSettings({ ...(state?.settings || {}) });
    const recentFiles = Array.isArray(state?.recentFiles) ? state!.recentFiles : [];
    const pinnedPaths = Array.isArray(state?.pinnedPaths)
      ? [...new Set(state!.pinnedPaths.filter((p) => typeof p === "string" && p))]
      : [];
    const sessions = normalizeSessions(state?.sessions);

    const restoreTabs =
      settings.startupMode === "restore" &&
      state &&
      Array.isArray(state.tabs) &&
      state.tabs.length > 0;

    if (restoreTabs) {
      const tabs = state!.tabs.map(normalizeTab);
      const activeTabId =
        state!.activeTabId && tabs.some((t) => t.id === state!.activeTabId)
          ? state!.activeTabId
          : tabs[0].id;
      set({
        tabs,
        activeTabId,
        settings,
        recentFiles,
        pinnedPaths,
        sessions,
        ready: true,
      });
      void get().refreshVoicePack();
      for (const tab of tabs) {
        if (!tab.filePath) continue;
        try {
          const m = await api.fileMtime(tab.filePath);
          if (m === tab.diskMtimeMs) continue;
          if (tab.diskMtimeMs == null) {
            get().updateTab(tab.id, { diskMtimeMs: m });
            continue;
          }
          // 快照 mtime 与磁盘不一致：内容相同（只有时间戳被碰过，如同步工具）
          // 就静默刷新基准；内容不同则保留快照，交给外部变更检测去提示。
          try {
            const r = await api.readFile(tab.filePath);
            if (r.text === tab.content) {
              get().updateTab(tab.id, {
                diskMtimeMs: r.mtime_ms,
                size: r.size,
                encoding: r.encoding,
                hasBom: r.has_bom,
                lineEnding: r.line_ending,
              });
            }
          } catch {
            /* read failed — leave as-is */
          }
        } catch {
          /* missing file — ignore */
        }
      }
    } else {
      const t = makeUntitled();
      set({
        tabs: [t],
        activeTabId: t.id,
        settings: state ? settings : DEFAULT_SETTINGS,
        recentFiles,
        pinnedPaths,
        sessions,
        ready: true,
      });
      void get().refreshVoicePack();
    }
  },

  persist: async () => {
    const { tabs, activeTabId, settings, recentFiles, sessions, pinnedPaths, ready } = get();
    if (!ready) return;
    const state: AppState = {
      version: STATE_VERSION,
      tabs,
      activeTabId,
      settings,
      recentFiles,
      sessions,
      pinnedPaths,
    };
    try {
      await api.writeState(state);
    } catch {
      /* best-effort */
    }
  },

  newTab: () => {
    const t = makeUntitled(get().activeTab()?.encoding ?? "UTF-8");
    set((s) => ({ tabs: [...s.tabs, t], activeTabId: t.id, findOpen: false, replaceOpen: false }));
    schedulePersist();
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
    schedulePersist();
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
    if (c.kind === "openSession" && c.sessionId) {
      await get().openSession(c.sessionId);
      return;
    }
    if (c.kind === "update") {
      // 保存或丢弃后继续安装；不关标签（重启后由启动策略恢复）。
      await get().proceedInstallUpdate();
      return;
    }
    if (c.kind === "exit") {
      if (choice === "save") {
        // 已保存的标签保留在会话里落盘；若先关标签，state 只剩空白标签，
        // 下次启动整个会话无法恢复。
        await get().persist();
      } else {
        get().doCloseTabs(c.tabIds);
        await get().persist();
      }
      try {
        await getCurrentWindow().destroy();
      } catch {
        /* ignore */
      }
      return;
    }
    get().doCloseTabs(c.tabIds);
  },

  setActiveTab: (id) => {
    set({ activeTabId: id, findOpen: false, replaceOpen: false, menuOpen: null });
    schedulePersist();
  },

  updateTab: (id, patch) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    schedulePersist();
  },

  setContent: (id, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, content, dirty: true } : t)),
    }));
    schedulePersist();
  },

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
        readOnly: r.size > BIG_FILE_THRESHOLD,
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
    const path = await withNativeFileDialog(() => api.pickOpenFile());
    if (!path) return;
    await get().openPath(path);
  },

  saveTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return false;
    if (!tab.filePath) return get().saveAsTab(id);
    try {
      const { size, mtime } = await doWrite(tab, tab.filePath);
      // 同路径可能被多个标签打开：统一刷新 mtime，避免另一标签误报外部变更
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id
            ? { ...t, dirty: false, size, diskMtimeMs: mtime }
            : t.filePath === tab.filePath
              ? { ...t, diskMtimeMs: mtime }
              : t,
        ),
      }));
      const { recordLocalHistory } = await import("@/lib/history");
      recordLocalHistory(tab.filePath, tab.content, "save");
      // 保存即落盘：state 与磁盘同步，异常退出后重启不会误报「文件已被修改」
      await get().persist();
      return true;
    } catch (e) {
      await api.nativeMessage("Jotpad", String(e));
      return false;
    }
  },

  saveAsTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return false;
    const settings = get().settings;
    const untitled = settings.locale === "zh-CN" ? "新建.txt" : "Untitled.txt";
    const defaultName = tab.filePath ? basename(tab.filePath) : untitled;
    // 未保存标签：自定义目录优先，否则落到各系统「文档」目录
    let defaultPath = tab.filePath ?? defaultName;
    if (!tab.filePath) {
      const dir = await api.resolveDefaultSaveDirectory(settings.defaultSaveDirectory);
      if (dir) defaultPath = joinPath(dir, defaultName);
    }
    const path = await withNativeFileDialog(() => api.pickSaveFile(defaultPath));
    if (!path) return false;
    try {
      const { size, mtime } = await doWrite(tab, path);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                filePath: path,
                title: basename(path),
                dirty: false,
                size,
                diskMtimeMs: mtime,
              }
            : t.filePath === path
              ? { ...t, diskMtimeMs: mtime }
              : t,
        ),
        recentFiles: [path, ...s.recentFiles.filter((p) => p !== path)].slice(0, MAX_RECENT),
      }));
      const { recordLocalHistory } = await import("@/lib/history");
      recordLocalHistory(path, tab.content, "saveAs");
      await get().persist();
      return true;
    } catch (e) {
      await api.nativeMessage("Jotpad", String(e));
      return false;
    }
  },

  saveTabs: async (ids) => {
    let wrote = false;
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
          const { recordLocalHistory } = await import("@/lib/history");
          recordLocalHistory(tab.filePath, tab.content, "save");
          wrote = true;
        } catch (e) {
          await api.nativeMessage("Jotpad", String(e));
          return false;
        }
      }
    }
    if (wrote) await get().persist();
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
      schedulePersist();
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

  clearRecent: () => {
    set({ recentFiles: [] });
    schedulePersist();
  },

  togglePinned: (path) => {
    set((s) => ({
      pinnedPaths: s.pinnedPaths.includes(path)
        ? s.pinnedPaths.filter((p) => p !== path)
        : [...s.pinnedPaths, path],
    }));
    schedulePersist();
  },

  requestSaveSession: () => {
    const paths = get()
      .tabs.map((t) => t.filePath)
      .filter((p): p is string => !!p);
    if (!paths.length) {
      const zh = get().settings.locale === "zh-CN";
      void api.nativeMessage(
        "Jotpad",
        zh
          ? "当前没有已保存到磁盘的文件，无法写入会话。"
          : "No saved files to include in a session.",
      );
      return;
    }
    set({ sessionNameOpen: true });
  },

  saveSession: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const paths = [
      ...new Set(
        get()
          .tabs.map((t) => t.filePath)
          .filter((p): p is string => !!p),
      ),
    ];
    if (!paths.length) return false;
    const activePath = get().activeTab()?.filePath ?? null;
    const now = Date.now();
    set((s) => {
      const existing = s.sessions.find(
        (x) => x.name.toLowerCase() === trimmed.toLowerCase(),
      );
      let sessions: NamedSession[];
      if (existing) {
        sessions = s.sessions.map((x) =>
          x.id === existing.id
            ? { ...x, name: trimmed, paths, activePath, updatedAt: now }
            : x,
        );
      } else {
        sessions = [
          {
            id: nanoid(8),
            name: trimmed,
            paths,
            activePath,
            updatedAt: now,
          },
          ...s.sessions,
        ];
      }
      sessions = sessions
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
      return { sessions, sessionNameOpen: false };
    });
    await get().persist();
    return true;
  },

  requestOpenSession: (id) => {
    const session = get().sessions.find((x) => x.id === id);
    if (!session) return;
    const dirtyIds = get()
      .tabs.filter((t) => t.dirty)
      .map((t) => t.id);
    if (dirtyIds.length) {
      set({ confirm: { kind: "openSession", tabIds: dirtyIds, sessionId: id } });
      return;
    }
    void get().openSession(id);
  },

  openSession: async (id) => {
    const session = get().sessions.find((x) => x.id === id);
    if (!session) return;
    const loaded: TabState[] = [];
    const missing: string[] = [];
    for (const path of session.paths) {
      const tab = await loadTabFromPath(path);
      if (tab) loaded.push(tab);
      else missing.push(path);
    }
    const zh = get().settings.locale === "zh-CN";
    if (!loaded.length) {
      await api.nativeMessage(
        "Jotpad",
        zh
          ? "会话中的文件均无法打开（可能已移动或删除）。"
          : "None of the session files could be opened (moved or deleted).",
      );
      return;
    }
    const activeTabId =
      loaded.find((t) => t.filePath === session.activePath)?.id ?? loaded[0].id;
    set((s) => ({
      tabs: loaded,
      activeTabId,
      findOpen: false,
      replaceOpen: false,
      recentFiles: [
        ...loaded.map((t) => t.filePath!).filter(Boolean),
        ...s.recentFiles,
      ]
        .filter((p, i, arr) => arr.indexOf(p) === i)
        .slice(0, MAX_RECENT),
      sessions: s.sessions
        .map((x) => (x.id === id ? { ...x, updatedAt: Date.now() } : x))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }));
    if (missing.length) {
      const list = missing.map((p) => basename(p)).join(", ");
      await api.nativeMessage(
        "Jotpad",
        zh
          ? `以下文件无法打开，已跳过：${list}`
          : `Skipped missing files: ${list}`,
      );
    }
    await get().persist();
  },

  clearSessions: () => {
    set({ sessions: [] });
    void get().persist();
  },

  checkExternalChanges: async () => {
    if (get().reloadPrompt) return;
    // 原生文件对话框打开时窗口会失焦，此时检测容易误报
    if (nativeFileDialogDepth > 0) return;
    for (const tab of get().tabs) {
      if (!tab.filePath || tab.diskMtimeMs == null) continue;
      try {
        const m = await api.fileMtime(tab.filePath);
        if (m === tab.diskMtimeMs) continue;
        // 自己刚保存，或保存后同步层再次触碰文件：只刷新基准
        if (isRecentSelfWrite(tab.filePath)) {
          const path = tab.filePath;
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.filePath === path ? { ...t, diskMtimeMs: m } : t,
            ),
          }));
          continue;
        }
        // mtime 变了但内容一致（同步/备份工具只碰时间戳）：静默刷新基准，不打扰
        const path = tab.filePath;
        try {
          const r = await api.readFile(path);
          if (r.text === tab.content) {
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.filePath === path
                  ? {
                      ...t,
                      diskMtimeMs: r.mtime_ms,
                      size: r.size,
                      encoding: r.encoding,
                      hasBom: r.has_bom,
                      lineEnding: r.line_ending,
                    }
                  : t,
              ),
            }));
            continue;
          }
        } catch {
          /* 读取失败：退回按外部修改提示 */
        }
        set({ reloadPrompt: { tabId: tab.id, path: tab.filePath } });
        return;
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

    // 覆盖前先把未保存内容快照进本地历史，保证被磁盘版本替换后还能找回
    if (tab.dirty) {
      try {
        const { recordLocalHistory } = await import("@/lib/history");
        recordLocalHistory(tab.filePath, tab.content, "auto");
      } catch {
        /* ignore */
      }
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

  setSettings: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    schedulePersist();
  },

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

  toggleReadOnly: () => {
    const id = get().activeTabId;
    const tab = get().activeTab();
    if (id && tab) get().updateTab(id, { readOnly: !tab.readOnly });
  },

  setFindOpen: (v) => set({ findOpen: v, replaceOpen: v ? get().replaceOpen : false }),
  setReplaceOpen: (v) => set({ replaceOpen: v, findOpen: v ? true : get().findOpen }),
  setGotoOpen: (v) => set({ gotoOpen: v }),
  setQuickOpenOpen: (v) => set({ quickOpenOpen: v }),
  setCrossSearchOpen: (v) => set({ crossSearchOpen: v }),
  setOutlineOpen: (v) => set({ outlineOpen: v }),
  setPreviewOpen: (v) => set({ previewOpen: v }),
  setSettingsOpen: (v) => {
    set({ settingsOpen: v });
    // 离开设置页时落盘，避免仅改设置未触发其他 persist 时丢失
    if (!v) void get().persist();
  },
  setAboutOpen: (v) => set({ aboutOpen: v }),
  setPageSetupOpen: (v) => set({ pageSetupOpen: v }),
  setDiffOpen: (v) => set({ diffOpen: v }),

  openDiff: async () => {
    const tab = get().activeTab();
    if (!tab?.filePath) {
      await api.nativeMessage("Jotpad", get().settings.locale === "zh-CN" ? "该文件尚未保存到磁盘，无法与磁盘版本对比。" : "This file is not saved to disk; nothing to compare.");
      return;
    }
    try {
      const r = await api.readFile(tab.filePath);
      const result = diffLines(tab.content, r.text);
      set({
        diffOpen: true,
        diffData: { name: basename(tab.filePath), lines: result.lines, same: result.same },
      });
    } catch (e) {
      await api.nativeMessage("Jotpad", String(e));
    }
  },
  setSessionNameOpen: (v) => set({ sessionNameOpen: v }),
  setHistoryOpen: (v) => set({ historyOpen: v }),
  setMenuOpen: (m) => set({ menuOpen: m }),

  toggleAlwaysOnTop: async () => {
    const next = !get().alwaysOnTop;
    try {
      await getCurrentWindow().setAlwaysOnTop(next);
      set({ alwaysOnTop: next });
    } catch (e) {
      console.error("setAlwaysOnTop failed", e);
    }
  },

  setVoiceOpen: (v) => set({ voiceOpen: v }),
  setVoiceSetupOpen: (v) => set({ voiceSetupOpen: v }),
  setSettingsFocus: (v) => set({ settingsFocus: v }),

  refreshVoicePack: async () => {
    try {
      const status = await api.voicePackStatus();
      set({ voicePack: status });
    } catch (e) {
      set({
        voicePack: {
          state: "error",
          version: null,
          engine: null,
          path: null,
          error: e instanceof Error ? e.message : String(e),
          received: 0,
          total: 0,
        },
      });
    }
  },

  requestVoiceDictation: async () => {
    await get().refreshVoicePack();
    const pack = get().voicePack;
    if (pack?.state === "ready") {
      set({ voiceSetupOpen: false, voiceOpen: true, findOpen: false, replaceOpen: false });
    } else {
      set({ voiceOpen: false, voiceSetupOpen: true });
    }
  },

  checkForUpdates: async (opts) => {
    const manual = !!opts?.manual;
    const locale = get().settings.locale;
    const t = (key: string, params?: Record<string, string | number>) =>
      translate(locale, key, params);
    const skippedVersion = get().settings.skippedUpdateVersion;

    if (manual) set({ aboutOpen: false });

    showToast({
      id: UPDATE_TOAST_ID,
      title: t("update.checking"),
      dismissible: false,
      durationMs: null,
      progress: null,
    });

    const result = await checkForAppUpdate({ skippedVersion });

    if (result.status === "upToDate") {
      if (manual) {
        showToast({
          id: UPDATE_TOAST_ID,
          title: t("update.upToDate"),
          variant: "success",
          dismissible: true,
          durationMs: 3000,
        });
      } else {
        dismissToast(UPDATE_TOAST_ID);
      }
      return;
    }

    if (result.status === "error") {
      if (manual) {
        showToast({
          id: UPDATE_TOAST_ID,
          title: t("update.title"),
          body: result.message || t("update.checkFailed"),
          variant: "error",
          dismissible: true,
          durationMs: null,
          actions: [
            {
              id: "open",
              label: t("update.openDownload"),
              onClick: () => void get().openUpdateDownloadPage(),
            },
          ],
        });
      } else {
        dismissToast(UPDATE_TOAST_ID);
      }
      return;
    }

    if (!manual && result.skipped) {
      await discardPendingUpdate();
      dismissToast(UPDATE_TOAST_ID);
      return;
    }

    if (result.status === "ready") {
      showReadyUpdateToast(get, result.version, result.notes, result.canInstallInApp, result.skipped);
      return;
    }

    // available → 自动下载
    if (!result.canInstallInApp) {
      showToast({
        id: UPDATE_TOAST_ID,
        title: t("update.availableTitle", { version: result.version }),
        body: [result.notes?.trim(), t("update.linuxManualHint")].filter(Boolean).join("\n\n"),
        dismissible: true,
        durationMs: null,
        actions: [
          {
            id: "skip",
            label: t("update.skip"),
            quiet: true,
            onClick: () => void get().skipPendingUpdate(),
          },
          {
            id: "open",
            label: t("update.openDownload"),
            primary: true,
            onClick: () => void get().openUpdateDownloadPage(),
          },
        ],
      });
      return;
    }

    showToast({
      id: UPDATE_TOAST_ID,
      title: t("update.downloadingTitle", { version: result.version }),
      body: t("update.downloading"),
      dismissible: false,
      durationMs: null,
      progress: null,
    });

    try {
      await downloadPending((pct) => {
        updateToast(UPDATE_TOAST_ID, {
          title: t("update.downloadingTitle", { version: result.version }),
          body:
            pct == null
              ? t("update.downloading")
              : t("update.downloadingPct", { pct: String(pct) }),
          progress: pct,
          dismissible: false,
        });
      });
      showReadyUpdateToast(get, result.version, result.notes, true, result.skipped);
    } catch (e) {
      showToast({
        id: UPDATE_TOAST_ID,
        title: t("update.title"),
        body: e instanceof Error ? e.message : String(e),
        variant: "error",
        dismissible: true,
        durationMs: null,
        actions: [
          {
            id: "open",
            label: t("update.openDownload"),
            onClick: () => void get().openUpdateDownloadPage(),
          },
        ],
      });
    }
  },

  skipPendingUpdate: async () => {
    const ver = getPendingUpdateVersion();
    if (ver) {
      set((s) => ({
        settings: { ...s.settings, skippedUpdateVersion: ver },
      }));
      void get().persist();
    }
    await discardPendingUpdate();
    dismissToast(UPDATE_TOAST_ID);
  },

  installPendingUpdate: async () => {
    if (!getCanInstallInApp()) {
      await get().openUpdateDownloadPage();
      return;
    }
    const dirtyIds = get()
      .tabs.filter((t) => t.dirty)
      .map((t) => t.id);
    if (dirtyIds.length) {
      set({ confirm: { kind: "update", tabIds: dirtyIds } });
      return;
    }
    await get().proceedInstallUpdate();
  },

  proceedInstallUpdate: async () => {
    const locale = get().settings.locale;
    const t = (key: string, params?: Record<string, string | number>) =>
      translate(locale, key, params);
    const ver = getPendingUpdateVersion() || "";
    showToast({
      id: UPDATE_TOAST_ID,
      title: t("update.installingTitle", { version: ver }),
      body: t("update.installing"),
      dismissible: false,
      durationMs: null,
      progress: null,
    });
    try {
      await get().persist();
      set((s) => ({
        settings: { ...s.settings, skippedUpdateVersion: null },
      }));
      await get().persist();
      await installPending();
    } catch (e) {
      showToast({
        id: UPDATE_TOAST_ID,
        title: t("update.title"),
        body: e instanceof Error ? e.message : String(e),
        variant: "error",
        dismissible: true,
        durationMs: null,
        actions: [
          {
            id: "retry",
            label: t("update.install"),
            primary: true,
            onClick: () => void get().installPendingUpdate(),
          },
        ],
      });
    }
  },

  openUpdateDownloadPage: async () => {
    try {
      await openReleasesPage();
    } catch (e) {
      console.error("open releases failed", e);
    }
  },

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

type StoreGet = () => Store;

function showReadyUpdateToast(
  get: StoreGet,
  version: string,
  notes: string | null,
  canInstallInApp: boolean,
  skipped: boolean,
) {
  const locale = get().settings.locale;
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(locale, key, params);
  let body = notes?.trim() || t("update.readyBody", { version });
  if (skipped) body = `${t("update.skippedHint")}\n\n${body}`;
  if (!canInstallInApp) body = `${body}\n\n${t("update.linuxManualHint")}`;

  showToast({
    id: UPDATE_TOAST_ID,
    title: t("update.readyTitle", { version }),
    body,
    variant: "success",
    dismissible: true,
    durationMs: null,
    actions: [
      {
        id: "skip",
        label: t("update.skip"),
        quiet: true,
        onClick: () => void get().skipPendingUpdate(),
      },
      canInstallInApp
        ? {
            id: "install",
            label: t("update.install"),
            primary: true,
            onClick: () => void get().installPendingUpdate(),
          }
        : {
            id: "open",
            label: t("update.openDownload"),
            primary: true,
            onClick: () => void get().openUpdateDownloadPage(),
          },
    ],
  });
}
