import { describe, expect, it } from "vitest";
import { parseOutline } from "@/lib/outline";

describe("parseOutline", () => {
  it("解析各级 ATX 标题，偏移与行号正确", () => {
    const text = "# Title\nintro\n## Sec A\nbody\n### Sub\n## Sec B";
    const items = parseOutline(text);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ level: 1, text: "Title", from: 0, line: 1 });
    // offsets: "# Title\n"=8 → intro(8)+6=14 → "## Sec A" at 14
    expect(items[1]).toMatchObject({ level: 2, text: "Sec A", from: 14, line: 3 });
    expect(items[2]).toMatchObject({ level: 3, text: "Sub", line: 5 });
    expect(items[3]).toMatchObject({ level: 2, text: "Sec B", line: 6 });
  });

  it("代码围栏内的 # 不算标题", () => {
    const text = "# Real\n```md\n# Fake\n## AlsoFake\n```\n## After";
    const items = parseOutline(text);
    expect(items.map((i) => i.text)).toEqual(["Real", "After"]);
  });

  it("~~~ 围栏与配对开关", () => {
    const text = "# A\n~~~\n# B\n~~~\n# C";
    expect(parseOutline(text).map((i) => i.text)).toEqual(["A", "C"]);
  });

  it("无空格的 # 、超过 6 级、空标题文本均忽略", () => {
    const text = "#nospace\n####### seven\n#\n# \n# OK";
    const items = parseOutline(text);
    expect(items.map((i) => i.text)).toEqual(["OK"]);
  });

  it("尾部闭合 # 序列被去除", () => {
    expect(parseOutline("# Head ##")[0]!.text).toBe("Head");
  });

  it("空文本与纯文本无标题", () => {
    expect(parseOutline("")).toEqual([]);
    expect(parseOutline("plain\ntext only")).toEqual([]);
  });

  it("CRLF 不影响（内容已归一化 LF，防御性验证）", () => {
    expect(parseOutline("# A\r\n## B").map((i) => i.level)).toEqual([1, 2]);
  });
});
