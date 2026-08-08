import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { wordRangeAt } from "@/lib/cjkSelection";

const state = (doc: string) => EditorState.create({ doc });

describe("wordRangeAt (CJK 词边界选词)", () => {
  it("落在中文词中间，返回该词区间", () => {
    // "文字"(0-1) "大"(2) "爆炸"(3-4) "是"(5) "真实"(6-7) "需求"(8-9) "吗"(10)
    const s = state("文字大爆炸是真实需求吗");
    expect(wordRangeAt(s, 0)).toEqual({ from: 0, to: 2 }); // "文字"
    expect(wordRangeAt(s, 3)).toEqual({ from: 3, to: 5 }); // "爆炸"
    expect(wordRangeAt(s, 6)).toEqual({ from: 6, to: 8 }); // "真实"
    expect(wordRangeAt(s, 8)).toEqual({ from: 8, to: 10 }); // "需求"
  });

  it("落在中文标点段返回 null（交默认选标点本身）", () => {
    // "你好"(0-1) "，"(2) "世界"(3-4)
    const s = state("你好，世界");
    expect(wordRangeAt(s, 2)).toBeNull();
    expect(wordRangeAt(s, 0)).toEqual({ from: 0, to: 2 });
    expect(wordRangeAt(s, 3)).toEqual({ from: 3, to: 5 });
  });

  it("只在光标所在逻辑行内分词，不跨行", () => {
    // line1 "文字大爆炸"(0-4) 换行(5) line2 "是真实需求"(6..)
    // line2: "是"(6) "真实"(7-8) "需求"(9-10)
    const s = state("文字大爆炸\n是真实需求");
    expect(wordRangeAt(s, 6)).toEqual({ from: 6, to: 7 }); // "是"
    expect(wordRangeAt(s, 7)).toEqual({ from: 7, to: 9 }); // "真实"
  });

  it("中英混排时各自分词", () => {
    // "hello"(0-4) " "(5) "世界"(6-7)
    const s = state("hello 世界");
    expect(wordRangeAt(s, 6)).toEqual({ from: 6, to: 8 }); // "世界"
    // 英文段也是 wordLike，wordRangeAt 作为纯分词器会返回其区间；
    // 「只接管 CJK」的门控由 cjkWordSelection 工厂负责，与此函数正交。
    expect(wordRangeAt(s, 0)).toEqual({ from: 0, to: 5 }); // "hello"
  });
});
