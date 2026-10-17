# Markdown 即时渲染 M1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 CodeMirror 6 编辑器内实现 Typora 式即时渲染的 M1 范围：基础块（标题/粗斜体/行内代码/列表含任务列表/引用/代码块/分隔线/链接）渲染、`Cmd/Ctrl+/` 渲染↔源码切换、清除 MarkdownPreview 的 DBG 残留。

**Architecture:** 纯函数块扫描器（blocks.ts）+ 逐块安全渲染（render.ts，复用 marked 与分栏预览的净化逻辑）+ CM6 ViewPlugin 装饰（decorations.ts，视口内非活动块 `Decoration.replace` + Widget）。一切编辑仍是 CM6 transaction，撤销/IME/查找原生保留。挂在 `settings.experimental.mdLive`（默认关）+ `settings.mdViewMode`（live/source）。

**Tech Stack:** TypeScript、CodeMirror 6（@codemirror/view/state，现有依赖）、marked（现有依赖）、vitest。

## Global Constraints

- 设计文档：`docs/design-md-live-preview.md`（本计划只做 M1；表格/打印/包体是 M2/M3）。
- 开关默认关闭（`experimental.mdLive`），关掉后行为与现状完全一致。
- `Cmd/Ctrl+/` 从分栏预览改绑为「即时渲染↔源码」切换；分栏预览保留菜单入口（无快捷键）。
- 渲染失败必须回退源码显示，绝不出现空白块。
- 跨块选区、查找/替换面板打开期间：整档回源码视图。
- 文件 >2MB 不启用即时渲染。
- 所有用户可见文案走 i18n（zh + en 两处都要加）。
- 提交信息用中文，风格与仓库历史一致。

---

### Task 1: 清除 MarkdownPreview 的 DBG 残留

**Files:**
- Modify: `src/components/MarkdownPreview.tsx:156-161`

**Interfaces:** 无（删除调试代码）。

- [ ] **Step 1: 删除调试 interval**

删除以下整个 useEffect 块（它每秒把 `document.title` 覆写成 `DBG active=…`，已随 v0.2.2 发布）：

```tsx
  useEffect(() => {
    const iv = window.setInterval(() => {
      document.title = `DBG active=${active} open=${open} exp=${!!experimental?.markdown} isMd=${isMd}`;
    }, 1000);
    return () => window.clearInterval(iv);
  });
```

删除后若 `useEffect` import 不再被其他代码使用会有未使用告警——该文件还有 4 个 useEffect，无需改动 import。

- [ ] **Step 2: 验证**

Run: `pnpm test && npx tsc --noEmit`
Expected: 全部通过（63 tests / TSC OK）

- [ ] **Step 3: Commit**

```bash
git add src/components/MarkdownPreview.tsx
git commit -m "清除 MarkdownPreview 调试用 title 覆写残留"
```

---

### Task 2: 提取共享净化模块 safeHtml

**Files:**
- Create: `src/lib/md/safeHtml.ts`
- Create: `src/lib/md/safeHtml.test.ts`
- Modify: `src/components/MarkdownPreview.tsx`

**Interfaces:**
- Produces（后续任务依赖的签名）:
  - `escapeHtml(s: string): string`
  - `safeUrl(url: string): string | null`
  - `sanitize(html: string): string`

- [ ] **Step 1: 写失败测试**

创建 `src/lib/md/safeHtml.test.ts`（sanitize 用到 `document.createElement`，需要 jsdom）：

```ts
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
    expect(safeUrl("javascript&colon;alert(1)")).toBeNull();
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
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/lib/md/safeHtml.test.ts`
Expected: FAIL（模块 `@/lib/md/safeHtml` 不存在）

- [ ] **Step 3: 创建模块**

把 `src/components/MarkdownPreview.tsx` 1-71 行的 `escapeHtml`、`SAFE_URL_RE`、`safeUrl`、`sanitize` **原样搬移**到 `src/lib/md/safeHtml.ts` 并导出（函数体逐字不动，包括注释）：

```ts
// Markdown 渲染共用的 HTML 净化：源文本转义 + 渲染结果剥离危险 URL。
// 分栏预览与即时渲染（md live）共用，保证两条渲染链路安全行为一致。

/** 转义源文本中的 HTML → marked 输出的标签全部为渲染器自产（防内容注入 HTML）。 */
export function escapeHtml(s: string): string {
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
```

