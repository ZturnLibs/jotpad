import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "@/store/useStore";
import { showToast } from "@/lib/toast";
import { useT } from "@/lib/i18n";
import { ACCENT_PRESETS, FONT_PRESETS, type Locale, type StartupMode, type ThemeMode } from "@/types";
import { clamp } from "@/lib/utils";
import * as api from "@/lib/backend";
import { Icon } from "./icons";

type SettingsTab = "appearance" | "editor" | "general" | "voice";

const TABS: { id: SettingsTab; labelKey: string }[] = [
  { id: "general", labelKey: "settings.general" },
  { id: "editor", labelKey: "settings.editor" },
  { id: "appearance", labelKey: "settings.appearance" },
  { id: "voice", labelKey: "settings.voice" },
];

function firstName(f: string): string {
  const m = f.match(/^"([^"]+)"|^([^,]+)/);
  return m ? m[1] ?? m[2] ?? f : f;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? "active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className="menu-row settings-toggle"
      style={{ cursor: disabled ? "default" : "pointer", borderRadius: 6, opacity: disabled ? 0.6 : 1 }}
    >
      <span className="label">{label}</span>
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16 }}
      />
    </label>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

/** 全屏设置页：左栏导航 + 返回，右栏配置详情。 */
export function Settings() {
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setSettingsFocus = useStore((s) => s.setSettingsFocus);
  const voicePack = useStore((s) => s.voicePack);
  const refreshVoicePack = useStore((s) => s.refreshVoicePack);
  const t = useT();
  const [tab, setTab] = useState<SettingsTab>("general");
  const [shellNew, setShellNew] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);
  const [shellBusy, setShellBusy] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [shellPlatform, setShellPlatform] = useState<string>("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState<{
    phase: string;
    received: number;
    total: number;
  } | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [systemDocumentsDir, setSystemDocumentsDir] = useState<string | null>(null);

  useEffect(() => {
    // 进入设置页时按 focus 定位分区；默认外观
    const focus = useStore.getState().settingsFocus;
    if (focus === "voice") {
      setTab("voice");
      setSettingsFocus(null);
    } else {
      setTab("general");
    }
  }, [setSettingsFocus]);

  useEffect(() => {
    let cancelled = false;
    void api
      .documentsDir()
      .then((dir) => {
        if (!cancelled) setSystemDocumentsDir(dir);
      })
      .catch(() => {
        if (!cancelled) setSystemDocumentsDir(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshVoicePack();
    let unlisten: (() => void) | undefined;
    void listen<{ phase: string; received: number; total: number }>("voice-pack-progress", (e) => {
      setVoiceProgress(e.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [refreshVoicePack]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await api.shellIntegrationStatus();
        if (cancelled) return;
        setShellNew(status.newTextFile);
        setShellOpen(status.openWith);
        setShellPlatform(status.platform);
        setShellError(null);
      } catch (e) {
        if (!cancelled) {
          const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e ?? "");
          setShellError(msg || t("settings.shellError"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  function shellPlatformHint(): string {
    if (shellPlatform === "macos") return t("settings.shellHintMac");
    if (shellPlatform === "windows") return t("settings.shellHintWindows");
    if (shellPlatform === "linux") return t("settings.shellHintLinux");
    return "";
  }

  function closeSettings() {
    setOpen(false);
  }

  async function downloadVoicePack() {
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      await api.voicePackDownload();
      await refreshVoicePack();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "cancelled") setVoiceError(msg);
      await refreshVoicePack();
    } finally {
      setVoiceBusy(false);
      setVoiceProgress(null);
    }
  }

  async function deleteVoicePack() {
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      await api.voicePackDelete();
      await refreshVoicePack();
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : String(e));
    } finally {
      setVoiceBusy(false);
    }
  }

  async function toggleShellNew(v: boolean) {
    setShellBusy(true);
    setShellError(null);
    try {
      await api.setShellNewTextFile(v);
      setShellNew(v);
      showToast({
        id: "shell-new",
        title: t(v ? "settings.shellNewOn" : "settings.shellNewOff"),
        variant: "success",
        durationMs: 3000,
      });
    } catch (e) {
      const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e ?? "");
      setShellError(msg || t("settings.shellError"));
    } finally {
      setShellBusy(false);
    }
  }

  async function toggleShellOpen(v: boolean) {
    setShellBusy(true);
    setShellError(null);
    try {
      await api.setShellOpenWith(v);
      setShellOpen(v);
      showToast({
        id: "shell-open",
        title: t(v ? "settings.shellOpenOn" : "settings.shellOpenOff"),
        variant: "success",
        durationMs: 3000,
      });
    } catch (e) {
      const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e ?? "");
      setShellError(msg || t("settings.shellError"));
    } finally {
      setShellBusy(false);
    }
  }

  async function chooseDefaultSaveDirectory() {
    const start = settings.defaultSaveDirectory || systemDocumentsDir || undefined;
    const dir = await api.pickDirectory(start);
    if (!dir) return;
    setSettings({ defaultSaveDirectory: dir });
    await useStore.getState().persist();
  }

  async function resetDefaultSaveDirectory() {
    setSettings({ defaultSaveDirectory: null });
    await useStore.getState().persist();
  }

  const activeTabLabel = t(TABS.find((item) => item.id === tab)?.labelKey ?? "settings.title");

  return (
    <div className="settings-page" role="main" aria-label={t("settings.title")}>
      <div className="settings-page-body">
        <aside className="settings-sidebar">
          {/* 左栏顶部拖动，背景与侧栏一致 */}
          <div className="page-drag" data-tauri-drag-region aria-hidden />
          <div className="settings-sidebar-main">
            <button type="button" className="settings-back" onClick={closeSettings}>
              <Icon name="chevronLeft" size={16} />
              <span>{t("settings.back")}</span>
            </button>
            <h1 className="settings-sidebar-title">{t("settings.title")}</h1>
            <nav className="settings-nav" aria-label={t("settings.title")}>
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={"settings-nav-item" + (tab === item.id ? " active" : "")}
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => setTab(item.id)}
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        <section className="settings-content">
          {/* 右栏顶部拖动，背景与详情区一致 */}
          <div className="page-drag" data-tauri-drag-region aria-hidden />
          <div className="settings-content-main">
            <header className="settings-content-header">
              <h2>{activeTabLabel}</h2>
            </header>
            <div className="settings-panel">
          {tab === "appearance" && (
            <>
              <SettingsSection title={t("view.theme")}>
                <Segmented<ThemeMode>
                  value={settings.theme}
                  onChange={(v) => setSettings({ theme: v })}
                  options={[
                    { value: "light", label: t("view.themeLight") },
                    { value: "dark", label: t("view.themeDark") },
                    { value: "system", label: t("view.themeSystem") },
                  ]}
                />
              </SettingsSection>
              <SettingsSection title={t("settings.accent")}>
                <div className="swatches">
                  {ACCENT_PRESETS.map((c) => (
                    <button
                      key={c}
                      className={"swatch" + (settings.accent === c ? " active" : "")}
                      title={c === "system" ? t("view.themeSystem") : c}
                      style={
                        c === "system"
                          ? { background: "linear-gradient(135deg,#2AA8FF,#6750A4)" }
                          : { background: c }
                      }
                      onClick={() => setSettings({ accent: c })}
                      aria-label={c}
                    />
                  ))}
                </div>
              </SettingsSection>
            </>
          )}

          {tab === "editor" && (
            <>
              <SettingsSection title={t("settings.font")}>
                <div className="field">
                  <select
                    value={settings.fontFamily}
                    onChange={(e) => setSettings({ fontFamily: e.target.value })}
                  >
                    {FONT_PRESETS.map((f) => (
                      <option key={f} value={f} style={{ fontFamily: f }}>
                        {firstName(f)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>{t("settings.fontSize")}</label>
                  <input
                    type="number"
                    min={8}
                    max={72}
                    value={settings.fontSize}
                    onChange={(e) =>
                      setSettings({ fontSize: clamp(parseInt(e.target.value) || 8, 8, 72) })
                    }
                  />
                </div>
              </SettingsSection>
              <SettingsSection title={t("settings.behavior")}>
                <div className="settings-toggles">
                  <Toggle
                    on={settings.wordWrap}
                    onChange={(v) => setSettings({ wordWrap: v })}
                    label={t("settings.wordWrap")}
                  />
                  <Toggle
                    on={settings.showLineNumbers}
                    onChange={(v) => setSettings({ showLineNumbers: v })}
                    label={t("settings.lineNumbers")}
                  />
                  <Toggle
                    on={settings.spellCheck}
                    onChange={(v) => setSettings({ spellCheck: v })}
                    label={t("settings.spellCheck")}
                  />
                </div>
                <p className="settings-hint muted">{t("settings.spellCheckHint")}</p>
              </SettingsSection>
            </>
          )}

          {tab === "general" && (
            <>
              <SettingsSection title={t("settings.language")}>
                <Segmented<Locale>
                  value={settings.locale}
                  onChange={(v) => setSettings({ locale: v })}
                  options={[
                    { value: "zh-CN", label: "中文（简体）" },
                    { value: "en", label: "English" },
                  ]}
                />
              </SettingsSection>
              <SettingsSection title={t("settings.behavior")}>
                <div className="settings-toggles">
                  <Toggle
                    on={settings.showStatusBar}
                    onChange={(v) => setSettings({ showStatusBar: v })}
                    label={t("settings.showStatusBar")}
                  />
                  <Toggle
                    on={settings.autoCheckUpdates}
                    onChange={(v) => {
                      setSettings({ autoCheckUpdates: v });
                      void useStore.getState().persist();
                    }}
                    label={t("settings.autoCheckUpdates")}
                  />
                  <Toggle
                    on={settings.localHistoryEnabled}
                    onChange={(v) => {
                      setSettings({ localHistoryEnabled: v });
                      void useStore.getState().persist();
                    }}
                    label={t("settings.localHistory")}
                  />
                </div>
              </SettingsSection>
              <SettingsSection title={t("settings.startup")}>
                <Segmented<StartupMode>
                  value={settings.startupMode}
                  onChange={(v) => setSettings({ startupMode: v })}
                  options={[
                    { value: "restore", label: t("settings.startupRestore") },
                    { value: "blank", label: t("settings.startupBlank") },
                  ]}
                />
                <p className="settings-hint muted">{t("settings.startupHint")}</p>
              </SettingsSection>
              <SettingsSection title={t("settings.defaultSaveDirectory")}>
                <div className="settings-path-row">
                  <span className="settings-path-value muted">
                    {settings.defaultSaveDirectory ||
                      systemDocumentsDir ||
                      t("settings.systemDocuments")}
                  </span>
                  <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
                    <button type="button" className="btn" onClick={() => void chooseDefaultSaveDirectory()}>
                      {t("settings.chooseDirectory")}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={!settings.defaultSaveDirectory}
                      onClick={() => void resetDefaultSaveDirectory()}
                    >
                      {t("settings.resetDirectory")}
                    </button>
                  </div>
                </div>
                {!settings.defaultSaveDirectory ? (
                  <p className="settings-hint muted">{t("settings.systemDocuments")}</p>
                ) : null}
                <p className="settings-hint muted">{t("settings.defaultSaveDirectoryHint")}</p>
              </SettingsSection>
              <SettingsSection title={t("settings.system")}>
                <p className="settings-hint muted">{t("settings.shellHint")}</p>
                {shellPlatformHint() && (
                  <p className="settings-hint muted">{shellPlatformHint()}</p>
                )}
                <div className="settings-toggles">
                  <Toggle
                    on={shellNew}
                    onChange={(v) => void toggleShellNew(v)}
                    label={t("settings.shellNewTextFile")}
                    disabled={shellBusy}
                  />
                  <Toggle
                    on={shellOpen}
                    onChange={(v) => void toggleShellOpen(v)}
                    label={t("settings.shellOpenWith")}
                    disabled={shellBusy}
                  />
                </div>
                {shellError && <p className="settings-hint settings-error">{shellError}</p>}
              </SettingsSection>
            </>
          )}

          {tab === "voice" && (
            <SettingsSection title={t("settings.voiceStatus")}>
              <p className="settings-hint muted">{t("voice.privacyHint")}</p>
              <p className="settings-hint">
                {voicePack?.state === "ready"
                  ? `${t("voice.packReady")}${voicePack.engine ? ` (${voicePack.engine})` : ""}`
                  : voiceBusy || voicePack?.state === "downloading"
                    ? t("voice.packDownloading")
                    : t("voice.packMissing")}
                {voiceProgress &&
                  voiceProgress.total > 0 &&
                  ` · ${voiceProgress.phase} ${Math.min(
                    100,
                    Math.round((voiceProgress.received / voiceProgress.total) * 100),
                  )}%`}
              </p>
              {voiceError && <p className="settings-hint settings-error">{voiceError}</p>}
              <div className="dialog-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                {voiceBusy ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void api.voicePackCancelDownload()}
                  >
                    {t("voice.cancelDownload")}
                  </button>
                ) : voicePack?.state === "ready" ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={voiceBusy}
                    onClick={() => void deleteVoicePack()}
                  >
                    {t("voice.deletePack")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={voiceBusy}
                    onClick={() => void downloadVoicePack()}
                  >
                    {t("voice.download")}
                  </button>
                )}
              </div>
            </SettingsSection>
          )}
        </div>
          </div>
      </section>
      </div>
    </div>
  );
}
