// Bridges the CodeMirror EditorView (imperative) to React components.
import type { EditorView } from "@codemirror/view";
import { countWords, selectedLineCount } from "@/lib/textStats";

export interface EditorInfo {
  line: number;
  col: number;
  selectedChars: number;
  selectedWords: number;
  selectedLines: number;
  charCount: number;
  wordCount: number;
  lineCount: number;
}

let view: EditorView | null = null;
const listeners = new Set<(info: EditorInfo) => void>();

export function setEditorView(v: EditorView | null): void {
  view = v;
}

/** 程序化整体替换文档期间的深度标记；Editor 的 updateListener 借此不把替换计入用户修改（dirty）。 */
let programmaticDocDepth = 0;

export function beginProgrammaticDocChange(): void {
  programmaticDocDepth += 1;
}

export function endProgrammaticDocChange(): void {
  programmaticDocDepth = Math.max(0, programmaticDocDepth - 1);
}

export function isProgrammaticDocChange(): boolean {
  return programmaticDocDepth > 0;
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

/** Compute line/col/stats from a view's current state. */
export function viewInfo(v: EditorView): EditorInfo {
  const sel = v.state.selection.main;
  const line = v.state.doc.lineAt(sel.head);
  const doc = v.state.doc.toString();
  const selected =
    sel.from === sel.to ? "" : v.state.sliceDoc(Math.min(sel.from, sel.to), Math.max(sel.from, sel.to));
  return {
    line: line.number,
    col: sel.head - line.from + 1,
    selectedChars: Math.abs(sel.to - sel.from),
    selectedWords: countWords(selected),
    selectedLines: selectedLineCount(sel.from, sel.to, (pos) => v.state.doc.lineAt(pos).number),
    charCount: v.state.doc.length,
    wordCount: countWords(doc),
    lineCount: v.state.doc.lines,
  };
}
