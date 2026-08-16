# 文档大纲（TOC）跳转 · 技术设计

> 状态：✅ 已实现（2025-08-08）
> 日期：2025-08-08
> 关联：`docs/research-text-editor-needs.md`（需求 #2：大纲 / TOC 跳转，iA Writer 用户因缺它打 1★）
> 目标：长文（Markdown）里按标题层级快速跳转。

---

## 一、方案：按需唤出的「大纲」面板（overlay）

延续 Jotpad「按需、不常驻」哲学（同 QuickOpen / CrossSearch），而非侧边常驻面板：

- **快捷键** `Cmd/Ctrl+Shift+O`（业界 "Go to Symbol in File" 惯例）+ 「编辑」菜单「文档大纲…」。
- overlay 列出当前 tab 的标题树：层级缩进（`#`=顶层，`##` 缩进…），`↑/↓` 移动、`Enter` 跳转、输入即过滤。
- 跳转 = 选中标题行 + 滚动到视口。

> 不做常驻侧栏：小窗口的记事本，常驻大纲挤占编辑区；Bear 用户"别臃肿"警告适用。

## 二、解析器 `src/lib/outline.ts`

- **ATX 标题**：`^(#{1,6})\s+(.*)$`（每个逻辑行一次匹配）。
- **跳过代码围栏**：行首 ``` / ~~~ 开启的 fence 内不解析（防把代码里的 `#` 当标题）。
- 跳过空标题文本（`# ` 后为空）。
- 返回 `{ level, text, from, line }[]`：`from` 为标题行起始偏移（跳转选区用）、`line` 为 1-based 行号（展示）。
- 非 Markdown / 无标题 → 空数组 → 空态提示（"无标题——用 # 开始一行试试"）。

```ts
export interface OutlineItem { level: number; text: string; from: number; line: number; }
export function parseOutline(text: string): OutlineItem[];
```

## 三、组件 `src/components/Outline.tsx`

镜像 QuickOpen 交互范式：

- 打开时解析 active tab `content`（内存，纯同步，无需防抖）。
- 输入框过滤：复用 `fuzzyFilter`（按标题文本）。
- 列表行：缩进 `(level-1)*14px` + `H{level}` 小徽标 + 标题文本。
- `Enter` → 关闭 → `view.dispatch({selection: {anchor: from}, scrollIntoView: true})` → 聚焦。
- tab 切换时若面板开着 → 重新解析（依赖 activeTabId）。

## 四、接入（同 CrossSearch 模式）

- store：`outlineOpen` / `setOutlineOpen`
- shortcuts：`outline` = `Cmd/Ctrl+Shift+O`
- 菜单：「编辑」goto 之后加「文档大纲…」
- i18n：`outline.*` 中英；App.tsx 渲染；CSS 复用 quick-open + 少量缩进/徽标样式

## 五、测试

- 单测（`outline.test.ts`）：ATX 各级、fence 内忽略、空文本忽略、偏移/行号正确、空文档。
- 手动：`#`~`######` 展示与缩进、过滤、跳转滚动、无标题空态。
- 回归：全量 vitest + tsc。

## 六、成本

~半天：解析器 + 测试 1 小时、组件 + 接入 2 小时、联调 1 小时。零后端改动、零依赖。
