import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { ACCENT_PRESETS, FONT_PRESETS, type Locale, type StartupMode, type ThemeMode } from "@/types";
import { clamp } from "@/lib/utils";
import * as api from "@/lib/backend";

type SettingsTab = "appearance" | "editor" | "general";

const TABS: { id: SettingsTab; labelKey: string }[] = [
  { id: "appearance", labelKey: "settings.appearance" },
  { id: "editor", labelKey: "settings.editor" },
  { id: "general", labelKey: "settings.general" },
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

export function Settings() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const t = useT();
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const [shellNew, setShellNew] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);
  const [shellBusy, setShellBusy] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [shellPlatform, setShellPlatform] = useState<string>("");

  useEffect(() => {
    if (open) setTab("appearance");
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, t]);

  function shellPlatformHint(): string {
    if (shellPlatform === "macos") return t("settings.shellHintMac");
    if (shellPlatform === "windows") return t("settings.shellHintWindows");
    if (shellPlatform === "linux") return t("settings.shellHintLinux");
    return "";
  }

  async function toggleShellNew(v: boolean) {
    setShellBusy(true);
    setShellError(null);
    try {
      await api.setShellNewTextFile(v);
      setShellNew(v);
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
    } catch (e) {
      const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e ?? "");
      setShellError(msg || t("settings.shellError"));
    } finally {
      setShellBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="dialog settings" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
        <h3>{t("settings.title")}</h3>

        <div className="settings-body">
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

          <div className="settings-panel">
            {tab === "appearance" && (
              <>
                <div className="field">
                  <label>{t("view.theme")}</label>
                  <Segmented<ThemeMode>
                    value={settings.theme}
                    onChange={(v) => setSettings({ theme: v })}
                    options={[
                      { value: "light", label: t("view.themeLight") },
                      { value: "dark", label: t("view.themeDark") },
                      { value: "system", label: t("view.themeSystem") },
                    ]}
                  />
                </div>
                <div className="field">
                  <label>{t("settings.accent")}</label>
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
                </div>
              </>
            )}

            {tab === "editor" && (
              <>
                <div className="field">
                  <label>{t("settings.font")}</label>
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
              </>
            )}

            {tab === "general" && (
              <>
                <div className="field">
                  <label>{t("settings.language")}</label>
                  <Segmented<Locale>
                    value={settings.locale}
                    onChange={(v) => setSettings({ locale: v })}
                    options={[
                      { value: "zh-CN", label: "中文（简体）" },
                      { value: "en", label: "English" },
                    ]}
                  />
                </div>
                <div className="settings-toggles">
                  <Toggle
                    on={settings.showStatusBar}
                    onChange={(v) => setSettings({ showStatusBar: v })}
                    label={t("settings.showStatusBar")}
                  />
                </div>
                <div className="field" style={{ marginTop: 12 }}>
                  <label>{t("settings.startup")}</label>
                  <Segmented<StartupMode>
                    value={settings.startupMode}
                    onChange={(v) => setSettings({ startupMode: v })}
                    options={[
                      { value: "restore", label: t("settings.startupRestore") },
                      { value: "blank", label: t("settings.startupBlank") },
                    ]}
                  />
                  <p className="settings-hint muted">{t("settings.startupHint")}</p>
                </div>
                <div className="field" style={{ marginTop: 12 }}>
                  <label>{t("settings.system")}</label>
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
                </div>
              </>
            )}
          </div>
        </div>

        <div className="dialog-actions">
          <button className="btn primary" onClick={() => setOpen(false)}>
            {t("settings.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
