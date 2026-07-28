// 应用内更新：检查 / 下载 / 安装分离。
// Update 实例与「本会话已下载版本」保存在模块内，避免重复下载。
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { platform } from "@/lib/utils";

export const RELEASES_URL = "https://github.com/ZturnLibs/jotpad/releases/latest";
export const UPDATE_TOAST_ID = "app-update";

let pending: Update | null = null;
/** 本会话内已 download() 完成的版本号；与 pending 配套。 */
let downloadedVersion: string | null = null;
let canInstallInAppCached = true;

export type UpdateCheckResult =
  | { status: "upToDate" }
  | {
      status: "available" | "ready";
      version: string;
      notes: string | null;
      skipped: boolean;
      canInstallInApp: boolean;
    }
  | { status: "error"; message: string };

/** Linux 仅 AppImage 支持 updater 就地安装。 */
export async function canInstallUpdatesInApp(): Promise<boolean> {
  if (platform() !== "linux") return true;
  try {
    const exe = await invoke<string>("current_exe_path");
    const lower = exe.toLowerCase();
    return lower.includes(".appimage") || lower.includes("appimage");
  } catch {
    return false;
  }
}

export function getDownloadedVersion(): string | null {
  return downloadedVersion;
}

export function getPendingUpdateVersion(): string | null {
  return pending?.version ?? null;
}

export function getCanInstallInApp(): boolean {
  return canInstallInAppCached;
}

export async function checkForAppUpdate(opts?: {
  skippedVersion?: string | null;
}): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    if (!update) {
      await discardPendingUpdate();
      return { status: "upToDate" };
    }

    const skipped =
      !!opts?.skippedVersion && opts.skippedVersion === update.version;

    // 本会话已下完同一版本：复用 pending，跳过重复下载
    if (
      pending &&
      downloadedVersion === update.version &&
      pending.version === update.version
    ) {
      try {
        await update.close();
      } catch {
        /* ignore */
      }
      canInstallInAppCached = await canInstallUpdatesInApp();
      return {
        status: "ready",
        version: pending.version,
        notes: pending.body ?? null,
        skipped,
        canInstallInApp: canInstallInAppCached,
      };
    }

    // 远端版本变化或尚无 pending：换新资源
    if (pending && pending.version !== update.version) {
      await discardPendingUpdate();
    }

    if (!pending) {
      pending = update;
      downloadedVersion = null;
    } else if (pending.version === update.version) {
      // 同版本未下完：保留原 pending（可能已有部分进度语义），关掉多余 check 句柄
      try {
        await update.close();
      } catch {
        /* ignore */
      }
    }

    canInstallInAppCached = await canInstallUpdatesInApp();

    if (downloadedVersion === pending.version) {
      return {
        status: "ready",
        version: pending.version,
        notes: pending.body ?? null,
        skipped,
        canInstallInApp: canInstallInAppCached,
      };
    }

    return {
      status: "available",
      version: pending.version,
      notes: pending.body ?? null,
      skipped,
      canInstallInApp: canInstallInAppCached,
    };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

function applyProgress(
  onProgress: ((pct: number | null) => void) | undefined,
  ev: DownloadEvent,
  state: { downloaded: number; contentLength: number | null },
): void {
  switch (ev.event) {
    case "Started":
      state.contentLength =
        typeof ev.data.contentLength === "number" ? ev.data.contentLength : null;
      state.downloaded = 0;
      onProgress?.(state.contentLength && state.contentLength > 0 ? 0 : null);
      break;
    case "Progress":
      state.downloaded += ev.data.chunkLength;
      if (state.contentLength && state.contentLength > 0) {
        onProgress?.(
          Math.min(100, Math.round((state.downloaded / state.contentLength) * 100)),
        );
      } else {
        onProgress?.(null);
      }
      break;
    case "Finished":
      onProgress?.(100);
      break;
  }
}

/** 仅下载，不安装；成功后标记 downloadedVersion。 */
export async function downloadPending(
  onProgress?: (pct: number | null) => void,
): Promise<void> {
  if (!pending) throw new Error("No pending update");
  if (downloadedVersion === pending.version) {
    onProgress?.(100);
    return;
  }
  const state = { downloaded: 0, contentLength: null as number | null };
  await pending.download((ev) => applyProgress(onProgress, ev, state));
  downloadedVersion = pending.version;
}

/** 安装已下载的包并重启。 */
export async function installPending(): Promise<void> {
  if (!pending) throw new Error("No pending update");
  if (downloadedVersion !== pending.version) {
    throw new Error("Update package not downloaded yet");
  }
  await pending.install();
  pending = null;
  downloadedVersion = null;
  await relaunch();
}

export async function openReleasesPage(): Promise<void> {
  await openUrl(RELEASES_URL);
}

export async function discardPendingUpdate(): Promise<void> {
  downloadedVersion = null;
  if (!pending) return;
  try {
    await pending.close();
  } catch {
    /* ignore */
  }
  pending = null;
}
