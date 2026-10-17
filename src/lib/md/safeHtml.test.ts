// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { escapeHtml, safeUrl, sanitize } from "@/lib/md/safeHtml";

describe("escapeHtml", () => {
  it("转义 HTML 尖括号与引号", () => {
    expect(escapeHtml(`<img src="x">&`)).toBe("&lt;img src=&quot;x&quot;&gt;&amp;");
  });
});

describe("safeUrl", () => {
  it("放行 https 与相对路径", () => {
    expect(safeUrl("https://a.b/c")).toBe("https://a.b/c");
    expect(safeUrl("/local/path")).toBe("/local/path");
    expect(safeUrl("#anchor")).toBe("#anchor");
  });
  it("拒绝危险协议与实体绕过", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    // 注意：命名实体（如 &colon;）safeUrl 不解码——它与既有生产行为一致（仅解码数字实体与 &amp;），
    // 命名实体绕过由 sanitize 层的 DOM 属性解码拦截，见下方「剥除命名实体绕过的 href」用例。
    expect(safeUrl("&#106;avascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
  });
});

describe("sanitize", () => {
  it("剥除危险 href 保留文本", () => {
    const out = sanitize('<p><a href="javascript:alert(1)">点我</a></p>');
    expect(out).toContain("点我");
    expect(out).toContain("md-link-blocked");
    expect(out).not.toContain('href="javascript');
  });
  it("安全链接补 target/rel", () => {
    const out = sanitize('<p><a href="https://a.b">x</a></p>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
  it("剥除危险图片 src", () => {
    const out = sanitize('<p><img src="data:text/html,x" alt="a"></p>');
    expect(out).toContain("md-img-blocked");
    expect(out).not.toContain('src="data:');
  });
  it("剥除命名实体绕过的 href（&colon;）", () => {
    // DOM 解码属性中的命名实体 → getAttribute 得到 javascript:… → safeUrl 拒绝
    const out = sanitize('<p><a href="javascript&colon;alert(1)">点我</a></p>');
    expect(out).toContain("md-link-blocked");
    expect(out).not.toContain("javascript");
  });
});
