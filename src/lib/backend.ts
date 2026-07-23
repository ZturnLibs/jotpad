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

export function readState(): Promise<AppState | null> {
  return invoke<AppState | null>("read_state");
}

export function writeState(state: AppState): Promise<void> {
  return invoke<void>("write_state", { state });
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
