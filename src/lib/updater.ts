// 应用内更新：检查 / 下载安装 / 打开 Release 页。
// Update 实例保存在模块内，不进 zustand（含原生 resource id）。
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { platform } from "@/lib/utils";

export const RELEASES_URL = "https://github.com/ZturnLibs/jotpad/releases/latest";

let pending: Update | null = null;

export type UpdateCheckResult =
  | { status: "upToDate" }
  | {
      status: "available";
      version: string;
      notes: string | null;
      /** 是否已被用户跳过 */
      skipped: boolean;
      /** Linux 非 AppImage 时为 false，仅引导打开下载页 */
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

export async function checkForAppUpdate(opts?: {
  skippedVersion?: string | null;
}): Promise<UpdateCheckResult> {
  try {
    if (pending) {
      try {
        await pending.close();
      } catch {
        /* ignore */
      }
      pending = null;
    }
    const update = await check();
    if (!update) return { status: "upToDate" };
    pending = update;
    const skipped =
      !!opts?.skippedVersion && opts.skippedVersion === update.version;
    const canInstallInApp = await canInstallUpdatesInApp();
    return {
      status: "available",
      version: update.version,
      notes: update.body ?? null,
      skipped,
      canInstallInApp,
    };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

export function getPendingUpdateVersion(): string | null {
  return pending?.version ?? null;
}

export async function downloadAndInstallPending(
  onProgress?: (pct: number | null) => void,
): Promise<void> {
  if (!pending) throw new Error("No pending update");
  let downloaded = 0;
  let contentLength: number | null = null;
  await pending.downloadAndInstall((ev: DownloadEvent) => {
    switch (ev.event) {
      case "Started":
        contentLength =
          typeof ev.data.contentLength === "number" ? ev.data.contentLength : null;
        downloaded = 0;
        onProgress?.(contentLength && contentLength > 0 ? 0 : null);
        break;
      case "Progress":
        downloaded += ev.data.chunkLength;
        if (contentLength && contentLength > 0) {
          onProgress?.(Math.min(100, Math.round((downloaded / contentLength) * 100)));
        } else {
          onProgress?.(null);
        }
        break;
      case "Finished":
        onProgress?.(100);
        break;
    }
  });
  pending = null;
}

export async function relaunchApp(): Promise<void> {
  await relaunch();
}

export async function openReleasesPage(): Promise<void> {
  await openUrl(RELEASES_URL);
}

export async function discardPendingUpdate(): Promise<void> {
  if (!pending) return;
  try {
    await pending.close();
  } catch {
    /* ignore */
  }
  pending = null;
}
