import { useT } from "@/lib/i18n";
import { useStore } from "@/store/useStore";

/** 应用内更新对话框：检查结果、下载进度、错误与跳过。 */
export function UpdateDialog() {
  const open = useStore((s) => s.updateUi.open);
  const phase = useStore((s) => s.updateUi.phase);
  const version = useStore((s) => s.updateUi.version);
  const notes = useStore((s) => s.updateUi.notes);
  const skipped = useStore((s) => s.updateUi.skipped);
  const canInstallInApp = useStore((s) => s.updateUi.canInstallInApp);
  const progress = useStore((s) => s.updateUi.progress);
  const error = useStore((s) => s.updateUi.error);
  const manual = useStore((s) => s.updateUi.manual);
  const dismissUpdateDialog = useStore((s) => s.dismissUpdateDialog);
  const skipPendingUpdate = useStore((s) => s.skipPendingUpdate);
  const installPendingUpdate = useStore((s) => s.installPendingUpdate);
  const openUpdateDownloadPage = useStore((s) => s.openUpdateDownloadPage);
  const t = useT();

  if (!open) return null;

  const busy = phase === "checking" || phase === "downloading";
  const close = () => {
    if (busy) return;
    dismissUpdateDialog();
  };

  let title = t("update.title");
  let body: string | null = null;
  if (phase === "checking") {
    body = t("update.checking");
  } else if (phase === "upToDate") {
    body = t("update.upToDate");
  } else if (phase === "available") {
    title = t("update.availableTitle", { version: version || "" });
    body = notes?.trim() || t("update.availableBody", { version: version || "" });
    if (skipped && manual) {
      body = `${t("update.skippedHint")}\n\n${body}`;
    }
    if (!canInstallInApp) {
      body = `${body}\n\n${t("update.linuxManualHint")}`;
    }
  } else if (phase === "downloading") {
    title = t("update.downloadingTitle");
    body =
      progress == null
        ? t("update.downloading")
        : t("update.downloadingPct", { pct: String(progress) });
  } else if (phase === "error") {
    body = error || t("update.checkFailed");
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="dialog update-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {body ? <p className="update-notes">{body}</p> : null}
        {phase === "downloading" && progress != null ? (
          <div className="update-progress" aria-hidden>
            <div className="update-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        ) : null}
        <div className="dialog-actions">
          {phase === "available" && (
            <>
              <button type="button" className="btn" disabled={busy} onClick={close}>
                {t("update.later")}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void skipPendingUpdate()}
              >
                {t("update.skip")}
              </button>
              {canInstallInApp ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void installPendingUpdate()}
                >
                  {t("update.install")}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void openUpdateDownloadPage()}
                >
                  {t("update.openDownload")}
                </button>
              )}
            </>
          )}
          {(phase === "upToDate" || phase === "error") && (
            <>
              {phase === "error" && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void openUpdateDownloadPage()}
                >
                  {t("update.openDownload")}
                </button>
              )}
              <button type="button" className="btn primary" onClick={close}>
                {t("dialog.cancel")}
              </button>
            </>
          )}
          {phase === "checking" || phase === "downloading" ? (
            <button type="button" className="btn" disabled>
              {phase === "checking" ? t("update.checking") : t("update.downloading")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
