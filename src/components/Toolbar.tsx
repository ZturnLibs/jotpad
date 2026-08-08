import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { FONT_PRESETS, type ThemeMode } from "@/types";
import { clamp } from "@/lib/utils";
import { Icon } from "./icons";

function firstName(f: string): string {
  const m = f.match(/^"([^"]+)"|^([^,]+)/);
  return m ? m[1] ?? m[2] ?? f : f;
}

export function Toolbar() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const toggleReadOnly = useStore((s) => s.toggleReadOnly);

  const themeCycle: ThemeMode[] = ["light", "dark", "system"];
  const themeIcon = settings.theme === "light" ? "sun" : settings.theme === "dark" ? "moon" : "monitor";

  return (
    <div className="toolbar">
      <div className="tb-cluster">
        <div className="tb-group">
          <select
            className="tb-select font"
            value={settings.fontFamily}
            title={t("toolbar.font")}
            onChange={(e) => setSettings({ fontFamily: e.target.value })}
          >
            {FONT_PRESETS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {firstName(f)}
              </option>
            ))}
          </select>
        </div>

        <div className="tb-size-wrap" title={t("toolbar.fontSize")}>
          <button
            onClick={() => setSettings({ fontSize: clamp(settings.fontSize - 1, 8, 72) })}
            aria-label="-"
          >
            <Icon name="chevronDown" size={12} />
          </button>
          <input
            type="number"
            min={8}
            max={72}
            value={settings.fontSize}
            onChange={(e) =>
              setSettings({ fontSize: clamp(parseInt(e.target.value) || 8, 8, 72) })
            }
          />
          <button
            onClick={() => setSettings({ fontSize: clamp(settings.fontSize + 1, 8, 72) })}
            aria-label="+"
          >
            <Icon name="chevronUp" size={12} />
          </button>
        </div>

        <div className="tb-sep" />

        <div className="tb-group">
          <button
            className={"tb-btn" + (settings.wordWrap ? " active" : "")}
            onClick={() => setSettings({ wordWrap: !settings.wordWrap })}
            title={t("toolbar.wordWrap")}
            aria-label={t("toolbar.wordWrap")}
            aria-pressed={settings.wordWrap}
          >
            <Icon name="wrap" size={18} />
          </button>
          <button
            className={"tb-btn" + (activeTab?.readOnly ? " active" : "")}
            onClick={() => toggleReadOnly()}
            title={t("toolbar.readOnly")}
            aria-label={t("toolbar.readOnly")}
            aria-pressed={!!activeTab?.readOnly}
            disabled={!activeTab}
          >
            <Icon name="lock" size={16} />
          </button>
        </div>

        <div className="tb-sep" />

        <div className="tb-group">
          <button
            className="tb-btn"
            onClick={() => setSettings({ zoom: clamp(settings.zoom - 10, 30, 500) })}
            title={t("toolbar.zoomOut")}
            aria-label={t("toolbar.zoomOut")}
          >
            <Icon name="zoomOut" size={16} />
          </button>
          <button
            className="tb-btn"
            onClick={() => setSettings({ zoom: 100 })}
            title={t("view.zoomReset")}
            style={{ width: 48, fontSize: 12 }}
          >
            {settings.zoom}%
          </button>
          <button
            className="tb-btn"
            onClick={() => setSettings({ zoom: clamp(settings.zoom + 10, 30, 500) })}
            title={t("toolbar.zoomIn")}
            aria-label={t("toolbar.zoomIn")}
          >
            <Icon name="zoomIn" size={16} />
          </button>
        </div>
      </div>

      {/* 中间空白：唯一窗口拖动区，不覆盖左右控件 */}
      <div className="tb-drag-fill" data-tauri-drag-region aria-hidden />

      <div className="tb-cluster">
        <div className="tb-group">
          <button
            className="tb-btn"
            onClick={() => {
              const idx = themeCycle.indexOf(settings.theme);
              setSettings({ theme: themeCycle[(idx + 1) % themeCycle.length] });
            }}
            title={t("toolbar.theme")}
            aria-label={t("toolbar.theme")}
          >
            <Icon name={themeIcon} size={17} />
          </button>
          <button
            className="tb-btn"
            onClick={() => useStore.getState().setSettingsOpen(true)}
            title={t("toolbar.settings")}
            aria-label={t("toolbar.settings")}
          >
            <Icon name="settings" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
