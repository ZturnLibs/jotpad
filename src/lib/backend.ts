// Tauri backend command wrappers + system dialog helpers.
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog, message, confirm } from "@tauri-apps/plugin-dialog";
import type { AppState, Encoding, LineEnding } from "@/types";

export interface ReadResult {
  text: string;
  encoding: Encoding;
  line_ending: LineEnding;
  has_bom: boolean;
  size: number;
  mtime_ms: number;
}

export function readFile(path: string): Promise<ReadResult> {
  return invoke<ReadResult>("read_file", { path });
}

export function writeFile(
  path: string,
  text: string,
  encoding: Encoding,
  lineEnding: LineEnding,
  withBom: boolean,
): Promise<void> {
  return invoke<void>("write_file", {
    path,
    text,
    encoding,
    lineEnding,
    withBom,
  });
}

/** On-disk modification time in milliseconds since epoch. */
export function fileMtime(path: string): Promise<number> {
  return invoke<number>("file_mtime", { path });
}

/** Rename a file on disk. Fails if the destination already exists. */
export function renameFile(from: string, to: string): Promise<void> {
  return invoke<void>("rename_file", { from, to });
}

/** Delete a file on disk. */
export function deleteFile(path: string): Promise<void> {
  return invoke<void>("delete_file", { path });
}

/** Write text to the OS clipboard. */
export function clipboardWriteText(text: string): Promise<void> {
  return invoke<void>("clipboard_write_text", { text });
}

/** Reveal a path in the OS file manager (Finder / Explorer). */
export async function revealInFolder(path: string): Promise<void> {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export function readState(): Promise<AppState | null> {
  return invoke<AppState | null>("read_state");
}

export function writeState(state: AppState): Promise<void> {
  return invoke<void>("write_state", { state });
}

/** Best-effort system accent color as [r, g, b]. */
export function getSystemAccent(): Promise<[number, number, number]> {
  return invoke<[number, number, number]>("get_system_accent");
}

/** Show the OS "open file" dialog. Returns a path or null. */
export async function pickOpenFile(): Promise<string | null> {
  const result = await openDialog({
    multiple: false,
    directory: false,
    title: "打开",
  });
  if (!result) return null;
  return typeof result === "string" ? result : null;
}

/** Show the OS "choose directory" dialog. Returns a path or null. */
export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  const result = await openDialog({
    multiple: false,
    directory: true,
    title: "选择文件夹",
    defaultPath,
  });
  if (!result) return null;
  return typeof result === "string" ? result : null;
}

/** 系统「文档」目录绝对路径（各平台路径不同）。 */
export function documentsDir(): Promise<string> {
  return invoke<string>("documents_dir");
}

/**
 * 解析首次保存用的默认目录：
 * 有自定义路径用自定义；否则用系统文档目录。
 */
export async function resolveDefaultSaveDirectory(
  override: string | null | undefined,
): Promise<string | null> {
  if (typeof override === "string" && override.trim()) return override;
  try {
    return await documentsDir();
  } catch {
    return null;
  }
}

/** Show the OS "save file" dialog. Returns a path or null. */
export async function pickSaveFile(defaultPath?: string): Promise<string | null> {
  return saveDialog({
    title: "另存为",
    defaultPath,
  });
}

/** Show a native confirm dialog. */
export async function nativeConfirm(
  title: string,
  message: string,
  okLabel = "确定",
  cancelLabel = "取消",
): Promise<boolean> {
  try {
    return await confirm(message, {
      title,
      kind: "warning",
      okLabel,
      cancelLabel,
    });
  } catch {
    return false;
  }
}

/** Show a native message dialog. */
export async function nativeMessage(title: string, content: string): Promise<void> {
  try {
    await message(content, { title, kind: "info" });
  } catch {
    /* user dismissed */
  }
}

/** Extract the file name from a full path (cross-platform). */
export function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/** Parent directory of a path (cross-platform). Empty string if none. */
export function dirname(path: string): string {
  const match = /^(.*)[/\\][^/\\]*$/.exec(path);
  return match ? match[1] : "";
}

/** Join a directory and file name, preserving the path separator style. */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${name}` : `${dir}${sep}${name}`;
}

export interface ShellIntegrationStatus {
  newTextFile: boolean;
  openWith: boolean;
  platform: string;
}

export function shellIntegrationStatus(): Promise<ShellIntegrationStatus> {
  return invoke<ShellIntegrationStatus>("shell_integration_status");
}

export function setShellNewTextFile(enabled: boolean): Promise<void> {
  return invoke<void>("set_shell_new_text_file", { enabled });
}

export function setShellOpenWith(enabled: boolean): Promise<void> {
  return invoke<void>("set_shell_open_with", { enabled });
}

/** Drain file paths queued before the UI was ready (Open With / argv). */
export function takePendingOpenPaths(): Promise<string[]> {
  return invoke<string[]>("take_pending_open_paths");
}

export type VoicePackState = "missing" | "downloading" | "ready" | "error";

export interface VoicePackStatus {
  state: VoicePackState;
  version: string | null;
  engine: string | null;
  path: string | null;
  error: string | null;
  received: number;
  total: number;
}

export function voicePackStatus(): Promise<VoicePackStatus> {
  return invoke<VoicePackStatus>("voice_pack_status");
}

export function voicePackDownload(): Promise<VoicePackStatus> {
  return invoke<VoicePackStatus>("voice_pack_download");
}

export function voicePackCancelDownload(): Promise<void> {
  return invoke<void>("voice_pack_cancel_download");
}

export function voicePackDelete(): Promise<void> {
  return invoke<void>("voice_pack_delete");
}

export function voiceTranscribe(wavBytes: number[] | Uint8Array): Promise<string> {
  const bytes = wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const wavB64 = btoa(binary);
  return invoke<string>("voice_transcribe", { wavB64 });
}

export function writeBytes(path: string, bytes: Uint8Array | number[]): Promise<void> {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]!);
  const contentsB64 = btoa(binary);
  return invoke<void>("write_bytes", { path, contentsB64 });
}

// ---------- Local history (CAS snapshots) ----------

export interface HistoryEntry {
  id: string;
  contentHash: string;
  createdAt: number;
  source: string;
  byteLen: number;
}

export interface HistorySnapshotResult {
  entry: HistoryEntry | null;
  skipped: boolean;
  reason: string | null;
}

export interface DiffHunk {
  tag: "equal" | "insert" | "delete" | string;
  text: string;
}

export function historyPut(
  path: string,
  text: string,
  source: string,
  opts?: { maxEntries?: number; maxBytes?: number; mergeMs?: number },
): Promise<HistorySnapshotResult> {
  return invoke<HistorySnapshotResult>("history_put", {
    path,
    text,
    source,
    maxEntries: opts?.maxEntries ?? null,
    maxBytes: opts?.maxBytes ?? null,
    mergeMs: opts?.mergeMs ?? null,
  });
}

export function historyList(path: string): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("history_list", { path });
}

export function historyGet(contentHash: string): Promise<string> {
  return invoke<string>("history_get", { contentHash });
}

export function historyDeleteEntry(path: string, entryId: string): Promise<void> {
  return invoke<void>("history_delete_entry", { path, entryId });
}

export function historyClear(path: string): Promise<void> {
  return invoke<void>("history_clear", { path });
}

export function historyDiff(left: string, right: string): Promise<DiffHunk[]> {
  return invoke<DiffHunk[]>("history_diff", { left, right });
}
