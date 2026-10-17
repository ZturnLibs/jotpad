// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { buildBlockDecorations } from "@/lib/md/decorations";

function stateWith(doc: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({ doc, selection: { anchor, head } });
}

/** 数出装饰区间条数（widget 替换块数）。 */
function decoCount(state: EditorState): number {
  let n = 0;
  buildBlockDecorations(state, 0, state.doc.length, false).between(0, state.doc.length, () => {
    n++;
  });
  return n;
}

describe("buildBlockDecorations", () => {
  const doc = "# 标题\n\n段落一\n\n- 列表\n- 项\n\n> 引用";

  it("光标在段落：其余三块被替换渲染", () => {
    expect(decoCount(stateWith(doc, 7))).toBe(3);
  });

  it("光标进入标题行：标题回源码，其余渲染", () => {
    expect(decoCount(stateWith(doc, 1))).toBe(3);
  });

  it("光标在块尾行末：不属于任何块（全部渲染）", () => {
    // 位置 4 是标题行末（"# 标题" 长 4）→ 不属于任何块，无活动块，全部渲染
    expect(decoCount(stateWith(doc, 4))).toBe(4);
  });

  it("多选区（多光标）：全部回源码（0 个装饰）", () => {
    // Mod-d / Alt+点击产生的两个光标可能落在已渲染块内：必须全部回源码，避免盲编辑不可见文本。
    // 多光标需 allowMultipleSelections 扩展，否则 EditorState.create 会折叠为单选区（Editor.tsx 已启用同款）。
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(20)], 0),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    expect(decoCount(state)).toBe(0);
  });

  it("选区跨块：全部回源码（0 个装饰）", () => {
    expect(decoCount(stateWith(doc, 1, 20))).toBe(0);
  });

  it("suppress=true 时无装饰（查找面板打开）", () => {
    const state = stateWith(doc, 7);
    let n = 0;
    buildBlockDecorations(state, 0, state.doc.length, true).between(0, state.doc.length, () => {
      n++;
    });
    expect(n).toBe(0);
  });
});
