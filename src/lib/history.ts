// 本地历史：保存后异步快照（失败静默，不打断编辑）。
import * as api from "@/lib/backend";
import { useStore } from "@/store/useStore";

const MAX_ENTRIES = 50;
const MAX_BYTES = 2 * 1024 * 1024;
const MERGE_MS = 15_000;

/** 在成功写入磁盘后调用；尊重设置开关。"auto" 为覆盖未保存内容前的自动快照。 */
export function recordLocalHistory(
  path: string,
  text: string,
  source: "save" | "saveAs" | "auto" = "save",
): void {
  const { settings } = useStore.getState();
  if (!settings.localHistoryEnabled) return;
  if (!path) return;
  void api
    .historyPut(path, text, source, {
      maxEntries: MAX_ENTRIES,
      maxBytes: MAX_BYTES,
      mergeMs: MERGE_MS,
    })
    .catch((e) => console.warn("local history snapshot failed", e));
}
