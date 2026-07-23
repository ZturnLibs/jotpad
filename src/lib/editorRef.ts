// Bridges the CodeMirror EditorView (imperative) to React components.
import type { EditorView } from "@codemirror/view";

export interface EditorInfo {
  line: number;
  col: number;
  selectedChars: number;
  charCount: number;
  lineCount: number;
}

let view: EditorView | null = null;
const listeners = new Set<(info: EditorInfo) => void>();

export function setEditorView(v: EditorView | null): void {
  view = v;
}

export function getEditorView(): EditorView | null {
  return view;
}

export function subscribeEditor(cb: (info: EditorInfo) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function emitEditorInfo(info: EditorInfo): void {
  listeners.forEach((l) => l(info));
}

/** Compute line/col info from a view's current state. */
export function viewInfo(v: EditorView): EditorInfo {
  const sel = v.state.selection.main;
  const line = v.state.doc.lineAt(sel.head);
  return {
    line: line.number,
    col: sel.head - line.from + 1,
    selectedChars: Math.abs(sel.to - sel.from),
    charCount: v.state.doc.length,
    lineCount: v.state.doc.lines,
  };
}
