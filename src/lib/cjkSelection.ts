import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView, type MouseSelectionStyle } from "@codemirror/view";

/**
 * CJK 词边界选词：修复 CodeMirror 双击中文选中整段的缺陷。
 * 设计详见 docs/design-cjk-word-selection.md。
 */

/** CJK 扩展 A + 统一汉字 + 兼容汉字 + 日文假名 + 韩文音节。命中才接管双击。 */
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter === "undefined") return null;
  if (!segmenter) segmenter = new Intl.Segmenter("zh", { granularity: "word" });
  return segmenter;
}

/**
 * 返回 pos 所属词的文档区间 [from, to)。
 * 命中标点 / 空白段（isWordLike=false），或不支持 Intl.Segmenter 时返回 null（交回默认 groupAt）。
 * 仅在 pos 所在逻辑行内分词，不跨行。
 */
export function wordRangeAt(
  state: EditorState,
  pos: number,
): { from: number; to: number } | null {
  const seg = getSegmenter();
  if (!seg) return null;
  const line = state.doc.lineAt(pos);
  const rel = pos - line.from;
  for (const s of seg.segment(line.text)) {
    if (rel >= s.index && rel < s.index + s.segment.length) {
      if (!s.isWordLike) return null;
      return { from: line.from + s.index, to: line.from + s.index + s.segment.length };
    }
  }
  return null;
}

/**
 * 仅接管「双击 + 点中 CJK 字符」的选词；其余一律返回 null 交默认 basicMouseSelection。
 * 这是 @codemirror/view 官方 rectangularSelectionStyle 的同款模式（返回 null 即回落默认），
 * 单击 / 三击 / 拖拽 / 英文双击完全不受影响。
 */
export const cjkWordSelection = EditorView.mouseSelectionStyle.of(
  (view, event): MouseSelectionStyle | null => {
    if (event.detail !== 2) return null;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return null;
    if (!CJK_RE.test(view.state.sliceDoc(pos, pos + 1))) return null;

    const startSel = view.state.selection;
    let startPos = pos;

    return {
      update: (update) => {
        if (update.docChanged) startPos = update.changes.mapPos(startPos);
      },
      get: (curEvent, extend, multiple) => {
        const cur = view.posAtCoords({ x: curEvent.clientX, y: curEvent.clientY });
        const at = cur ?? startPos;
        const wr = wordRangeAt(view.state, at);
        let range = wr ? EditorSelection.range(wr.from, wr.to) : EditorSelection.cursor(at);

        // 双击后拖拽：按词扩选，对齐默认 groupAt 的拖拽语义
        if (startPos !== at && !extend && wr) {
          const sr = wordRangeAt(view.state, startPos);
          if (sr) {
            range = EditorSelection.range(Math.min(sr.from, wr.from), Math.max(sr.to, wr.to));
          }
        }
        if (extend) return startSel.replaceRange(startSel.main.extend(range.from, range.to));
        if (multiple) return startSel.addRange(range);
        return EditorSelection.create([range]);
      },
    };
  },
);
