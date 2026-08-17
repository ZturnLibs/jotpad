import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { marked } from "marked";

/** 转义源文本中的 HTML → marked 输出的标签全部为渲染器自产（零依赖防 XSS）。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 实验特性 Markdown：分栏预览。仅当 experimental.markdown 开启 + 当前 tab 是 md 文件时渲染。 */
export function MarkdownPreview() {
  const open = useStore((s) => s.previewOpen);
  const experimental = useStore((s) => s.settings.experimental);
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const fontFamily = useStore((s) => s.settings.fontFamily);
  const fontSize = useStore((s) => s.settings.fontSize);
  const zoom = useStore((s) => s.settings.zoom);
  const t = useT();

  const [html, setHtml] = useState("");
  const timer = useRef<number>(0);

  const isMd = useMemo(
    () => !!tab?.filePath && /\.(md|markdown|mdx)$/i.test(tab.filePath),
    [tab?.filePath],
  );
  const active = open && !!experimental?.markdown && isMd;
  const content = tab?.content ?? "";

  // 内容变化 → 防抖 300ms 渲染
  useEffect(() => {
    if (!active) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const out = await marked.parse(escapeHtml(content), { async: true, gfm: true });
          setHtml(out);
        } catch {
          setHtml("");
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [active, content]);

  if (!active) return null;

  const px = fontSize * (zoom / 100);

  return (
    <div className="md-preview" aria-label={t("view.markdownPreview")} role="region">
      <div className="md-preview-bar">
        <span className="md-preview-title">{t("view.markdownPreview")}</span>
      </div>
      <div
        className="md-preview-body"
        style={{ ["--md-size" as string]: `${px}px`, ["--md-family" as string]: fontFamily }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
