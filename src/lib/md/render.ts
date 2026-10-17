// 单块 → 安全 HTML。与分栏预览同源（escapeHtml → marked → sanitize），
// 保证两条渲染链路对同一段文本输出一致。失败返回 null：调用方回退源码显示。
import { marked } from "marked";
import { escapeHtml, sanitize } from "@/lib/md/safeHtml";

export function renderBlockHtml(text: string): string | null {
  try {
    const html = marked.parse(escapeHtml(text), { async: false, gfm: true });
    if (typeof html !== "string") return null;
    const clean = sanitize(html);
    return clean.trim() ? clean : null;
  } catch {
    return null;
  }
}
