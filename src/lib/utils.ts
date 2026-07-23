// Small shared utilities.

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Debounce a function by `wait` ms. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** Format a byte count into a human-readable string. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Current OS platform, best-effort. */
export function platform(): "macos" | "windows" | "linux" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  return "linux";
}

/** Is the given event a navigation/shortcut key on the current platform (Cmd on mac, Ctrl elsewhere). */
export function isMod(e: KeyboardEvent | MouseEvent): boolean {
  return platform() === "macos" ? e.metaKey : e.ctrlKey;
}

export const MOD = platform() === "macos" ? "Cmd" : "Ctrl";
export const ALT = platform() === "macos" ? "Option" : "Alt";
