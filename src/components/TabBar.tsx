import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { basename } from "@/lib/backend";
import { Icon } from "./icons";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const newTab = useStore((s) => s.newTab);
  const requestClose = useStore((s) => s.requestClose);
  const t = useT();

  return (
    <div className="tabs" data-tauri-drag-region>
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const title = tab.filePath ? basename(tab.filePath) : t("tab.untitled");
        return (
          <div
            key={tab.id}
            className={"tab" + (active ? " active" : "")}
            onClick={() => setActiveTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) requestClose(tab.id);
            }}
            title={tab.filePath ?? title}
            aria-current={active ? "page" : undefined}
          >
            <span className="tab-title">{title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                requestClose(tab.id);
              }}
              title={t("tab.close")}
              aria-label={t("tab.close")}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        );
      })}
      <button
        className="tab-new"
        onClick={() => newTab()}
        title={t("tab.new")}
        aria-label={t("tab.new")}
      >
        <Icon name="plus" size={16} />
      </button>
      <div className="tabs-spacer" data-tauri-drag-region />
    </div>
  );
}
