/**
 * Central shortcut catalog — single source of truth for:
 * - menu display labels
 * - native (Tauri/muda) accelerators
 * - global keydown matching
 *
 * To add a shortcut: append a ShortcutDef below, then wire the action id
 * in runMenuAction (if new). Menu items pick up label/accel via `sc(id)`.
 */

import { ALT, MOD, platform } from "@/lib/utils";

export type Plat = "macos" | "windows" | "linux";

/** One physical key combination. */
export interface Chord {
  /**
   * `KeyboardEvent.key` value(s). Letters/digits are matched case-insensitively;
   * special keys (`Tab`, `F5`, `ArrowRight`, `PageDown`, `Escape`, `=`, `+`, `,`)
   * must match exactly.
   */
  key: string | readonly string[];
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  /** Always Ctrl (e.g. Ctrl+Tab on every platform). */
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Restrict this chord to a platform slice. */
  when?: "macos" | "not-macos" | Plat;
}

export interface ShortcutDef {
  /** Action id — usually matches a `runMenuAction` case. */
  id: string;
  /** Key combinations that fire this action. */
  chords?: readonly Chord[];
  /**
   * Menu display text. Omit when the item has no visible shortcut.
   * May be platform-aware.
   */
  label?: string | ((p: Plat) => string);
  /**
   * Tauri/muda accelerator (`CmdOrCtrl+…`). `null` / omit = no native accel
   * (still may be captured in the webview via `chords`).
   */
  accel?: string | ((p: Plat) => string | null) | null;
  /**
   * Capture in the App-level keydown handler and dispatch `runMenuAction`.
   * Default: `true` when `chords` is non-empty.
   * Set `false` for editor-native / OS-predefined items (undo, cut, …).
   */
  capture?: boolean;
}

/** CmdOrCtrl+… helper for accelerators. */
const A = (k: string) => `CmdOrCtrl+${k}`;

function currentPlat(): Plat {
  return platform();
}

function whenOk(when: Chord["when"], p: Plat): boolean {
  if (!when) return true;
  if (when === "not-macos") return p !== "macos";
  return when === p;
}

function keyMatches(e: KeyboardEvent, spec: string): boolean {
  if (spec.length === 1 || /^[a-z0-9]$/i.test(spec)) {
    return e.key.toLowerCase() === spec.toLowerCase();
  }
  return e.key === spec;
}

