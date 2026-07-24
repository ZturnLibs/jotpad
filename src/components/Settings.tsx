import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { ACCENT_PRESETS, FONT_PRESETS, type Locale, type ThemeMode } from "@/types";
import { clamp } from "@/lib/utils";

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

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="menu-row settings-toggle" style={{ cursor: "pointer", borderRadius: 6 }}>
      <span className="label">{label}</span>
      <input
        type="checkbox"
        checked={on}
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

  useEffect(() => {
    if (open) setTab("appearance");
  }, [open]);

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
                </div>
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
