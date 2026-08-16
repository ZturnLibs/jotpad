import { describe, expect, it } from "vitest";
import {
  buildSearchRegExp,
  isBinary,
  searchText,
} from "@/lib/crossSearch";

describe("searchText", () => {
  it("单行多命中：同行只保留首条（预览去重），偏移正确", () => {
    const re = /foo/g;
    const hits = searchText("foo bar foo baz", re);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ line: 1, col: 1, from: 0, to: 3 });
  });

  it("多行：行号随换行推进，不同行各自保留", () => {
    // "a\nbc foo foo\nfoo": 第二个 foo 在同行被去重；第三行 foo from=13
    const text = "a\nbc foo foo\nfoo";
    const hits = searchText(text, /foo/g);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ line: 2, col: 4, from: 5, to: 8 });
    expect(hits[1]).toMatchObject({ line: 3, col: 1, from: 13, to: 16 });
  });

  it("大小写不敏感（由正则 flags 决定）", () => {
    expect(searchText("Foo FOO", /foo/gi)).toHaveLength(1); // 同行去重后 1 条
    expect(searchText("Foo\nFOO", /foo/gi)).toHaveLength(2); // 不同行各 1 条
  });

  it("整词：buildSearchRegExp 包裹 \\b", () => {
    const re = buildSearchRegExp("foo", { caseSensitive: false, regexp: false, wholeWord: true })!;
    expect(searchText("foo seafood foo2", re).length).toBe(1); // 只匹配独立的 "foo"
  });

  it("单文件命中封顶", () => {
    const text = "x ".repeat(10); // 5 个 "x "→ "x" 出现 10 次
    const hits = searchText(text, /x/g, 3);
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it("零宽匹配不死循环", () => {
    const re = /(?=o)/g; // 零宽
    const hits = searchText("foo", re);
    expect(hits.length).toBeLessThanOrEqual(50);
  });
});

describe("isBinary", () => {
  it("含 NUL 视为二进制", () => {
    expect(isBinary("hello\u0000world")).toBe(true);
  });
  it("纯文本不为二进制", () => {
    expect(isBinary("你好，世界 hello")).toBe(false);
  });
});

describe("buildSearchRegExp", () => {
  it("正则模式原样使用", () => {
    const re = buildSearchRegExp("\\d+", { caseSensitive: false, regexp: true, wholeWord: false });
    expect(re).not.toBeNull();
    expect(re!.test("abc123")).toBe(true);
  });
  it("整词 + 正则 不叠加 \\b", () => {
    const re = buildSearchRegExp("a.b", { caseSensitive: false, regexp: true, wholeWord: true })!;
    expect(re.source).toBe("a.b"); // 正则模式不被包裹
  });
  it("空查询返回 null", () => {
    expect(buildSearchRegExp("", { caseSensitive: false, regexp: false, wholeWord: false })).toBeNull();
  });
});
