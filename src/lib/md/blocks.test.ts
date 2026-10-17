import { describe, expect, it } from "vitest";
import { parseBlocks } from "@/lib/md/blocks";

describe("parseBlocks", () => {
  it("空文本与纯空行返回空数组", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("\n\n  \n")).toEqual([]);
  });

  it("标题与段落按空行分块，偏移正确", () => {
    const text = "# 标题\n\n正文一\n正文二";
    expect(parseBlocks(text)).toEqual([
      { from: 0, to: 4, type: "heading" },    // "# 标题" 4 字符
      { from: 6, to: 13, type: "paragraph" }, // "正文一\n正文二"
    ]);
  });

  it("连续列表行聚合为一块（含嵌套缩进）", () => {
    const text = "- a\n- b\n  - c\n\n段落";
    const blocks = parseBlocks(text);
    expect(blocks[0].type).toBe("list");
    expect(blocks[0].from).toBe(0);
    expect(blocks[0].to).toBe(13); // "  - c" 行尾（5 字符行，from 8）
    expect(blocks[1]).toEqual({ from: 15, to: 17, type: "paragraph" });
  });

  it("引用块聚合，内嵌标题仍属 quote", () => {
    const text = "> # 内嵌\n> 续行\n\nx";
    const blocks = parseBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("quote");
    expect(blocks[0].to).toBe(11);
  });

  it("围栏代码跨空行直到闭合围栏", () => {
    const text = "```\na\n\nb\n```\n后文";
    const blocks = parseBlocks(text);
    expect(blocks[0].type).toBe("code");
    expect(blocks[0].to).toBe(12); // 闭合 ``` 行（from 9，3 字符）
    expect(blocks[1].type).toBe("paragraph");
  });

  it("未闭合围栏吞到文末", () => {
    expect(parseBlocks("```\nabc")).toEqual([{ from: 0, to: 7, type: "code" }]);
  });

  it("分隔线单独成块", () => {
    expect(parseBlocks("a\n\n---\n\nb")[1]).toEqual({ from: 3, to: 6, type: "hr" });
  });

  it("契约：仅支持 LF（后端读取时已归一化 CRLF；含 \\r 视为段落）", () => {
    const blocks = parseBlocks("x\r\n\r\n---\r\n\r\ny");
    expect(blocks.every((b) => b.type === "paragraph")).toBe(true);
  });

  it("setext 标题：段落 + ===/--- 升级为 heading", () => {
    // "===" 行 from 3、3 字符，按定义 to=行尾不含 \n，手工核算为 6（修正原稿的 7）
    expect(parseBlocks("标题\n===")).toEqual([{ from: 0, to: 6, type: "heading" }]);
    expect(parseBlocks("标题\n---")[0].type).toBe("heading");
  });

  it("有序列表识别", () => {
    expect(parseBlocks("1. a\n2. b")[0].type).toBe("list");
  });
});