注意：`sanitize` 操作的是 escapeHtml 转义后的 marked 输出，`child.classList.add` 等行为与原实现完全一致。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run src/lib/md/safeHtml.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 迁移 MarkdownPreview 引用**

`src/components/MarkdownPreview.tsx`：删除 1-71 行的本地实现，改为：

```ts
import { escapeHtml, sanitize } from "@/lib/md/safeHtml";
```

- [ ] **Step 6: 回归**

Run: `pnpm test && npx tsc --noEmit`
Expected: 全部通过

- [ ] **Step 7: Commit**

```bash
git add src/lib/md/safeHtml.ts src/lib/md/safeHtml.test.ts src/components/MarkdownPreview.tsx
git commit -m "提取 Markdown 净化逻辑为共享模块 safeHtml（分栏预览与即时渲染共用）"
```

---

### Task 3: 块扫描器 parseBlocks

**Files:**
- Create: `src/lib/md/blocks.ts`
- Create: `src/lib/md/blocks.test.ts`

**Interfaces:**
- Produces:
  - `type BlockType = "heading" | "list" | "quote" | "code" | "hr" | "paragraph"`
  - `interface BlockInfo { from: number; to: number; type: BlockType }`（from=块首行行首偏移，to=块尾行行尾偏移不含换行符，均相对传入文本）
  - `parseBlocks(text: string): BlockInfo[]`

- [ ] **Step 1: 写失败测试**

创建 `src/lib/md/blocks.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { parseBlocks } from "@/lib/md/blocks";

describe("parseBlocks", () => {
  it("空文本与纯空行返回空数组", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("\n\n  \n")).toEqual([]);
  });

  it("标题与段落按空行分块，偏移正确", () => {
    const text = "# 标题\n\n正文一\n正文二";
    expect(parseBlocks(text)).toEqual([
      { from: 0, to: 4, type: "heading" },    // "# 标题" 4 字符
      { from: 6, to: 13, type: "paragraph" }, // "正文一\n正文二"
    ]);
  });

  it("连续列表行聚合为一块（含嵌套缩进）", () => {
    const text = "- a\n- b\n  - c\n\n段落";
    const blocks = parseBlocks(text);
    expect(blocks[0].type).toBe("list");
    expect(blocks[0].from).toBe(0);
    expect(blocks[0].to).toBe(13); // "  - c" 行尾（5 字符行，from 8）
    expect(blocks[1]).toEqual({ from: 15, to: 17, type: "paragraph" });
  });

  it("引用块聚合，内嵌标题仍属 quote", () => {
    const text = "> # 内嵌\n> 续行\n\nx";
    const blocks = parseBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("quote");
    expect(blocks[0].to).toBe(11);
  });

  it("围栏代码跨空行直到闭合围栏", () => {
    const text = "```\na\n\nb\n```\n后文";
    const blocks = parseBlocks(text);
    expect(blocks[0].type).toBe("code");
    expect(blocks[0].to).toBe(12); // 闭合 ``` 行（from 9，3 字符）
    expect(blocks[1].type).toBe("paragraph");
  });

  it("未闭合围栏吞到文末", () => {
    expect(parseBlocks("```\nabc")).toEqual([{ from: 0, to: 7, type: "code" }]);
  });

  it("分隔线单独成块", () => {
    expect(parseBlocks("a\n\n---\n\nb")[1]).toEqual({ from: 3, to: 6, type: "hr" });
  });

  it("setext 标题：段落 + ===/--- 升级为 heading", () => {
    expect(parseBlocks("标题\n===")).toEqual([{ from: 0, to: 7, type: "heading" }]);
    expect(parseBlocks("标题\n---")[0].type).toBe("heading");
  });

  it("有序列表识别", () => {
    expect(parseBlocks("1. a\n2. b")[0].type).toBe("list");
  });
});
```

（执行时若个别偏移断言与实现差一，以「from=行首、to=行尾不含 \n」的定义手工核算后修正测试值——定义不许改。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/lib/md/blocks.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 blocks.ts**

创建 `src/lib/md/blocks.ts`：

```ts
// 块级扫描：把 Markdown 文本切成行对齐的渲染块（即时渲染按视口调用）。
// M1 简化（设计文档已记）：空行结束可聚合块（宽松列表拆多块）；围栏闭合按任意围栏线；
// 4 空格缩进代码块不识别（按段落）；表格行按段落聚合（marked 会渲染表格，M2a 正式化）。

