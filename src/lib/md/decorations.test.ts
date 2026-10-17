// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  BulletWidget,
  buildBlockDecorations,
  buildSourceStyling,
} from "@/lib/md/decorations";
import { parseBlocks } from "@/lib/md/blocks";

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

  it("块尾边界与块后空行归本块活动域（前块保持源码）", () => {
    // 位置 4 是标题行末（"# 标题" 长 4）→ 归标题扩展活动域（吞并块后空行带）：
    // 标题保持源码（光标可见），其余三块渲染。不变量：光标位置永不被替换装饰覆盖。
    expect(decoCount(stateWith(doc, 4))).toBe(3);
  });

  it("光标在块间空行：前块保持源码、后块渲染", () => {
    // "# 标题"(0..4) + 3 个空行(4..7) + "段落"(8..10)：光标 6 严格落在标题块尾与段落 from
    // 之间的空行带上 → 归标题活动域：标题无装饰（源码可见），段落渲染（1 个装饰）
    const gapDoc = "# 标题\n\n\n\n段落";
    expect(decoCount(stateWith(gapDoc, 6))).toBe(1);
  });

  it("光标在末块之后的尾随空行：末块保持源码", () => {
    // "段落"(0..3) + 2 个空行(3..5)：文档末（5）光标归末块活动域（末块装饰吞并尾随空行）
    // → 末块保持源码，0 个装饰（否则光标落在被吞并区边界不可见）
    expect(decoCount(stateWith("段落\n\n\n", 5))).toBe(0);
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

  it("替换区间吞并块间分隔空行（间距由边距提供）", () => {
    // 标题后 3 个空行，光标在段落内（段=8）→ 标题块被渲染
    const gapDoc = "# 标题\n\n\n\n段落";
    const state = stateWith(gapDoc, 9);
    let rangeEnd = -1;
    buildBlockDecorations(state, 0, state.doc.length, false).between(0, 5, (from, to) => {
      if (from === 0) rangeEnd = to;
    });
    // 不变量：标题块装饰终点 == 下一块（段落）的 from，即块尾换行 + 3 个分隔空行被吞并
    const expected = parseBlocks(gapDoc)[1].from;
    expect(rangeEnd).toBe(expected);
    // 手算锚点：# 标题(0..3) + 4 个 \n(4..7) → 段落 from=8（防止 parseBlocks 漂移使断言空转）
    expect(expected).toBe(8);
  });
});

