import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { FONT_PRESETS, type Locale, type ThemeMode } from "@/types";
import { clamp } from "@/lib/utils";

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
    <label className="menu-row" style={{ cursor: "pointer", borderRadius: 6 }}>
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
  if (!open) return null;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="dialog settings">
        <h3>{t("settings.title")}</h3>

        <section>
          <h4>{t("settings.appearance")}</h4>
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
        </section>

        <section>
          <h4>{t("settings.language")}</h4>
          <Segmented<Locale>
            value={settings.locale}
            onChange={(v) => setSettings({ locale: v })}
            options={[
              { value: "zh-CN", label: "中文（简体）" },
              { value: "en", label: "English" },
            ]}
          />
        </section>

        <section>
          <h4>{t("settings.font")}</h4>
          <div className="field">
            <label>{t("toolbar.font")}</label>
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
        </section>

        <section>
          <h4>{t("settings.behavior")}</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Toggle
              on={settings.wordWrap}
              onChange={(v) => setSettings({ wordWrap: v })}
              label={t("settings.wordWrap")}
            />
            <Toggle
              on={settings.showStatusBar}
              onChange={(v) => setSettings({ showStatusBar: v })}
              label={t("settings.showStatusBar")}
            />
          </div>
        </section>

        <div className="dialog-actions">
          <button className="btn primary" onClick={() => setOpen(false)}>
            {t("dialog.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