export type BlockType = "heading" | "list" | "quote" | "code" | "hr" | "paragraph";

export interface BlockInfo {
  /** 块首行行首偏移（相对传入文本） */
  from: number;
  /** 块尾行行尾偏移（不含换行符） */
  to: number;
  type: BlockType;
}

const RE_HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const RE_HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const RE_LIST = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const RE_QUOTE = /^ {0,3}>/;
const RE_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RE_SETEXT = /^ {0,3}(?:=+|-{2,})\s*$/;

function classifyLine(text: string): BlockType {
  if (RE_HEADING.test(text)) return "heading";
  if (RE_FENCE.test(text)) return "code";
  if (RE_HR.test(text)) return "hr";
  if (RE_LIST.test(text)) return "list";
  if (RE_QUOTE.test(text)) return "quote";
  return "paragraph";
}

export function parseBlocks(text: string): BlockInfo[] {
  const blocks: BlockInfo[] = [];
  const lines: { text: string; from: number; to: number }[] = [];
  let pos = 0;
  for (const raw of text.split("\n")) {
    lines.push({ text: raw, from: pos, to: pos + raw.length });
    pos += raw.length + 1;
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.text.trim()) {
      i++;
      continue;
    }

    // 围栏代码：吞掉到闭合围栏或文末（跨空行）
    if (RE_FENCE.test(line.text)) {
      let j = i + 1;
      while (j < lines.length && !RE_FENCE.test(lines[j].text)) j++;
      const end = Math.min(j, lines.length - 1);
      blocks.push({ from: line.from, to: lines[end].to, type: "code" });
      i = end + 1;
      continue;
    }

    const type = classifyLine(line.text);
    if (type === "heading" || type === "hr") {
      blocks.push({ from: line.from, to: line.to, type });
      i++;
      continue;
    }

    // 可聚合块（list / quote / paragraph）：同类型连续行合并
    let j = i + 1;
    let setext = false;
    while (j < lines.length) {
      const next = lines[j];
      if (type === "paragraph" && RE_SETEXT.test(next.text)) {
        setext = true;
        break;
      }
      if (!next.text.trim()) break;
      if (classifyLine(next.text) !== type) break;
      j++;
    }
    const end = setext ? j : j - 1;
    blocks.push({ from: line.from, to: lines[end].to, type: setext ? "heading" : type });
    i = end + 1;
  }
  return blocks;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run src/lib/md/blocks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/md/blocks.ts src/lib/md/blocks.test.ts
