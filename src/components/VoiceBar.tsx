import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import * as api from "@/lib/backend";
import { getEditorView } from "@/lib/editorRef";
import { insertAtCursor } from "@/lib/edit";
import { WavRecorder, defaultWavName } from "@/lib/voice/recorder";

type Phase = "idle" | "recording" | "transcribing" | "done" | "error";

function formatElapsed(sec: number): string {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function VoiceBar() {
  const open = useStore((s) => s.voiceOpen);
  const setVoiceOpen = useStore((s) => s.setVoiceOpen);
  const t = useT();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [wav, setWav] = useState<Uint8Array | null>(null);
  const recorderRef = useRef<WavRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  const cleanupTimer = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const close = () => {
    cleanupTimer();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setPhase("idle");
    setWav(null);
    setError(null);
    setElapsed(0);
    setVoiceOpen(false);
    getEditorView()?.focus();
  };

  const startRecording = async () => {
    setError(null);
    setWav(null);
    const rec = new WavRecorder();
    recorderRef.current = rec;
    try {
      await rec.start();
      setPhase("recording");
      setElapsed(0);
      cleanupTimer();
      timerRef.current = window.setInterval(() => {
        setElapsed(rec.elapsed());
      }, 200);
    } catch (e) {
      setPhase("error");
      setError(t("voice.micError"));
      console.error(e);
    }
  };

  // 打开时自动开始录音
  useEffect(() => {
    if (!open) return;
    void startRecording();
    return () => {
      cleanupTimer();
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stopAndTranscribe = async () => {
    cleanupTimer();
    const rec = recorderRef.current;
    if (!rec) return;
    const bytes = rec.stop();
    recorderRef.current = null;
    setWav(bytes);
    setPhase("transcribing");
    try {
      const text = await api.voiceTranscribe(bytes);
      const view = getEditorView();
      if (view && text) {
        const insert = text.endsWith("\n") ? text : `${text}\n`;
        insertAtCursor(view, insert);
      }
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveAudio = async () => {
    if (!wav) return;
    const path = await api.pickSaveFile(defaultWavName());
    if (!path) return;
    try {
      await api.writeBytes(path, wav);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const retryTranscribe = async () => {
    if (!wav) return;
    setPhase("transcribing");
    setError(null);
    try {
      const text = await api.voiceTranscribe(wav);
      const view = getEditorView();
      if (view && text) {
        const insert = text.endsWith("\n") ? text : `${text}\n`;
        insertAtCursor(view, insert);
      }
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) return null;

  return (
    <div className="voicebar" role="region" aria-label={t("voice.title")}>
      <div className="voicebar-row">
        {phase === "recording" && (
          <>
            <span className="voice-dot" aria-hidden />
            <span className="voice-elapsed">{formatElapsed(elapsed)}</span>
            <button type="button" className="btn primary" onClick={() => void stopAndTranscribe()}>
              {t("voice.stop")}
            </button>
          </>
        )}
        {phase === "transcribing" && <span className="muted">{t("voice.transcribing")}</span>}
        {(phase === "done" || phase === "error") && (
          <>
            {phase === "done" && <span className="muted">{t("voice.done")}</span>}
            {phase === "error" && (
              <span className="voice-error" title={error ?? ""}>
                {t("voice.error")}
              </span>
            )}
            {wav && (
              <button type="button" className="btn" onClick={() => void saveAudio()}>
                {t("voice.saveAudio")}
              </button>
            )}
            {phase === "error" && wav && (
              <button type="button" className="btn" onClick={() => void retryTranscribe()}>
                {t("voice.retry")}
              </button>
            )}
            {phase === "done" && (
              <button type="button" className="btn" onClick={() => void startRecording()}>
                {t("voice.recordAgain")}
              </button>
            )}
          </>
        )}
        {phase === "idle" && <span className="muted">{t("voice.starting")}</span>}
        <button type="button" className="btn" onClick={close} style={{ marginLeft: "auto" }}>
          {t("voice.close")}
        </button>
      </div>
      {error && phase === "error" && <p className="voice-error-detail muted">{error}</p>}
    </div>
  );
}

export function VoiceSetupDialog() {
  const open = useStore((s) => s.voiceSetupOpen);
  const setVoiceSetupOpen = useStore((s) => s.setVoiceSetupOpen);
  const setVoiceOpen = useStore((s) => s.setVoiceOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setSettingsFocus = useStore((s) => s.setSettingsFocus);
  const refreshVoicePack = useStore((s) => s.refreshVoicePack);
  const voicePack = useStore((s) => s.voicePack);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    phase: string;
    received: number;
    total: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void refreshVoicePack();
    let unlisten: (() => void) | undefined;
    void listen<{ phase: string; received: number; total: number }>("voice-pack-progress", (e) => {
      setProgress(e.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [open, refreshVoicePack]);

  // 下载完成后自动开录音条
  useEffect(() => {
    if (open && voicePack?.state === "ready" && !busy) {
      setVoiceSetupOpen(false);
      setVoiceOpen(true);
    }
  }, [open, voicePack?.state, busy, setVoiceSetupOpen, setVoiceOpen]);

  if (!open) return null;

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;

  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.voicePackDownload();
      await refreshVoicePack();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "cancelled") setErr(msg);
      await refreshVoicePack();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const cancelDl = async () => {
    try {
      await api.voicePackCancelDownload();
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) setVoiceSetupOpen(false);
      }}
    >
      <div className="dialog" style={{ maxWidth: 420 }}>
        <h3>{t("voice.setupTitle")}</h3>
        <p>{t("voice.setupMsg")}</p>
        {busy && (
          <p className="muted">
            {t("voice.downloading")}
            {progress ? ` (${progress.phase}${pct != null ? ` ${pct}%` : ""})` : "…"}
          </p>
        )}
        {err && <p className="settings-error">{err}</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setVoiceSetupOpen(false)}
          >
            {t("dialog.cancel")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setVoiceSetupOpen(false);
              setSettingsFocus("voice");
              setSettingsOpen(true);
            }}
          >
            {t("voice.openSettings")}
          </button>
          {busy ? (
            <button type="button" className="btn" onClick={() => void cancelDl()}>
              {t("voice.cancelDownload")}
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => void download()}>
              {t("voice.download")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
