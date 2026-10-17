import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { marked } from "marked";
import { escapeHtml, sanitize } from "@/lib/md/safeHtml";

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
  const bodyRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef<number | null>(null);

  const isMd = useMemo(
    () => !!tab?.filePath && /\.(md|markdown|mdx)$/i.test(tab.filePath),
    [tab?.filePath],
  );
  const active = open && !!experimental?.markdown && isMd;
  const content = tab?.content ?? "";

  // 内容变化 → 防抖 300ms 渲染（转义 → marked → sanitize）
  useEffect(() => {
    if (!active) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const out = await marked.parse(escapeHtml(content), { async: true, gfm: true });
          setHtml(sanitize(out));
        } catch {
          setHtml("");
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [active, content]);

  // 链接点击 → 系统浏览器打开（经 opener 插件）
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !active) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href) return;
      e.preventDefault();
      void (async () => {
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(href);
        } catch {
          /* 打不开则忽略 */
        }
      })();
    };
    body.addEventListener("click", onClick);
    return () => body.removeEventListener("click", onClick);
  }, [active, html]);

  // 滚动同步（编辑 → 预览，百分比映射；预览区自身滚动不回写，避免抖动）
  useEffect(() => {
    if (!active) {
      syncRef.current = null;
      return;
    }
    const tick = () => {
      const v = (window as unknown as { __mdEditorScroll?: number | undefined }).__mdEditorScroll;
      const body = bodyRef.current;
      if (v != null && body) {
        const max = body.scrollHeight - body.clientHeight;
        if (max > 0) body.scrollTop = v * max;
      }
      syncRef.current = window.requestAnimationFrame(tick);
    };
    syncRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (syncRef.current != null) cancelAnimationFrame(syncRef.current);
    };
  }, [active]);

  if (!active) return null;

  const px = fontSize * (zoom / 100);

  return (
    <div className="md-preview" aria-label={t("view.markdownPreview")} role="region">
      <div className="md-preview-bar">
        <span className="md-preview-title">{t("view.markdownPreview")}</span>
      </div>
      <div
        ref={bodyRef}
        className="md-preview-body"
        style={{ ["--md-size" as string]: `${px}px`, ["--md-family" as string]: fontFamily }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