git commit -m "即时渲染 M1：块扫描器 parseBlocks（行对齐分块，含围栏/列表/引用/setext）"
```

---

### Task 4: 单块渲染 renderBlockHtml

**Files:**
- Create: `src/lib/md/render.ts`
- Create: `src/lib/md/render.test.ts`

**Interfaces:**
- Consumes: `escapeHtml/sanitize`（Task 2）、marked（现有依赖）
- Produces: `renderBlockHtml(text: string): string | null`（null=渲染失败，调用方回退源码）

- [ ] **Step 1: 写失败测试**

创建 `src/lib/md/render.test.ts`（sanitize 需 jsdom）：

```ts
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

  it("危险协议链接被剥除", () => {
    expect(renderBlockHtml("[x](javascript:alert(1))")).toContain("md-link-blocked");
  });

  it("空结果返回 null", () => {
    expect(renderBlockHtml("")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/lib/md/render.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 render.ts**

```ts
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
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run src/lib/md/render.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/md/render.ts src/lib/md/render.test.ts
git commit -m "即时渲染 M1：单块安全渲染 renderBlockHtml（与分栏预览同链路）"
```

---

### Task 5: 设置项扩展（mdViewMode）

**Files:**
- Modify: `src/types.ts`（AppSettings + DEFAULT_SETTINGS）
- Modify: `src/store/useStore.ts`（normalizeSettings）
- Test: `src/store/useStore.test.ts`

**Interfaces:**
- Produces: `AppSettings.mdViewMode: "live" | "source"`（默认 `"live"`）；`experimental.mdLive: boolean` 走现有 generic map，无需类型改动。

- [ ] **Step 1: 写失败测试**

在 `src/store/useStore.test.ts` 的 `describe("外部变更检测")` 之后追加：

```ts
describe("md 视图设置归一化", () => {
  it("持久化的 mdViewMode=source 生效，非法值回落 live", async () => {
    vi.mocked(api.readState).mockResolvedValue({
      version: 2,
      activeTabId: "a",
      settings: { ...DEFAULT_SETTINGS, startupMode: "restore", mdViewMode: "source" },
      recentFiles: [],
      pinnedPaths: [],
      sessions: [],
      tabs: [makeTab()],
    } as AppState);
    await useStore.getState().init();
    expect(useStore.getState().settings.mdViewMode).toBe("source");

    vi.mocked(api.readState).mockResolvedValue({
      version: 2,
      activeTabId: "a",
      settings: { ...DEFAULT_SETTINGS, startupMode: "restore", mdViewMode: "bogus" },
      recentFiles: [],
      pinnedPaths: [],
      sessions: [],
      tabs: [makeTab()],
    } as unknown as AppState);
    await useStore.getState().init();
    expect(useStore.getState().settings.mdViewMode).toBe("live");
  });
});
```

（`makeTab`/`api`/`vi` 均为该文件既有引用。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/store/useStore.test.ts`
Expected: FAIL（`mdViewMode` 不在类型上 / 值为 undefined）

- [ ] **Step 3: 实现**

`src/types.ts`：`AppSettings` 接口加一行（放在 `startupMode` 附近）：

```ts
  /** Markdown 即时渲染的视图偏好（experimental.mdLive 开启时生效）。 */
  mdViewMode: "live" | "source";
```

`DEFAULT_SETTINGS` 加：

```ts
  mdViewMode: "live",
```

`src/store/useStore.ts` 的 `normalizeSettings`：在 `const startupMode …` 之后加：

```ts
  const mdViewMode: "live" | "source" = merged.mdViewMode === "source" ? "source" : "live";
```

返回对象里 `startupMode,` 之后加 `mdViewMode,`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run src/store/useStore.test.ts && npx tsc --noEmit`
Expected: PASS / TSC OK

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/store/useStore.ts src/store/useStore.test.ts
git commit -m "即时渲染 M1：设置项 mdViewMode（live/source，默认 live）"
```

---

### Task 6: 装饰构建器 buildBlockDecorations + 扩展 mdLivePreview

**Files:**
- Create: `src/lib/md/decorations.ts`
- Create: `src/lib/md/decorations.test.ts`

**Interfaces:**
- Consumes: `parseBlocks`（Task 3）、`renderBlockHtml`（Task 4）、`useStore`（读取 findOpen/replaceOpen）
- Produces:
  - `buildBlockDecorations(state: EditorState, from: number, to: number, suppress: boolean): DecorationSet`
  - `mdLivePreview(): Extension[]`（挂到编辑器扩展集）

- [ ] **Step 1: 写失败测试**

创建 `src/lib/md/decorations.test.ts`（纯 EditorState，无 DOM）：

```ts
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { buildBlockDecorations } from "@/lib/md/decorations";

function stateWith(doc: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({ doc, selection: { anchor, head } });
}

/** 数出装饰区间条数（widget 替换块数）。 */
function decoCount(state: EditorState): number {
  let n = 0;
  buildBlockDecorations(state, 0, state.doc.length, false).between(0, state.doc.length, () => {
    n++;
  });
  return n;
}

describe("buildBlockDecorations", () => {
  const doc = "# 标题\n\n段落一\n\n- 列表\n- 项\n\n> 引用";

  it("光标在段落：其余三块被替换渲染", () => {
    expect(decoCount(stateWith(doc, 7))).toBe(3);
  });

  it("光标进入标题行：标题回源码，其余渲染", () => {
    expect(decoCount(stateWith(doc, 1))).toBe(3);
  });

  it("光标在块尾行末：归下一块（该块仍渲染）", () => {
    // 位置 4 是标题行末（\"# 标题\" 长 4）→ 标题应渲染，其余也渲染（无活动块）
    expect(decoCount(stateWith(doc, 4))).toBe(4);
  });

  it("选区跨块：全部回源码（0 个装饰）", () => {
    expect(decoCount(stateWith(doc, 1, 20))).toBe(0);
  });

  it("suppress=true 时无装饰（查找面板打开）", () => {
    const state = stateWith(doc, 7);
    let n = 0;
    buildBlockDecorations(state, 0, state.doc.length, true).between(0, state.doc.length, () => n++);
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/lib/md/decorations.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 decorations.ts**

```ts
// 即时渲染（M1）：视口内非活动块替换为渲染 HTML；活动块（光标/选区所在）显示源码。
// 一切编辑仍是 CM6 transaction（撤销/IME 原生）。渲染失败回退源码（renderBlockHtml → null）。
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type Extension,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { type EditorState, RangeSetBuilder } from "@codemirror/state";
import { type BlockInfo, parseBlocks } from "@/lib/md/blocks";
import { renderBlockHtml } from "@/lib/md/render";
import { useStore } from "@/store/useStore";

class BlockWidget extends WidgetType {
  constructor(readonly html: string) {
    super();
  }
  eq(other: BlockWidget): boolean {
    return other.html === this.html;
  }
  toDOM(): HTMLElement {
    const host = document.createElement("div");
    host.className = "cm-md-live-block";
    host.innerHTML = this.html;
    return host;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 位置所在块下标；from 闭、to 开（块尾边界归下一块）；不在任何块内返回 -1。 */
function indexAt(blocks: BlockInfo[], pos: number, base: number): number {
  for (let i = 0; i < blocks.length; i++) {
    const from = base + blocks[i].from;
    if (pos < from) return -1;
    if (pos < base + blocks[i].to) return i;
  }
  return -1;
}

/** 纯函数：[from,to) 内的块 → 装饰集。suppress=true 时返回空（查找面板等全源码场景）。 */
export function buildBlockDecorations(
  state: EditorState,
  from: number,
  to: number,
  suppress: boolean,
): DecorationSet {
  if (suppress) return Decoration.none;
  const text = state.sliceDoc(from, to);
  const blocks = parseBlocks(text);
  if (!blocks.length) return Decoration.none;

  const sel = state.selection.main;
  const a = indexAt(blocks, sel.from, from);
  const b = indexAt(blocks, Math.max(sel.from, sel.to - 1), from);
  const crossBlock = sel.from !== sel.to && a !== b;

  const builder = new RangeSetBuilder<Decoration>();
  for (let i = 0; i < blocks.length; i++) {
    if (!crossBlock && (i === a || i === b)) continue;
    const block = blocks[i];
    const html = renderBlockHtml(text.slice(block.from, block.to));
    if (html == null) continue;
    builder.add(
      from + block.from,
      from + block.to,
      Decoration.replace({ widget: new BlockWidget(html) }),
    );
  }
  return builder.finish();
}

function suppressed(): boolean {
  const s = useStore.getState();
  return s.findOpen || s.replaceOpen;
}

/** 渲染态链接点击 → 系统浏览器打开（经 opener 插件）。 */
const mdLinkHandlers = EditorView.domEventHandlers({
  mousedown(event, view) {
    const anchor = (event.target as HTMLElement | null)?.closest?.("a");
    if (!anchor || !view.dom.contains(anchor)) return false;
    const href = anchor.getAttribute("href");
    if (!href) return false;
    event.preventDefault();
    void import("@tauri-apps/plugin-opener")
      .then(({ openUrl }) => openUrl(href))
      .catch(() => {
        /* 打不开则忽略 */
      });
    return true;
  },
});

/** 挂到编辑器扩展集。doc/选区/视口（及任何事务）变化时重建（视口内重算，M1 实现足够）。 */
export function mdLivePreview(): Extension[] {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildBlockDecorations(
            view.state,
            view.viewport.from,
            view.viewport.to,
            suppressed(),
          );
        }
        update(u: ViewUpdate) {
          this.decorations = buildBlockDecorations(
            u.view.state,
            u.view.viewport.from,
            u.view.viewport.to,
            suppressed(),
          );
        }
      },
      { decorations: (v) => v.decorations },
    ),
    mdLinkHandlers,
  ];
}
```

**已知风险与应对（执行时注意）**：若 CodeMirror 在多行 `Decoration.replace` + widget 上抛错（版本行为差异），改用 `Decoration.replace({ widget, block: true })` 并确保区间两端对齐行边界（blocks 的 from/to 定义本来就对齐）。改法记录进 commit message。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run src/lib/md/decorations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/md/decorations.ts src/lib/md/decorations.test.ts
git commit -m "即时渲染 M1：视口装饰构建器 + mdLivePreview 扩展（活动块源码/跨块选区回退）"
```

---

### Task 7: Editor 接入

**Files:**
- Modify: `src/components/Editor.tsx`

**Interfaces:**
- Consumes: `mdLivePreview()`（Task 6）、`settings.experimental.mdLive`、`settings.mdViewMode`（Task 5）

- [ ] **Step 1: 扩大 md 能力开关判定**

`Editor.tsx` 中现有 `markdownEnabled` 改为（旧分栏开关或新即时渲染开关任一开启即启用 md 编辑能力）：

```ts
/** 实验特性 markdown：仅 .md/.markdown/.mdx 文件启用（分栏或即时渲染任一开启）。 */
function markdownEnabled(
  settings: { experimental: Record<string, boolean> },
  filePath: string | null,
): boolean {
  if (!filePath) return false;
  if (!settings.experimental?.markdown && !settings.experimental?.mdLive) return false;
  return /\.(md|markdown|mdx)$/i.test(filePath);
}
```

- [ ] **Step 2: 挂载/卸载 live 扩展集**

`Editor.tsx` 顶部加 import：

```ts
import { mdLivePreview } from "@/lib/md/decorations";
```

现有 langCompartment effect（`}, [settings.experimental, tab?.filePath, settings]);`）替换为：

```ts
  // 即时渲染：mdLive 开启 + live 模式 + 非大文件时挂 live 扩展（2MB 与大文件只读同阈值）
  const LIVE_MAX_SIZE = 2_000_000;
  useEffect(() => {
    const md = markdownEnabled(settings, tab?.filePath ?? null);
    const live =
      md &&
      !!settings.experimental?.mdLive &&
      settings.mdViewMode !== "source" &&
      (tab?.size ?? 0) <= LIVE_MAX_SIZE;
    viewRef.current?.dispatch({
      effects: langCompartment.current.reconfigure(
        md
          ? [
              markdownLang(),
              syntaxHighlighting(mdHighlight),
              ...(live ? mdLivePreview() : []),
            ]
          : [],
      ),
    });
  }, [settings.experimental, settings.mdViewMode, tab?.filePath, tab?.size, settings]);
```

（`LIVE_MAX_SIZE` 放组件外顶层，避免每次渲染重建。）

- [ ] **Step 3: 查找面板开合强制重建装饰**

store 的 `findOpen`/`replaceOpen` 变化不产生 CM 事务，需要派发空事务触发插件重建。`Editor.tsx` 组件内加：

```ts
  const findOpen = useStore((s) => s.findOpen);
  const replaceOpen = useStore((s) => s.replaceOpen);
  useEffect(() => {
    viewRef.current?.dispatch({});
  }, [findOpen, replaceOpen]);
```

- [ ] **Step 4: 验证**

Run: `pnpm test && npx tsc --noEmit && pnpm build`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add src/components/Editor.tsx
git commit -m "即时渲染 M1：编辑器接入（live 扩展集挂载/卸载、查找面板联动、2MB 熔断）"
```

---

### Task 8: 开关 UI —— 快捷键改绑、菜单、设置项、i18n

**Files:**
- Modify: `src/lib/shortcuts.ts:148-152`
- Modify: `src/lib/menuActions.ts`（view 菜单项 + case）
- Modify: `src/lib/i18n.ts`（zh + en）
- Modify: `src/components/Settings.tsx:422-433`

**Interfaces:**
- Produces: 动作 id `mdViewToggle`（`Cmd/Ctrl+/`）；i18n key `view.mdLive` / `settings.exp.mdLive` / `settings.exp.mdLiveDesc`。

- [ ] **Step 1: 快捷键改绑**

`src/lib/shortcuts.ts` 把现有 `markdownPreview` 条目（148-152 行）：

```ts
  {
    id: "markdownPreview",
    chords: [{ key: "/", mod: true }],
    label: `${MOD}+/`,
    accel: A("/"),
  },
```

替换为（分栏预览过渡期保留菜单入口、无快捷键；`/` 改绑模式切换）：

```ts
  {
    id: "markdownPreview",
    // 分栏预览过渡期仅菜单入口；M4 移除（见 docs/design-md-live-preview.md）
  },
  {
    id: "mdViewToggle",
    chords: [{ key: "/", mod: true }],
    label: `${MOD}+/`,
    accel: A("/"),
  },
```

- [ ] **Step 2: 菜单项**

`src/lib/menuActions.ts` 查看（View）菜单里 `markdownPreview` 条目之后插入：

```ts
    {
      id: "mdViewToggle",
      label: t("view.mdLive"),
      checked:
        !!s.settings.experimental?.mdLive && s.settings.mdViewMode !== "source",
      disabled:
        !s.settings.experimental?.mdLive ||
        !/\.(md|markdown|mdx)$/i.test(activeTab?.filePath ?? ""),
    },
```

- [ ] **Step 3: 动作分发**

`src/lib/menuActions.ts` 的 `case "markdownPreview":` 之后加：

```ts
    case "mdViewToggle":
      if (s.settings.experimental?.mdLive) {
        s.setSettings({
          mdViewMode: s.settings.mdViewMode === "source" ? "live" : "source",
        });
      }
      break;
```

- [ ] **Step 4: i18n**

`src/lib/i18n.ts` 中文区（`"view.markdownPreview"` 附近）加：

```ts
  "view.mdLive": "即时渲染",
  "settings.exp.mdLive": "Markdown 即时渲染",
  "settings.exp.mdLiveDesc": "在编辑器内直接呈现排版效果，光标所在块显示源码；Cmd/Ctrl+/ 在渲染与源码间切换。",
```

英文区对应位置加：

```ts
  "view.mdLive": "Live Rendering",
  "settings.exp.mdLive": "Markdown live rendering",
  "settings.exp.mdLiveDesc": "Render markdown in place; the block with the cursor shows source. Toggle with Cmd/Ctrl+/.",
```

- [ ] **Step 5: 设置页开关**

`src/components/Settings.tsx` 实验区（现有 markdown Toggle 之后）加：

```tsx
                  <Toggle
                    on={!!settings.experimental.mdLive}
                    onChange={(v) =>
                      setSettings({ experimental: { ...settings.experimental, mdLive: v } })
                    }
                    label={t("settings.exp.mdLive")}
                  />
```

并把该区 hint 段替换为两行说明：

```tsx
                <p className="settings-hint muted">{t("settings.exp.markdownDesc")}</p>
                <p className="settings-hint muted">{t("settings.exp.mdLiveDesc")}</p>
```

- [ ] **Step 6: 验证**

Run: `pnpm test && npx tsc --noEmit`
Expected: 全部通过

- [ ] **Step 7: Commit**

```bash
git add src/lib/shortcuts.ts src/lib/menuActions.ts src/lib/i18n.ts src/components/Settings.tsx
git commit -m "即时渲染 M1：mdLive 实验开关 + Cmd/Ctrl+/ 改绑模式切换 + 菜单与设置入口"
```

---

### Task 9: 渲染块排版 CSS

**Files:**
- Modify: `src/styles/app.css`（在 `.md-preview-body img.md-img-blocked { … }` 规则（约 1098-1105 行）之后、`.outline-row` 之前插入）

**Interfaces:** 消费 Task 6 的 `.cm-md-live-block` 容器类名。

- [ ] **Step 1: 追加样式**

插入（值与 `.md-preview-body` 排版族一致，仅基座改为继承编辑器字体设置；M3 可合并选择器）：

```css
/* 即时渲染块（编辑器内嵌渲染）：排版与分栏预览一致，字体继承编辑器设置 */
.cm-md-live-block {
  line-height: 1.7;
  color: var(--editor-text);
}
.cm-md-live-block h1,
.cm-md-live-block h2,
.cm-md-live-block h3,
.cm-md-live-block h4,
.cm-md-live-block h5,
.cm-md-live-block h6 {
  margin: 1em 0 0.4em;
  line-height: 1.3;
}
.cm-md-live-block h1 { font-size: 1.6em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
.cm-md-live-block h2 { font-size: 1.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.25em; }
.cm-md-live-block h3 { font-size: 1.2em; }
.cm-md-live-block p { margin: 0.5em 0; }
.cm-md-live-block ul,
.cm-md-live-block ol { padding-left: 1.6em; margin: 0.5em 0; }
.cm-md-live-block code {
  font-size: 0.9em;
  background: var(--bg-hover);
  border-radius: 4px;
  padding: 0.1em 0.35em;
}
.cm-md-live-block pre {
  background: var(--bg-hover);
  border-radius: var(--radius);
  padding: 10px 12px;
  overflow-x: auto;
  margin: 0.6em 0;
}
.cm-md-live-block pre code {
  background: none;
  padding: 0;
}
.cm-md-live-block blockquote {
  margin: 0.6em 0;
  padding: 0.2em 1em;
  border-left: 3px solid var(--accent);
  color: var(--text-secondary);
}
.cm-md-live-block table { border-collapse: collapse; margin: 0.6em 0; }
.cm-md-live-block th,
.cm-md-live-block td { border: 1px solid var(--border-strong); padding: 4px 10px; }
.cm-md-live-block th { background: var(--bg-hover); }
.cm-md-live-block img { max-width: 100%; }
.cm-md-live-block a { color: var(--accent); }
.cm-md-live-block hr { border: none; border-top: 1px solid var(--border); margin: 1em 0; }
.cm-md-live-block input[type="checkbox"] {
  margin-right: 0.45em;
  accent-color: var(--accent);
  vertical-align: middle;
}
.cm-md-live-block li:has(> input[type="checkbox"]) {
  list-style: none;
  margin-left: -1.2em;
}
.cm-md-live-block a.md-link-blocked {
  color: var(--text-secondary);
  text-decoration: line-through;
  cursor: not-allowed;
}
.cm-md-live-block img.md-img-blocked {
  display: inline-block;
  min-width: 1.4em;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  padding: 0 0.4em;
  font-size: 0.85em;
}
```

- [ ] **Step 2: 验证构建**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/styles/app.css
git commit -m "即时渲染 M1：渲染块排版样式（与分栏预览一致，字体继承编辑器）"
```

---

### Task 10: 全量验证与手工冒烟

**Files:** 无新文件。

- [ ] **Step 1: 全量自动化验证**

Run: `pnpm test && npx tsc --noEmit && pnpm build`
Expected: 全部通过

- [ ] **Step 2: 手工冒烟（pnpm tauri dev）**

准备一个 `.md` 测试文件（标题/列表/任务列表/引用/代码块/分隔线/链接各一段），逐项确认：

1. 设置 → 实验特性 → 开启「Markdown 即时渲染」→ 打开 md 文件：非光标块渲染、光标块源码
2. 方向键移动光标跨块：块进出源码/渲染态切换流畅
3. `Cmd/Ctrl+/`：渲染↔源码整档切换，撤销栈不丢（切换后 Cmd+Z 仍可撤销之前的输入）
4. 中文 IME 在渲染文档中输入正常（活动块本就无装饰）
5. 选区跨两个块拖选：整档回源码；收回到单块恢复渲染
6. `Cmd/Ctrl+F` 打开查找：整档回源码；Esc 关闭恢复渲染
7. 渲染态点击链接 → 系统浏览器打开
8. 关闭「Markdown 即时渲染」开关 → 行为与现状一致（语法高亮按旧 markdown 开关）
9. 非 md 文件（.txt）不受任何影响
10. 分栏预览（旧开关开启时菜单打开）正常，且其菜单项不再显示快捷键

- [ ] **Step 3: 汇总**

把冒烟结果（通过/异常截图）回报；若有异常按 Task 6 风险预案排查 `Decoration.replace` 用法。
