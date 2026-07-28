// 通用 Toast 通知（右下角堆叠）。同 id 原地更新，便于长流程（如应用更新）。
import { useSyncExternalStore } from "react";

export type ToastVariant = "info" | "success" | "error";

export type ToastAction = {
  id: string;
  label: string;
  primary?: boolean;
  /** 次要文字链样式 */
  quiet?: boolean;
  onClick: () => void;
};

export type ToastItem = {
  id: string;
  title: string;
  body?: string;
  variant?: ToastVariant;
  /** 0–100；null 表示不确定进度；undefined 表示无进度条 */
  progress?: number | null;
  /** null/undefined 且未设 durationMs 则不自动关闭；设数字则到期 dismiss */
  durationMs?: number | null;
  actions?: ToastAction[];
  /** 默认 true；下载中等应设 false */
  dismissible?: boolean;
};

type Listener = () => void;

const MAX_TOASTS = 3;
const listeners = new Set<Listener>();
let toasts: ToastItem[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  for (const l of listeners) l();
}

function clearTimer(id: string) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function scheduleAutoDismiss(item: ToastItem) {
  clearTimer(item.id);
  const ms = item.durationMs;
  if (ms == null || ms <= 0) return;
  timers.set(
    item.id,
    setTimeout(() => {
      dismissToast(item.id);
    }, ms),
  );
}

/** 显示或原地更新 Toast（同 id）。 */
export function showToast(input: ToastItem): string {
  const id = input.id;
  const next: ToastItem = {
    variant: "info",
    dismissible: true,
    ...input,
    id,
  };

  const idx = toasts.findIndex((t) => t.id === id);
  if (idx >= 0) {
    toasts = toasts.map((t, i) => (i === idx ? { ...t, ...next, id } : t));
  } else {
    let list = [...toasts, next];
    // 超出上限时挤掉最旧的、可关闭且非当前的
    while (list.length > MAX_TOASTS) {
      const dropIdx = list.findIndex((t) => t.id !== id && t.dismissible !== false);
      if (dropIdx < 0) break;
      clearTimer(list[dropIdx].id);
      list = list.filter((_, i) => i !== dropIdx);
    }
    toasts = list;
  }
  scheduleAutoDismiss(next);
  emit();
  return id;
}

export function updateToast(id: string, patch: Partial<Omit<ToastItem, "id">>): void {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const merged = { ...toasts[idx], ...patch, id };
  toasts = toasts.map((t, i) => (i === idx ? merged : t));
  if ("durationMs" in patch) scheduleAutoDismiss(merged);
  emit();
}

export function dismissToast(id: string): void {
  clearTimer(id);
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function clearToasts(): void {
  for (const id of timers.keys()) clearTimer(id);
  toasts = [];
  emit();
}

export function getToasts(): ToastItem[] {
  return toasts;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React 订阅 Toast 列表。 */
export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, getToasts, getToasts);
}