describe("buildSourceStyling（活动块渲染态编辑）", () => {
  /** 收集装饰区间。line=行类（零宽+class）、mark=强调色、replace=替换（可能带 widget）。 */
  function collect(state: EditorState, suppress = false) {
    const out: Array<{
      from: number;
      to: number;
      kind: "line" | "mark" | "replace";
      className?: string;
      widget?: unknown;
    }> = [];
    buildSourceStyling(state, 0, state.doc.length, suppress).between(
      0,
      state.doc.length,
      (from, to, value) => {
        const spec = value.spec as { class?: string; widget?: unknown };
        const kind = to > from && spec.class ? "mark" : spec.class ? "line" : "replace";
        out.push({ from, to, kind, className: spec.class, widget: spec.widget });
      },
    );
    // 不变量顺带断言：.between 按集合序遍历，from 必须非降（RangeSetBuilder 升序约束）
    for (let i = 1; i < out.length; i++) expect(out[i].from).toBeGreaterThanOrEqual(out[i - 1].from);
    return out;
  }

  it("光标在标题块：标题行类 + 零宽隐藏 '# '（无 widget）", () => {
    // "# 标题"=0..4，段落=6..8；光标 2 在标题块内
    const ds = collect(stateWith("# 标题\n\n段落", 2));
    expect(ds.some((d) => d.kind === "line" && d.className === "cm-md-h1" && d.from === 0)).toBe(
      true,
    );
    const rep = ds.filter((d) => d.kind === "replace");
    expect(rep.length).toBe(1);
    expect([rep[0].from, rep[0].to]).toEqual([0, 2]); // "# "
    expect(rep[0].widget).toBeUndefined(); // 纯隐藏，无 widget
  });

  it("光标在列表块：'- ' → BulletWidget，标记区无强调色 mark 重叠", () => {
    // "- 项目"=0..4，正文=7..9；光标 3 在列表块内
    const ds = collect(stateWith("- 项目\n\n正文", 3));
    const rep = ds.filter((d) => d.kind === "replace");
    expect(rep.length).toBe(1);
    expect([rep[0].from, rep[0].to]).toEqual([0, 2]); // "- "
    expect(rep[0].widget).toBeInstanceOf(BulletWidget);
    expect(ds.some((d) => d.kind === "mark" && d.from < 2 && d.to > 0)).toBe(false);
  });

  it("光标在其他块：列表行退回源码态强调色 mark，无替换", () => {
    const ds = collect(stateWith("- 项目\n\n正文", 8));
    expect(ds.some((d) => d.kind === "replace")).toBe(false);
    const marks = ds.filter((d) => d.kind === "mark");
    expect(marks.length).toBe(1);
    expect(marks[0].className).toBe("cm-md-marker");
    expect([marks[0].from, marks[0].to]).toEqual([0, 2]);
  });

  it("suppress=true：仅标题行类 + 标记强调色，无替换/引用类", () => {
    // "# 标题"(0..4) "- 列表"(6..10) "> 引用"(12..16)
    const doc = "# 标题\n\n- 列表\n\n> 引用";
    const ds = collect(stateWith(doc, 2), true);
    expect(ds.some((d) => d.kind === "replace")).toBe(false);
    expect(ds.some((d) => d.className === "cm-md-quote" || d.className === "cm-md-codeline")).toBe(
      false,
    );
    expect(
      ds
        .filter((d) => d.kind === "line")
        .map((d) => d.className)
        .filter((c) => c?.startsWith("cm-md-h")),
    ).toEqual(["cm-md-h1"]);
    expect(
      ds.filter((d) => d.kind === "mark").map((d) => [d.from, d.to]),
    ).toEqual([
      [0, 2], // "# "
      [6, 8], // "- "
      [12, 14], // "> "
    ]);
  });

  it("多光标：无活动块（仅行类 + 强调色，不替换）", () => {
    const doc = "# 标题\n\n- 列表\n\n> 引用";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(14)], 0),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    const ds = collect(state);
    expect(ds.some((d) => d.kind === "replace")).toBe(false);
    expect(ds.some((d) => d.className === "cm-md-quote")).toBe(false);
    expect(ds.filter((d) => d.kind === "mark").length).toBe(3);
  });

  it("光标在引用块：隐藏 '> ' + 引用行类；代码块行仅底色（含行内 '#' 不标题化）", () => {
    // "> 引用"(0..4) 围栏块(6..17)：```(6..9) "# c"(10..13) ```(14..17)
    const doc = "> 引用\n\n```\n# c\n```";
    const ds = collect(stateWith(doc, 3));
    const rep = ds.filter((d) => d.kind === "replace");
    expect(rep.length).toBe(1);
    expect([rep[0].from, rep[0].to]).toEqual([0, 2]); // "> "（不含 > 前空格场景下的纯 >+空格）
    expect(rep[0].widget).toBeUndefined();
    expect(ds.some((d) => d.kind === "line" && d.className === "cm-md-quote" && d.from === 0)).toBe(
      true,
    );
    // 代码块三行全部仅 cm-md-codeline；行内 "# c" 不再标题化/强调化（代码逐字内容）
    const codeLines = ds.filter((d) => d.className === "cm-md-codeline").map((d) => d.from);
    expect(codeLines).toEqual([6, 10, 14]);
    expect(ds.some((d) => d.className === "cm-md-h1")).toBe(false);
    expect(ds.some((d) => d.kind === "mark")).toBe(false);
  });
});
