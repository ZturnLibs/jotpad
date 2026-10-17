// Markdown 渲染共用的 HTML 净化：源文本转义 + 渲染结果剥离危险 URL。
// 分栏预览与即时渲染（md live）共用，保证两条渲染链路安全行为一致。

/** 转义源文本中的 HTML → marked 输出的标签全部为渲染器自产（防内容注入 HTML）。
 *  只转义 & 与 <：无 < 即无法引入任何标签/属性，文本节点中的 > " 均为惰性字符；
 *  > 必须保留——它是 Markdown 引用块标记（">&gt;" 会让 marked 把引用当纯文本）。 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/**
 * URL 协议白名单：仅放行 http(s)/mailto/ftp、相对路径与页内锚点。
 * javascript: / data: / vbscript: 等一律剥除（防 XSS）。marked 的 URL 本身不含
 * HTML 字符，转义拦不住，必须在 href 层面过滤。
 */
const SAFE_URL_RE = new RegExp("^(?:(?:https?|mailto|ftp):|[/#.]|\\\\..\\\\.(?:/|$)|[?#])", "i");

export function safeUrl(url: string): string | null {
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
export function sanitize(html: string): string {
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
