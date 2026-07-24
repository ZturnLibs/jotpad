import { describe, expect, it } from "vitest";
import { basename, dirname, joinPath } from "@/lib/backend";
import { pageSizeCss, type PrintSetup } from "@/lib/print";
import { clamp } from "@/lib/utils";

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
