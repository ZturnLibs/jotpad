import { describe, expect, it } from "vitest";
import {
  buildSearchRegExp,
  isBinary,
  searchText,
} from "@/lib/crossSearch";

describe("searchText", () => {
  it("单行多命中：行号/列/绝对偏移正确", () => {
    const re = /foo/g;
    const hits = searchText("foo bar foo baz", re);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ line: 1, col: 1, from: 0, to: 3 });
    expect(hits[1]).toMatchObject({ line: 1, col: 9, from: 8, to: 11 });
  });

  it("多行：行号随换行推进", () => {
    // idx: 0:a 1:\n 2:b 3:c 4:(space) 5:f..7:o | 8:\n 9:f..11:o
    const text = "a\nbc foo\nfoo";
    const hits = searchText(text, /foo/g);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ line: 2, col: 4, from: 5, to: 8 });
    expect(hits[1]).toMatchObject({ line: 3, col: 1, from: 9, to: 12 });
  });

  it("大小写不敏感（由正则 flags 决定）", () => {
    expect(searchText("Foo FOO foo", /foo/gi)).toHaveLength(3);
    expect(searchText("Foo FOO foo", /foo/g)).toHaveLength(1);
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
