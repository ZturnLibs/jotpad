import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import * as api from "@/lib/backend";
import { basename } from "@/lib/backend";
import { formatBytes } from "@/lib/utils";
import { getEditorView } from "@/lib/editorRef";
import type { DiffHunk, HistoryEntry } from "@/lib/backend";

type DiffViewState = {
  leftLabel: string;
  rightLabel: string;
  hunks: DiffHunk[];
};

function formatTime(ms: number, locale: string): string {
  try {
    return new Date(ms).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US");
  } catch {
    return String(ms);
  }
}

/** 本地历史：时间线 + 与当前/磁盘统一 diff。 */
export function HistoryPanel() {
  const open = useStore((s) => s.historyOpen);
  const setOpen = useStore((s) => s.setHistoryOpen);
  const tab = useStore((s) => s.activeTab());
  const locale = useStore((s) => s.settings.locale);
  const updateTab = useStore((s) => s.updateTab);
  const t = useT();

  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffViewState | null>(null);
  const [busy, setBusy] = useState(false);

  const path = tab?.filePath ?? null;

  const reload = useCallback(async () => {
    if (!path) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await api.historyList(path);
      setEntries(list);
      setSelectedId((id) => (id && list.some((e) => e.id === id) ? id : list[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!open) {
      setDiff(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      await reload();
      if (cancelled) return;
      // 外部变更提示打开时，自动展示缓冲 vs 磁盘
      const { reloadPrompt, activeTab: getActive } = useStore.getState();
      const current = getActive();
      if (!reloadPrompt || !current?.filePath || reloadPrompt.path !== current.filePath) return;
      try {
        const disk = await api.readFile(current.filePath);
        const hunks = await api.historyDiff(disk.text, current.content);
        if (cancelled) return;
        setDiff({
          leftLabel: t("history.diskVersion"),
          rightLabel: t("history.currentBuffer"),
          hunks,
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, reload, t]);

  if (!open) return null;

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  const runDiff = async (leftText: string, leftLabel: string, rightText: string, rightLabel: string) => {
    setBusy(true);
    setError(null);
    try {
      const hunks = await api.historyDiff(leftText, rightText);
      setDiff({ leftLabel, rightLabel, hunks });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const compareToCurrent = async () => {
    if (!selected || !tab) return;
    const left = await api.historyGet(selected.contentHash);
    await runDiff(left, formatTime(selected.createdAt, locale), tab.content, t("history.currentBuffer"));
  };

  const compareToDisk = async () => {
    if (!path || !tab) return;
    try {
      const disk = await api.readFile(path);
      await runDiff(disk.text, t("history.diskVersion"), tab.content, t("history.currentBuffer"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const compareSelectedToDisk = async () => {
    if (!selected || !path) return;
    try {
      const left = await api.historyGet(selected.contentHash);
      const disk = await api.readFile(path);
      await runDiff(left, formatTime(selected.createdAt, locale), disk.text, t("history.diskVersion"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const restoreSelected = async () => {
    if (!selected || !tab) return;
    const ok = await api.nativeConfirm(
      t("history.title"),
      t("history.restoreConfirm"),
      t("history.restore"),
      t("dialog.cancel"),
    );
    if (!ok) return;
    setBusy(true);
    try {
      const text = await api.historyGet(selected.contentHash);
      updateTab(tab.id, { content: text, dirty: true });
      if (useStore.getState().activeTabId === tab.id) {
        const view = getEditorView();
        if (view) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
          });
        }
      }
      setDiff(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (!selected || !path) return;
    setBusy(true);
    try {
      await api.historyDeleteEntry(path, selected.id);
      await reload();
      setDiff(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!path) return;
    const ok = await api.nativeConfirm(
      t("history.title"),
      t("history.clearConfirm"),
      t("history.clear"),
      t("dialog.cancel"),
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.historyClear(path);
      await reload();
      setDiff(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div className="dialog history-dialog" role="dialog" aria-modal="true" aria-label={t("history.title")}>
        <h3>{t("history.title")}</h3>
        <p className="settings-hint muted">
          {path ? basename(path) : t("history.needSavedFile")}
        </p>

        {!path ? (
          <p className="muted">{t("history.needSavedFileHint")}</p>
        ) : (
          <div className="history-body">
            <div className="history-list-pane">
              {loading ? <p className="muted">{t("history.loading")}</p> : null}
              {!loading && entries.length === 0 ? (
                <p className="muted">{t("history.empty")}</p>
              ) : null}
              <ul className="history-list">
                {entries.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      className={"history-item" + (e.id === selectedId ? " active" : "")}
                      onClick={() => {
                        setSelectedId(e.id);
                        setDiff(null);
                      }}
                    >
                      <span className="history-item-time">{formatTime(e.createdAt, locale)}</span>
                      <span className="history-item-meta muted">
                        {formatBytes(e.byteLen)} · {e.source}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="history-list-actions">
                <button type="button" className="btn" disabled={!path || busy} onClick={() => void compareToDisk()}>
                  {t("history.compareDisk")}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!entries.length || busy}
                  onClick={() => void clearAll()}
                >
                  {t("history.clear")}
                </button>
              </div>
            </div>

            <div className="history-detail-pane">
              {selected ? (
                <div className="history-detail-actions">
                  <button type="button" className="btn primary" disabled={busy} onClick={() => void compareToCurrent()}>
                    {t("history.compareCurrent")}
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void compareSelectedToDisk()}>
                    {t("history.compareEntryDisk")}
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void restoreSelected()}>
                    {t("history.restore")}
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void deleteSelected()}>
                    {t("history.delete")}
                  </button>
                </div>
              ) : (
                <p className="muted">{t("history.pickEntry")}</p>
              )}

              {diff ? (
                <div className="history-diff">
                  <div className="history-diff-labels muted">
                    <span>− {diff.leftLabel}</span>
                    <span>+ {diff.rightLabel}</span>
                  </div>
                  <pre className="history-diff-body">
                    {diff.hunks.map((h, i) => (
                      <span key={i} className={`diff-${h.tag}`}>
                        {h.text}
                      </span>
                    ))}
                  </pre>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {error ? <p className="settings-hint settings-error">{error}</p> : null}

        <div className="dialog-actions">
          <button type="button" className="btn primary" onClick={() => setOpen(false)}>
            {t("settings.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
