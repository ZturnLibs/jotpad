// Print/page-setup preferences (stored in localStorage, applied via @page CSS).
import type { Locale } from "@/types";

export interface PrintSetup {
  paper: string; // "A4" | "Letter" | "A5" | "Legal"
  orientation: "portrait" | "landscape";
  margin: number; // mm
}

export const PAPER_SIZES = ["A4", "Letter", "A5", "Legal"];

const KEY = "jotpad:printSetup";
export const DEFAULT_PRINT_SETUP: PrintSetup = {
  paper: "A4",
  orientation: "portrait",
  margin: 15,
};

export function loadPrintSetup(): PrintSetup {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "");
    return {
      paper: typeof raw.paper === "string" ? raw.paper : DEFAULT_PRINT_SETUP.paper,
      orientation:
        raw.orientation === "landscape" ? "landscape" : "portrait",
      margin:
        typeof raw.margin === "number" && raw.margin >= 0
          ? raw.margin
          : DEFAULT_PRINT_SETUP.margin,
    };
  } catch {
    return { ...DEFAULT_PRINT_SETUP };
  }
}

export function savePrintSetup(s: PrintSetup): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** CSS @page size value for the given setup. */
export function pageSizeCss(s: PrintSetup): string {
  return s.orientation === "landscape" ? `${s.paper} landscape` : s.paper;
}

export function paperDisplayName(paper: string, _locale: Locale): string {
  return paper;
}
