import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { basename } from "@/lib/backend";
import { getEditorView } from "@/lib/editorRef";

/** "Do you want to save?" confirmation (also used for exit). */
export function ConfirmDialog() {
  const confirm = useStore((s) => s.confirm);
  const resolve = useStore((s) => s.resolveConfirm);
  const tabs = useStore((s) => s.tabs);
  const t = useT();

  if (!confirm) return null;

  const first = tabs.find((tb) => tb.id === confirm.tabIds[0]);
  const name = first
    ? first.filePath
      ? basename(first.filePath)
      : t("tab.untitled")
    : "";
  const title =
    confirm.kind === "exit" ? t("dialog.confirmCloseTitle") : t("dialog.saveChangesTitle");
  const msg =
    confirm.kind === "exit"
      ? t("dialog.confirmExitMsg")
      : t("dialog.saveChangesMsg", { name });

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && resolve("cancel")}
    >
      <div className="dialog">
        <h3>{title}</h3>
        <p>{msg}</p>
        <div className="dialog-actions">
          <button className="btn" onClick={() => resolve("cancel")}>
            {t("dialog.cancel")}
          </button>
          <button className="btn" onClick={() => resolve("discard")}>
            {t("dialog.dontSave")}
          </button>
          <button className="btn primary" onClick={() => resolve("save")}>
            {t("dialog.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Go to line dialog. */
export function GotoDialog() {
  const open = useStore((s) => s.gotoOpen);
  const setOpen = useStore((s) => s.setGotoOpen);
  const t = useT();
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setVal("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const go = () => {
    const v = getEditorView();
    const ln = parseInt(val);
    if (v && ln > 0) {
      const line = v.state.doc.line(Math.min(ln, v.state.doc.lines));
      v.dispatch({ selection: { anchor: line.from } });
      v.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
      v.focus();
    }
    setOpen(false);
  };

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div className="dialog" style={{ minWidth: 320 }}>
        <h3>{t("goto.title")}</h3>
        <div className="field">
          <label>{t("goto.line")}</label>
          <input
            ref={inputRef}
            type="number"
            min={1}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go();
              if (e.key === "Escape") setOpen(false);
            }}
          />
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={() => setOpen(false)}>
            {t("dialog.cancel")}
          </button>
          <button className="btn primary" onClick={go}>
            {t("goto.title")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** About dialog. */
export function About() {
  const open = useStore((s) => s.aboutOpen);
  const setOpen = useStore((s) => s.setAboutOpen);
  const t = useT();
  if (!open) return null;
  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div className="dialog" style={{ minWidth: 320 }}>
        <h3>Jotpad</h3>
        <p style={{ whiteSpace: "pre-line" }}>{t("misc.aboutText")}</p>
        <div className="dialog-actions">
          <button className="btn primary" onClick={() => setOpen(false)}>
            {t("dialog.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
