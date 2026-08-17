import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { marked } from "marked";

/** 转义源文本中的 HTML → marked 输出的标签全部为渲染器自产（防内容注入 HTML）。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\x22]/g, "&quot;");
}

/**
 * URL 协议白名单：仅放行 http(s)/mailto/ftp、相对路径与页内锚点。
 * javascript: / data: / vbscript: 等一律剥除（防 XSS）。marked 的 URL 本身不含
 * HTML 字符，转义拦不住，必须在 href 层面过滤。
 */
const SAFE_URL_RE = new RegExp("^(?:(?:https?|mailto|ftp):|[/#.]|\\\\..\\\\.(?:/|$)|[?#])", "i");

function safeUrl(url: string): string | null {
  const u = url.trim();
  // 解码常见实体后判断协议（防御 href=&#106;avascript: 类绕过）
  let probe = u;
  try {
    probe = probe.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
    probe = probe.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    probe = probe.replace(/&amp;/gi, "&");
  } catch {
    /* keep raw */
  }
  // 任何包含冒号的非白名单协议 → 拒绝（相对路径极少含 ':'，路径中冒号仅出现在协议位）
  if (/^[a-z][a-z0-9+.-]*:/i.test(probe) && !SAFE_URL_RE.test(probe)) return null;
  return SAFE_URL_RE.test(probe) || !/^[a-z][a-z0-9+.-]*:/i.test(probe) ? u : null;
}

/**
 * 渲染后净化：剥离危险 href/src，保留文本内容。与 escapeHtml 双保险。
 */
function sanitize(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === "a") {
        const href = child.getAttribute("href");
        const ok = href != null && safeUrl(href) != null;
        if (ok) {
          child.setAttribute("href", safeUrl(href)!);
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener noreferrer");
        } else {
          child.removeAttribute("href");
          child.classList.add("md-link-blocked");
        }
      } else if (tag === "img") {
        const src = child.getAttribute("src");
        if (src == null || safeUrl(src) == null) {
          child.removeAttribute("src");
          child.classList.add("md-img-blocked");
          child.setAttribute("alt", child.getAttribute("alt") ?? "⚠");
        }
      }
      walk(child);
    }
  };
  walk(el);
  return el.innerHTML;
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

  useEffect(() => {
    const iv = window.setInterval(() => {
      document.title = `DBG active=${active} open=${open} exp=${!!experimental?.markdown} isMd=${isMd}`;
    }, 1000);
    return () => window.clearInterval(iv);
  });

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
