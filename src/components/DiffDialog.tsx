import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";

export function DiffDialog() {
  const open = useStore((s) => s.diffOpen);
  const data = useStore((s) => s.diffData);
  const setOpen = useStore((s) => s.setDiffOpen);
  const t = useT();

  if (!open || !data) return null;

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div className="dialog diff-dialog">
        <h3>
          {t("diff.title")} — {data.name}
        </h3>
        {data.same ? (
          <p className="muted">{t("diff.noChanges")}</p>
        ) : (
          <div className="diff-content">
            {data.lines.map((l, i) => (
              <div className={"diff-line diff-" + l.type} key={i}>
                <span className="diff-sign">
                  {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
                </span>
                <span className="diff-text">{l.text}</span>
              </div>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button className="btn primary" onClick={() => setOpen(false)}>
            {t("dialog.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
