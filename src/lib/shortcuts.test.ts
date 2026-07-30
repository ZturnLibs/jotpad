import { describe, expect, it } from "vitest";
import { matchShortcut, sc, shortcutAccel, shortcutLabel } from "./shortcuts";

function key(
  keyName: string,
  mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {},
): KeyboardEvent {
  return {
    key: keyName,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
  } as KeyboardEvent;
}

describe("shortcuts catalog", () => {
  it("sc() returns label and accel for known ids", () => {
    const s = sc("new");
    expect(s.shortcut).toMatch(/\+N$/);
    expect(s.accel).toBe("CmdOrCtrl+N");
  });

  it("shortcutLabel is platform-aware for replace", () => {
    expect(shortcutLabel("replace", "macos")).toContain("F");
    expect(shortcutLabel("replace", "windows")).toBe("Ctrl+H");
    expect(shortcutAccel("replace", "macos")).toBe("CmdOrCtrl+Alt+F");
    expect(shortcutAccel("replace", "windows")).toBe("CmdOrCtrl+H");
  });

  it("matches Mod+N as new on macOS", () => {
    expect(matchShortcut(key("n", { meta: true }), "macos")).toEqual({
      kind: "action",
      id: "new",
    });
  });

  it("matches Mod+Shift+N as newWindow", () => {
    expect(matchShortcut(key("n", { meta: true, shift: true }), "macos")).toEqual({
      kind: "action",
      id: "newWindow",
    });
  });

  it("matches Ctrl+Tab / Ctrl+Shift+Tab for tab cycling", () => {
    expect(matchShortcut(key("Tab", { ctrl: true }), "windows")).toEqual({
      kind: "action",
      id: "nextTab",
    });
    expect(matchShortcut(key("Tab", { ctrl: true, shift: true }), "windows")).toEqual({
      kind: "action",
      id: "prevTab",
    });
  });

  it("matches Cmd+Option+Arrow on macOS for tabs", () => {
    expect(
      matchShortcut(key("ArrowRight", { meta: true, alt: true }), "macos"),
    ).toEqual({ kind: "action", id: "nextTab" });
    expect(
      matchShortcut(key("ArrowLeft", { meta: true, alt: true }), "macos"),
    ).toEqual({ kind: "action", id: "prevTab" });
  });

  it("matches Mod+1..9 as tabJump", () => {
    expect(matchShortcut(key("3", { ctrl: true }), "linux")).toEqual({
      kind: "tabJump",
      index: 3,
    });
  });

  it("does not capture undo (editor-owned)", () => {
    expect(matchShortcut(key("z", { meta: true }), "macos")).toBeNull();
  });

  it("matches Escape", () => {
    expect(matchShortcut(key("Escape"), "macos")).toEqual({ kind: "escape" });
  });

  it("matches Mod+, as settings", () => {
    expect(matchShortcut(key(",", { meta: true }), "macos")).toEqual({
      kind: "action",
      id: "settings",
    });
    expect(matchShortcut(key(",", { ctrl: true }), "windows")).toEqual({
      kind: "action",
      id: "settings",
    });
    expect(shortcutAccel("settings")).toBe("CmdOrCtrl+,");
  });
});
