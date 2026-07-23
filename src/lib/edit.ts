// Clipboard + cursor insertion helpers operating on the CodeMirror view.
import type { EditorView } from "@codemirror/view";
import type { Locale } from "@/types";

export async function cmCopy(view: EditorView): Promise<void> {
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  const text = view.state.sliceDoc(from, to);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard may be unavailable */
  }
}

export async function cmCut(view: EditorView): Promise<void> {
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  const text = view.state.sliceDoc(from, to);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
  view.dispatch(view.state.replaceSelection(""));
  view.focus();
}

export async function cmPaste(view: EditorView): Promise<void> {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    /* ignore */
  }
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
