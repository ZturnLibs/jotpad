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

/** Show the OS "save file" dialog. Returns a path or null. */
export async function pickSaveFile(defaultName?: string): Promise<string | null> {
  return saveDialog({
    title: "另存为",
    defaultPath: defaultName,
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
