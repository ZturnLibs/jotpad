// Clipboard + cursor insertion helpers operating on the CodeMirror view.
// Prefer OS/DOM native edit commands; fall back to the native clipboard
// bridge (Rust/arboard) so we never trip the WebView "Paste" permission UI.
import type { EditorView } from "@codemirror/view";
import type { Locale } from "@/types";
import { invoke } from "@tauri-apps/api/core";

async function nativeClipboardRead(): Promise<string> {
  try {
    return await invoke<string>("clipboard_read_text");
  } catch {
    return "";
  }
}

async function nativeClipboardWrite(text: string): Promise<void> {
  try {
    await invoke("clipboard_write_text", { text });
  } catch {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard may be unavailable */
    }
  }
}

/** Prefer DOM execCommand so the focused editable receives a real cut/copy/paste. */
function tryExec(command: "cut" | "copy" | "paste" | "selectAll"): boolean {
  try {
    return document.execCommand(command);
  } catch {
    return false;
  }
}

export async function cmCopy(view: EditorView): Promise<void> {
  view.focus();
  if (tryExec("copy")) return;
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  await nativeClipboardWrite(view.state.sliceDoc(from, to));
}

export async function cmCut(view: EditorView): Promise<void> {
  view.focus();
  if (tryExec("cut")) return;
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  await nativeClipboardWrite(view.state.sliceDoc(from, to));
  view.dispatch(view.state.replaceSelection(""));
  view.focus();
}

export async function cmPaste(view: EditorView): Promise<void> {
  view.focus();
  // Native paste injects via the paste event (no Clipboard API permission UI).
  if (tryExec("paste")) return;
  const text = await nativeClipboardRead();
  if (text) view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

export function cmDelete(view: EditorView): void {
  view.dispatch(view.state.replaceSelection(""));
  view.focus();
}

export function insertAtCursor(view: EditorView, text: string): void {
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

export function selectAll(view: EditorView): void {
  view.focus();
  if (tryExec("selectAll")) return;
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  view.focus();
}

/** Locale-aware time/date string, mimicking Notepad's F5. */
export function timeDateString(locale: Locale): string {
  const now = new Date();
  const time = now.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = now.toLocaleDateString(locale);
  return `${time} ${date}`;
}
