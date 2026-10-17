// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderBlockHtml } from "@/lib/md/render";

describe("renderBlockHtml", () => {
  it("标题渲染为 h1", () => {
    expect(renderBlockHtml("# 你好")).toContain("<h1>");
    expect(renderBlockHtml("# 你好")).toContain("你好");
  });

  it("列表渲染为 ul/li，任务列表带 checkbox", () => {
    expect(renderBlockHtml("- a\n- b")).toContain("<li>");
    expect(renderBlockHtml("- [x] 完成")).toContain('type="checkbox"');
  });

  it("代码块渲染为 pre>code 并保留语言类", () => {
    const html = renderBlockHtml("```rust\nfn main() {}\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain('class="language-rust"');
  });

  it("源文本中的 HTML 被转义不执行", () => {
    expect(renderBlockHtml("正文 <script>alert(1)</script>")).not.toContain("<script>");
  });

  it("引用块渲染为 blockquote（> 标记不被转义破坏）", () => {
    const html = renderBlockHtml("> 引用内容");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("&gt;");
  });

  it("危险协议链接被剥除", () => {
    expect(renderBlockHtml("[x](javascript:alert(1))")).toContain("md-link-blocked");
  });

  it("空结果返回 null", () => {
    expect(renderBlockHtml("")).toBeNull();
  });
});
