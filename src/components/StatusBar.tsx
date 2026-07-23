import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { subscribeEditor, type EditorInfo } from "@/lib/editorRef";
import { ENCODINGS, LINE_ENDINGS } from "@/types";

const initial: EditorInfo = { line: 1, col: 1, selectedChars: 0, charCount: 0, lineCount: 0 };

export function StatusBar() {
  const show = useStore((s) => s.settings.showStatusBar);
  const settings = useStore((s) => s.settings);
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const setSettings = useStore((s) => s.setSettings);
  const setEncoding = useStore((s) => s.setEncoding);
  const setLineEnding = useStore((s) => s.setLineEnding);
  const t = useT();
  const [info, setInfo] = useState(initial);

  useEffect(() => subscribeEditor(setInfo), []);

  if (!show) return null;

  const sel =
    info.selectedChars > 0 ? ` · ${t("status.selected")} ${info.selectedChars}` : "";

  const cycleEncoding = () => {
    const cur = activeTab?.encoding ?? "UTF-8";
    const idx = ENCODINGS.indexOf(cur);
    setEncoding(ENCODINGS[(idx + 1) % ENCODINGS.length]);
  };
  const cycleLineEnding = () => {
    const cur = activeTab?.lineEnding ?? "CRLF";
    const idx = LINE_ENDINGS.indexOf(cur);
    setLineEnding(LINE_ENDINGS[(idx + 1) % LINE_ENDINGS.length]);
  };

  return (
    <div className="statusbar">
      <span className="sb-item">
        {t("status.line")} {info.line}, {t("status.col")} {info.col}
        {sel}
      </span>
      <span className="sb-item">
        {info.charCount} {t("status.chars")}
      </span>
      <span className="sb-spacer" />
      <span
        className="sb-item sb-click"
        onClick={() => setSettings({ zoom: 100 })}
        title={t("view.zoomReset")}
      >
        {settings.zoom}%
      </span>
      <span className="sb-item sb-click" onClick={cycleEncoding} title={t("view.encoding")}>
        {activeTab?.encoding ?? "UTF-8"}
      </span>
      <span className="sb-item sb-click" onClick={cycleLineEnding} title={t("view.lineEnding")}>
        {activeTab?.lineEnding ?? "CRLF"}
      </span>
    </div>
  );
}
