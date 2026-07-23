import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import {
  DEFAULT_PRINT_SETUP,
  PAPER_SIZES,
  loadPrintSetup,
  savePrintSetup,
  type PrintSetup,
} from "@/lib/print";
import { clamp } from "@/lib/utils";

export function PageSetup() {
  const open = useStore((s) => s.pageSetupOpen);
  const setOpen = useStore((s) => s.setPageSetupOpen);
  const t = useT();
  const [paper, setPaper] = useState(DEFAULT_PRINT_SETUP.paper);
  const [orientation, setOrientation] = useState<PrintSetup["orientation"]>("portrait");
  const [margin, setMargin] = useState(DEFAULT_PRINT_SETUP.margin);

  useEffect(() => {
    if (open) {
      const s = loadPrintSetup();
      setPaper(s.paper);
      setOrientation(s.orientation);
      setMargin(s.margin);
    }
  }, [open]);

  if (!open) return null;

  const save = () => {
    savePrintSetup({ paper, orientation, margin });
    setOpen(false);
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="dialog" style={{ minWidth: 340 }}>
        <h3>{t("pageSetup.title")}</h3>

        <div className="field">
          <label>{t("pageSetup.paper")}</label>
          <select value={paper} onChange={(e) => setPaper(e.target.value)}>
            {PAPER_SIZES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>{t("pageSetup.orientation")}</label>
          <div className="seg">
            <button
              className={orientation === "portrait" ? "active" : ""}
              onClick={() => setOrientation("portrait")}
            >
              {t("pageSetup.portrait")}
            </button>
            <button
              className={orientation === "landscape" ? "active" : ""}
              onClick={() => setOrientation("landscape")}
            >
              {t("pageSetup.landscape")}
            </button>
          </div>
        </div>

        <div className="field">
          <label>{t("pageSetup.margin")}</label>
          <input
            type="number"
            min={0}
            max={100}
            value={margin}
            onChange={(e) => setMargin(clamp(parseInt(e.target.value) || 0, 0, 100))}
          />
        </div>

        <div className="dialog-actions">
          <button className="btn" onClick={() => setOpen(false)}>
            {t("dialog.cancel")}
          </button>
          <button className="btn primary" onClick={save}>
            {t("pageSetup.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
