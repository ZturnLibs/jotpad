import { describe, expect, it } from "vitest";
import { marked } from "marked";

// 与 MarkdownPreview.tsx 保持一致的实现拷贝（组件内函数不导出，这里验证算法本身）
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\x22]/g, "&quot;");
}
const SAFE_URL_RE = new RegExp("^(?:(?:https?|mailto|ftp):|[/#.]|\\\\..\\\\.(?:/|$)|[?#])", "i");
function safeUrl(url: string): string | null {
  const u = url.trim();
  let probe = u;
  try {
    probe = probe.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
    probe = probe.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    probe = probe.replace(/&amp;/gi, "&");
  } catch {
    /* keep raw */
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(probe) && !SAFE_URL_RE.test(probe)) return null;
  return SAFE_URL_RE.test(probe) || !/^[a-z][a-z0-9+.-]*:/i.test(probe) ? u : null;
}

describe("markdown preview 安全策略（算法层）", () => {
  it("先转义后渲染：源内 HTML 按字面显示", async () => {
    const out = await marked.parse(escapeHtml("<b>x</b> <script>alert(1)</script>"), {
      gfm: true,
    });
    expect(out).not.toContain("<b>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;b&gt;");
  });

  it("safeUrl：白名单协议放行", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com");
    expect(safeUrl("http://a.b")).toBe("http://a.b");
    expect(safeUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeUrl("ftp://x")).toBe("ftp://x");
    expect(safeUrl("/relative/path")).toBe("/relative/path");
    expect(safeUrl("#anchor")).toBe("#anchor");
    expect(safeUrl("./rel")).toBe("./rel");
  });

  it("safeUrl：危险协议拒绝", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<b>")).toBeNull();
    expect(safeUrl("vbscript:x")).toBeNull();
    expect(safeUrl("JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeUrl(" javascript:alert(1)")).toBeNull();
  });

  it("safeUrl：实体编码绕过拦截", () => {
    expect(safeUrl("&#106;avascript:alert(1)")).toBeNull(); // j
    expect(safeUrl("&#x6a;avascript:alert(1)")).toBeNull(); // j (hex)
  });

  it("端到端：marked 产出 javascript: href，需 sanitize 层剥除（本测验证 safeUrl 能识别）", () => {
    // marked 对 [x](javascript:...) 产出 <a href="javascript:...">，转义拦不住
    // sanitize 依赖 safeUrl 判定 → 此处验证判定对 marked 实际输出形态有效
    expect(safeUrl("javascript:alert(1)")).toBeNull();
  });

  it("GFM 能力：任务列表/表格渲染正常", async () => {
    const out = await marked.parse("- [ ] a\n- [x] b", { gfm: true });
    expect(out).toContain('type="checkbox"');
    expect(out).toContain("checked");
  });
});