function chordMatches(e: KeyboardEvent, c: Chord, p: Plat): boolean {
  if (!whenOk(c.when, p)) return false;

  const keys = typeof c.key === "string" ? [c.key] : c.key;
  if (!keys.some((k) => keyMatches(e, k))) return false;

  const wantMod = !!c.mod;
  const wantCtrl = !!c.ctrl;
  const wantShift = !!c.shift;
  const wantAlt = !!c.alt;
  const isMac = p === "macos";

  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;

  if (isMac) {
    // Cmd and Ctrl are distinct on macOS.
    if (wantMod !== e.metaKey) return false;
    if (wantCtrl !== e.ctrlKey) return false;
  } else {
    // On Win/Linux both `mod` and `ctrl` mean the Ctrl key.
    const wantAnyCtrl = wantMod || wantCtrl;
    if (wantAnyCtrl !== e.ctrlKey) return false;
    if (e.metaKey) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Catalog — extend here
// ---------------------------------------------------------------------------

export const SHORTCUTS: readonly ShortcutDef[] = [
  // File
  {
    id: "new",
    chords: [{ key: "n", mod: true }],
    label: `${MOD}+N`,
    accel: A("N"),
  },
  {
    id: "newWindow",
    chords: [{ key: "n", mod: true, shift: true }],
    label: `${MOD}+Shift+N`,
    accel: A("Shift+N"),
  },
  {
    id: "open",
    chords: [{ key: "o", mod: true }],
    label: `${MOD}+O`,
    accel: A("O"),
  },
  {
    id: "quickOpen",
    chords: [{ key: "p", mod: true }],
    label: `${MOD}+P`,
    accel: A("P"),
  },
  {
    id: "crossSearch",
    chords: [{ key: "h", mod: true, shift: true }],
    label: `${MOD}+Shift+H`,
    accel: A("Shift+H"),
  },
  {
    id: "outline",
    chords: [{ key: "o", mod: true, shift: true }],
    label: `${MOD}+Shift+O`,
    accel: A("Shift+O"),
  },
  {
    id: "markdownPreview",
    chords: [{ key: "/", mod: true }],
    label: `${MOD}+/`,
    accel: A("/"),
  },
  {
    id: "closeTab",
    chords: [{ key: "w", mod: true }],
    label: `${MOD}+W`,
    accel: A("W"),
  },
  {
    id: "save",
    chords: [{ key: "s", mod: true }],
    label: `${MOD}+S`,
    accel: A("S"),
  },
  {
    id: "saveAs",
    chords: [{ key: "s", mod: true, shift: true }],
    label: `${MOD}+Shift+S`,
    accel: A("Shift+S"),
  },
  {
    id: "exit",
    label: undefined,
    accel: A("Q"),
    capture: false,
  },

  // Edit — capture:false where CodeMirror / OS predefined owns the key
  {
    id: "undo",
    label: `${MOD}+Z`,
    accel: A("Z"),
    capture: false,
  },
  {
    id: "redo",
    label: (p) => (p === "macos" ? `${MOD}+Shift+Z` : `${MOD}+Y`),
    accel: (p) => (p === "macos" ? A("Shift+Z") : A("Y")),
    capture: false,
  },
  {
    id: "cut",
    label: `${MOD}+X`,
    capture: false,
  },
  {
    id: "copy",
    label: `${MOD}+C`,
    capture: false,
  },
  {
    id: "paste",
    label: `${MOD}+V`,
    capture: false,
  },
  {
    id: "delete",
    label: "Del",
    capture: false,
  },
  {
    id: "find",
    chords: [{ key: "f", mod: true }],
    label: `${MOD}+F`,
    accel: A("F"),
  },
  {
    id: "findNext",
    label: "F3",
    accel: "F3",
    capture: false,
  },
  {
    id: "findPrev",
    label: "Shift+F3",
    accel: "Shift+F3",
    capture: false,
  },
  {
    id: "replace",
    chords: [
      { key: "f", mod: true, alt: true, when: "macos" },
      { key: "h", mod: true, when: "not-macos" },
    ],
    label: (p) => (p === "macos" ? `${MOD}+${ALT}+F` : `${MOD}+H`),
    accel: (p) => (p === "macos" ? A("Alt+F") : A("H")),
  },
  {
    id: "goto",
    chords: [{ key: "g", mod: true }],
    label: `${MOD}+G`,
    accel: A("G"),
  },
  {
    id: "voice",
    chords: [{ key: "r", mod: true, shift: true }],
    label: `${MOD}+Shift+R`,
    accel: A("Shift+R"),
  },
  {
    id: "selectAll",
    label: `${MOD}+A`,
    capture: false,
  },
  {
    id: "timeDate",
    chords: [{ key: "F5" }],
    label: "F5",
    accel: "F5",
  },

  // View
  {
    id: "zoomIn",
    // `+` may arrive as key="+" with shift held (US layout Shift+=).
    chords: [
      { key: "=", mod: true },
      { key: "+", mod: true },
      { key: "+", mod: true, shift: true },
    ],
    label: `${MOD}+Plus`,
    accel: A("="),
  },
  {
    id: "zoomOut",
    chords: [{ key: "-", mod: true }],
    label: `${MOD}+-`,
    accel: A("-"),
  },
  {
    id: "zoomReset",
    chords: [{ key: "0", mod: true }],
    label: `${MOD}+0`,
    accel: A("0"),
  },
  {
    id: "settings",
    // 部分布局下逗号可能以 "Comma" 报到
    chords: [
      { key: ",", mod: true },
      { key: "Comma", mod: true },
    ],
    label: `${MOD}+,`,
    accel: A(","),
  },

  // Window
  {
    id: "nextTab",
    chords: [
      { key: "Tab", ctrl: true },
      { key: "PageDown", ctrl: true },
      { key: "ArrowRight", mod: true, alt: true, when: "macos" },
    ],
    label: (p) => (p === "macos" ? `${MOD}+${ALT}+→` : "Ctrl+Tab"),
  },
  {
    id: "prevTab",
    chords: [
      { key: "Tab", ctrl: true, shift: true },
      { key: "PageUp", ctrl: true },
      { key: "ArrowLeft", mod: true, alt: true, when: "macos" },
    ],
    label: (p) => (p === "macos" ? `${MOD}+${ALT}+←` : "Ctrl+Shift+Tab"),
  },
  {
    id: "alwaysOnTop",
    chords: [{ key: "t", mod: true, shift: true }],
    label: `${MOD}+Shift+T`,
    accel: A("Shift+T"),
  },

  // Overlay dismiss (not a menu action)
  {
    id: "escape",
    chords: [{ key: "Escape" }],
  },
];

const BY_ID: ReadonlyMap<string, ShortcutDef> = new Map(
  SHORTCUTS.map((s) => [s.id, s]),
);

export function getShortcut(id: string): ShortcutDef | undefined {
  return BY_ID.get(id);
}

function resolveLabel(def: ShortcutDef, p: Plat = currentPlat()): string | undefined {
  if (def.label == null) return undefined;
  return typeof def.label === "function" ? def.label(p) : def.label;
}

function resolveAccel(def: ShortcutDef, p: Plat = currentPlat()): string | undefined {
  if (def.accel == null) return undefined;
  const v = typeof def.accel === "function" ? def.accel(p) : def.accel;
  return v ?? undefined;
}

/** Menu display shortcut text for an action id. */
export function shortcutLabel(id: string, p: Plat = currentPlat()): string | undefined {
  const def = BY_ID.get(id);
  return def ? resolveLabel(def, p) : undefined;
}

/** Native accelerator string for an action id. */
export function shortcutAccel(id: string, p: Plat = currentPlat()): string | undefined {
  const def = BY_ID.get(id);
  return def ? resolveAccel(def, p) : undefined;
}

/**
 * Spread onto a menu item: `{ id: "new", label: …, ...sc("new") }`.
 */
export function sc(id: string): { shortcut?: string; accel?: string } {
  const def = BY_ID.get(id);
  if (!def) return {};
  const p = currentPlat();
  const shortcut = resolveLabel(def, p);
  const accel = resolveAccel(def, p);
  return {
    ...(shortcut ? { shortcut } : {}),
    ...(accel ? { accel } : {}),
  };
}

export type ShortcutHit =
  | { kind: "action"; id: string }
  | { kind: "tabJump"; index: number }
  | { kind: "escape" };

function shouldCapture(def: ShortcutDef): boolean {
  if (def.capture != null) return def.capture;
  return (def.chords?.length ?? 0) > 0;
}

/**
 * Match a keydown against the catalog (+ Mod+1..9 tab jump).
 * Returns the first capturing hit, or null.
 */
export function matchShortcut(e: KeyboardEvent, p: Plat = currentPlat()): ShortcutHit | null {
  // Mod+1..9 → jump to tab (not listed as individual catalog entries).
  const isMac = p === "macos";
  const hasMod = isMac ? e.metaKey : e.ctrlKey;
  if (
    hasMod &&
    !e.altKey &&
    !e.shiftKey &&
    !(isMac && e.ctrlKey) &&
    /^[1-9]$/.test(e.key)
  ) {
    return { kind: "tabJump", index: parseInt(e.key, 10) };
  }

  for (const def of SHORTCUTS) {
    if (!shouldCapture(def) || !def.chords) continue;
    for (const c of def.chords) {
      if (!chordMatches(e, c, p)) continue;
      // nextTab / prevTab: Ctrl+Tab without shift → next; with shift → prev.
      // Both chords are listed; first matching def wins — order in SHORTCUTS
      // puts nextTab before prevTab, so require exact shift match (already in chord).
      if (def.id === "escape") return { kind: "escape" };
      return { kind: "action", id: def.id };
    }
  }
  return null;
}
