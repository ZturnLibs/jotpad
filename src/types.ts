// Jotpad shared types.

export type LineEnding = "CRLF" | "LF" | "CR";

export type Encoding =
  | "UTF-8"
  | "UTF-16LE"
  | "UTF-16BE"
  | "GBK"
  | "Big5"
  | "Shift-JIS"
  | "EUC-KR"
  | "Windows-1252";

export const ENCODINGS: Encoding[] = [
  "UTF-8",
  "UTF-16LE",
  "UTF-16BE",
  "GBK",
  "Big5",
  "Shift-JIS",
  "EUC-KR",
  "Windows-1252",
];

export const LINE_ENDINGS: LineEnding[] = ["CRLF", "LF", "CR"];

export type ThemeMode = "light" | "dark" | "system";
export type Locale = "zh-CN" | "en";
/** On launch: restore last tabs, or start with a blank untitled tab. */
export type StartupMode = "restore" | "blank";

export const LOCALES: Locale[] = ["zh-CN", "en"];

/** A named group of on-disk files that can be reopened together. */
export interface NamedSession {
  id: string;
  name: string;
  paths: string[];
  /** Active file path when the session was saved (if still in paths). */
  activePath: string | null;
  updatedAt: number;
}

/** A single open document (tab). */
export interface TabState {
  id: string;
  /** Display title (file name or "新建"). */
  title: string;
  /** Absolute path on disk, or null for an unsaved scratch tab. */
  filePath: string | null;
  /** Document text (line endings normalized to LF internally). */
  content: string;
  encoding: Encoding;
  hasBom: boolean;
  lineEnding: LineEnding;
  /** True if there are unsaved edits. */
  dirty: boolean;
  /** Read-only mode (auto-enabled for very large files, toggled via menu). */
  readOnly: boolean;
  /** Last known on-disk size in bytes. */
  size: number;
  /** Last known on-disk mtime (ms since epoch), or null for untitled. */
  diskMtimeMs: number | null;
  /** Cursor selection, saved on blur / tab switch for restore. */
  selection: { from: number; to: number } | null;
  scrollTop: number;
}

export interface AppSettings {
  theme: ThemeMode;
  locale: Locale;
  fontFamily: string;
  fontSize: number; // px
  wordWrap: boolean;
  zoom: number; // percent
  showStatusBar: boolean;
  showLineNumbers: boolean;
  /** Browser/OS spellcheck on the editor (English etc. via system dictionary). */
  spellCheck: boolean;
  /** Whether to restore open tabs on launch. */
  startupMode: StartupMode;
  accent: string; // "system" or hex like "#0067C0"
  /** 启动后静默检查更新（默认开）。 */
  autoCheckUpdates: boolean;
  /** 用户选择跳过的远端版本号；再次出现同版本时启动检查不弹窗。 */
  skippedUpdateVersion: string | null;
  /** 保存时写入本地历史快照（默认开）。 */
  localHistoryEnabled: boolean;
  /** 自定义默认保存目录；null 表示使用系统「文档」目录。 */
  defaultSaveDirectory: string | null;
}

export interface AppState {
  version: number;
  tabs: TabState[];
  activeTabId: string | null;
  settings: AppSettings;
  recentFiles: string[];
  sessions: NamedSession[];
  /** Pinned file paths (favorite tabs shown at the top of the sidebar). */
  pinnedPaths: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  locale: "zh-CN",
  fontFamily: "Cascadia Code, Consolas, Menlo, Monaco, monospace",
  fontSize: 14,
  wordWrap: true,
  zoom: 100,
  showStatusBar: true,
  showLineNumbers: false,
  spellCheck: false,
  startupMode: "restore",
  accent: "system",
  autoCheckUpdates: true,
  skippedUpdateVersion: null,
  localHistoryEnabled: true,
  defaultSaveDirectory: null,
};

/** Accent color presets shown in Settings. "system" follows the OS accent. */
export const ACCENT_PRESETS: string[] = [
  "system",
  "#0067C0",
  "#007AFF",
  "#6750A4",
  "#107C10",
  "#C42B1C",
  "#CA5010",
  "#603D83",
];

export const FONT_PRESETS = [
  "Cascadia Code, Consolas, Menlo, Monaco, monospace",
  "Consolas, Menlo, Monaco, monospace",
  "Cascadia Code, monospace",
  "Courier New, monospace",
  "ui-monospace, SFMono-Regular, Menlo, monospace",
  "Segoe UI, system-ui, sans-serif",
  "system-ui, sans-serif",
  "-apple-system, BlinkMacSystemFont, sans-serif",
  "Microsoft YaHei, 微软雅黑, sans-serif",
  "PingFang SC, 苹方, sans-serif",
  "SimSun, 宋体, serif",
  "SimHei, 黑体, sans-serif",
  "Arial, sans-serif",
  "Times New Roman, serif",
  "Georgia, serif",
];
