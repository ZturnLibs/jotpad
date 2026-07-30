// 前端日志：控制台输出；warn/error 同步写入后端 jotpad.log。
import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "info" | "warn" | "error";

function formatDetail(detail: unknown): string {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (detail instanceof Error) return detail.stack || detail.message;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function writeBackend(level: LogLevel, module: string, message: string): void {
  if (level === "info") return;
  void invoke("app_log_write", { level, module, message }).catch(() => {
    /* 日志失败不打扰用户 */
  });
}

export function logInfo(module: string, message: string, detail?: unknown): void {
  const extra = formatDetail(detail);
  console.info(`[${module}] ${message}`, detail ?? "");
  writeBackend("info", module, extra ? `${message} | ${extra}` : message);
}

export function logWarn(module: string, message: string, detail?: unknown): void {
  const extra = formatDetail(detail);
  console.warn(`[${module}] ${message}`, detail ?? "");
  writeBackend("warn", module, extra ? `${message} | ${extra}` : message);
}

export function logError(module: string, message: string, detail?: unknown): void {
  const extra = formatDetail(detail);
  console.error(`[${module}] ${message}`, detail ?? "");
  writeBackend("error", module, extra ? `${message} | ${extra}` : message);
}

/** 将后端错误码映射为用户可见文案；未知码回落通用失败。 */
export function voiceErrorI18nKey(code: string): string {
  const c = code.trim();
  if (c === "voice:nospeech" || c === "voice:empty" || c.includes("voice:nospeech")) {
    return "voice.noSpeech";
  }
  if (
    c === "voice:pack_missing" ||
    c.includes("voice:pack_missing") ||
    c.includes("voice pack not ready")
  ) {
    return "voice.packNotReady";
  }
  if (c === "voice:engine" || c.includes("voice:engine")) return "voice.error";
  return "voice.error";
}
