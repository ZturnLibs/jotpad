import { describe, expect, it } from "vitest";
import { basename, dirname, joinPath } from "@/lib/backend";
import { pageSizeCss, type PrintSetup } from "@/lib/print";
import { clamp } from "@/lib/utils";
import { countWords, selectedLineCount } from "@/lib/textStats";
import { fuzzyFilter, fuzzyScore } from "@/lib/fuzzy";

describe("path helpers", () => {
  it("basename handles posix and windows separators", () => {
    expect(basename("/tmp/a/notes.txt")).toBe("notes.txt");
    expect(basename("C:\\Users\\a\\notes.txt")).toBe("notes.txt");
    expect(basename("notes.txt")).toBe("notes.txt");
  });

  it("dirname returns parent", () => {
    expect(dirname("/tmp/a/notes.txt")).toBe("/tmp/a");
    expect(dirname("C:\\Users\\a\\notes.txt")).toBe("C:\\Users\\a");
  });

  it("joinPath preserves separator style", () => {
    expect(joinPath("/tmp/a", "b.txt")).toBe("/tmp/a/b.txt");
    expect(joinPath("C:\\Users\\a", "b.txt")).toBe("C:\\Users\\a\\b.txt");
  });
});

describe("print helpers", () => {
  it("pageSizeCss respects orientation", () => {
    const base: PrintSetup = { paper: "A4", orientation: "portrait", margin: 15 };
    expect(pageSizeCss(base)).toBe("A4");
    expect(pageSizeCss({ ...base, orientation: "landscape" })).toBe("A4 landscape");
  });
});

describe("clamp", () => {
  it("bounds values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("textStats", () => {
  it("counts latin words by whitespace", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("  a   b  ")).toBe(2);
    expect(countWords("")).toBe(0);
  });

  it("counts each CJK ideograph as a word", () => {
    expect(countWords("你好世界")).toBe(4);
    expect(countWords("hello 世界")).toBe(3);
  });

  it("selectedLineCount spans inclusive lines", () => {
    const lineAt = (pos: number) => (pos < 5 ? 1 : pos < 10 ? 2 : 3);
    expect(selectedLineCount(0, 0, lineAt)).toBe(0);
    expect(selectedLineCount(0, 4, lineAt)).toBe(1);
    expect(selectedLineCount(0, 9, lineAt)).toBe(2);
  });
});

describe("fuzzy", () => {
  it("matches subsequences", () => {
    expect(fuzzyScore("nt", "notes.txt")).not.toBeNull();
    expect(fuzzyScore("xyz", "notes.txt")).toBeNull();
  });

  it("ranks prefix-ish matches higher", () => {
    const a = fuzzyScore("note", "notes.txt")!;
    const b = fuzzyScore("note", "readme-note.md")!;
    expect(a).toBeGreaterThan(b);
  });

  it("filters and sorts items", () => {
    const items = ["alpha.txt", "beta.log", "readme.md"];
    expect(fuzzyFilter(items, "alph", (x) => x)).toEqual(["alpha.txt"]);
    expect(fuzzyFilter(items, "", (x) => x)).toEqual(items);
  });
});
