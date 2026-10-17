# Markdown 即时渲染（Typora 式）设计

> 状态：已评审通过（2026-10-17）。承接 [design-markdown-experimental.md](design-markdown-experimental.md)（v0.5 实验期分栏预览）的下一步。
> 形态决策：单栏即时渲染（非活动块渲染、活动块源码），双模式切换，分栏预览过渡后移除，第一期含可编辑表格。

## 一、背景与目标

### 现状

- 实验开关 `settings.experimental.markdown`（默认关）提供：语法高亮、分栏实时预览（marked，300ms 防抖）、单向百分比滚动同步、外链系统浏览器打开、`Cmd/Ctrl+B/I` 包裹。
- 已知遗留：`MarkdownPreview.tsx` 内有调试用 `setInterval` 每秒覆写 `document.title`（DBG 残留，已随 v0.2.2 发布）——M1 一并清除。

### 目标形态

- **单栏即时渲染**：md 文件在编辑器内直接呈现排版效果；光标所在块显示 Markdown 源码，离开后恢复渲染。
- **双模式**：即时渲染（默认）/ 纯源码，`Cmd/Ctrl+/` 切换；切换不丢撤销栈。
- **可编辑表格**：渲染态下点击单元格直接编辑（Tab/方向键导航、右键增删行列）。
- **分栏预览**：过渡期保留并标注「将废弃」，新模式稳定一个版本后移除。

### 非目标（本期明确不做）

数学公式、mermaid、拖拽插图、图片管理、富文本、可编辑表格以外的块级编辑增强（如列表拖拽排序）。

## 二、技术路线

| | A：CodeMirror 6 装饰（选定） | B：Milkdown / ProseMirror 双引擎 |
|---|---|---|
| 编辑原语 | 撤销/IME/查找/多光标/快捷键全部原生保留 | md 模式下全部重建 |
| 数据模型 | md 源码是唯一事实，无往返 | PM 文档 ↔ md 序列化会规范化用户源码 |
| 包体 | 复用现有依赖，增量极小 | 新增编辑器框架 |
| 风险 | 装饰边界场景自担（Obsidian 已验证该路线） | 双栈长期维护成本 |

**决策：方案 A。** 一切编辑仍是 CM6 transaction，文件永远等于用户所打（表格块写回除外，见四）。

## 三、架构与模块

```
src/lib/md/
├── blocks.ts        # 纯函数：视口行区间 + lezer 语法树 → BlockInfo[]
├── render.ts        # 纯函数：块文本 → 安全 HTML（复用 escapeHtml/safeUrl/sanitize + marked 逐块解析）
├── decorations.ts   # CM6 ViewPlugin：非活动块 → Decoration.replace + Widget
├── tableWidget.ts   # 可编辑表格 Widget + applyBlockEdit 事务写回
└── mode.ts          # 模式状态与切换；开关 settings.experimental.mdLive
```

- **blocks.ts**：`BlockInfo = { from, to, type }`，type ∈ heading / list / quote / code / table / hr / paragraph。输入为视口行 + 现有 lezer markdown 树（依赖已存在），不新引解析器。可单测。
- **render.ts**：`renderBlock(text, type) → string`（HTML）。逐块调用 marked（与分栏预览同源，保证两边渲染一致），输出过 sanitize。单块渲染失败 → 返回 null，调用方回退源码显示，**不允许空白**。
- **decorations.ts**：ViewPlugin 监听 doc/selection/viewport 变化重建装饰；只处理视口内块；doc 变更仅重算受影响行区间。产出 `DecorationSet`。
- **tableWidget.ts**：`WidgetType` 子类渲染表格 DOM；`applyBlockEdit(view, blockRange, newText)` 以 `userEvent: "input"` 派发变更（进原生撤销栈）。
- **mode.ts**：`settings.experimental.mdLive`（总开关，默认关）+ `settings.mdViewMode: "live" | "source"`（视图偏好，开 mdLive 时默认 live）。`Cmd/Ctrl+/` 切换视图偏好并持久化。
- **Editor.tsx 接入**：经现有 `langCompartment` 模式按 `mdLive && mdViewMode` 挂载「live 扩展集」或「纯源码扩展集」，不新建编辑器实例。

## 四、交互规则

### 块激活与选区

- 块激活 = 选区与块区间 `(from, to)` 相交；**块尾边界与块间空隙位置不属于任何活动块**（相邻块保持渲染，首个键入字符后该块立即转源码）。
- **多光标（Mod-d / Alt+点击）→ 整档回源码**（与跨块选区同策略，避免盲编辑不可见文本）。
- **选区跨块 → 整个文档临时回源码视图**；选区收回单块内恢复渲染。
- 查找/替换面板打开期间，全文档临时源码化（命中高亮不进 widget），关闭后恢复。
- IME 组合期间活动块本无装饰，无需特殊处理。

### 表格（M2）

- 点击单元格 → 表块进入**表格编辑态**：渲染 widget + 单元格 contenteditable；`Tab/Shift+Tab` 横向跳格、`Enter` 下一行（末行追加行）、方向键网格内移动、右键菜单增删行列。
- 每次单元格内容变更即派发写回事务；撤销粒度与正文一致（逐字符）。
- 写回 = **仅重排该表格块**的 GFM 源码：列宽按单元格显示宽度对齐（CJK 宽度感知），保留对齐行样式（`---` / `:---:`）。文档其余部分零改动。
- M2 拆两级：**M2a 表格渲染（只读，点击进源码并定位）→ M2b 可编辑 Widget**。M2b 延期不影响 M2a 交付。

### 链接与打印

- 渲染态点击链接 = 系统浏览器打开（M1 已实现）；`Cmd/Ctrl+点击` = 定位到源码（**移至 M2 范围**）。
- 打印：live 模式打印渲染版面（复用 render.ts 全文分块输出），source 模式现状不变。

### 性能红线

- 装饰只算视口；输入只重算受影响块。
- 文件 > 2MB 不启用即时渲染，回退纯源码（与现有大文件只读策略同阈值）。
- 大纲/光标联动不受影响：replace 装饰不改文档偏移，outline 定位天然正确。

## 五、里程碑

| 里程碑 | 内容 | 风险 | 回滚 |
|---|---|---|---|
| M1 | 基础块渲染（标题/粗斜体/行内代码/列表含任务列表/引用/代码块高亮/分隔线/链接）+ Cmd+/ 切换 + 清除 DBG 残留 | 低 | 关 mdLive 即回现状 |
| M2a | 表格渲染（只读）+ 点击定位源码 | 中 | 同上 |
| M2b | 可编辑表格 Widget | **高** | 单独开关灰度；fallback = M2a 行为 |
| M3 | 查找适配、打印适配、滚动/大纲复核、包体复核（超重改按需 import）、**renderBlockHtml 按块文本记忆化**（M1 每次事务全视口重算的补课，命中箭头键导航等高频路径） | 中 | — |
| M4 | 分栏预览标注「将废弃」→ 一版后移除 `MarkdownPreview.tsx`；`experimental.markdown` 并入 `mdLive`（源码模式语法高亮随 mdLive），marked 保留给打印 | 低 | — |

## 六、风险与对策

| 风险 | 对策 |
|---|---|
| 表格编辑复杂度（最高） | M2a/M2b 拆分 + 独立灰度开关 + 点击进源码 fallback |
| 装饰与选区/IME 边界错乱 | 跨块选区/查找打开即全源码化；宁可少渲染不可错交互 |
| 表格写回改动未输入区域 | 写回严格限定表格块内部；列宽规范化仅表格块 |
| 性能回退（长文档/低端机） | 视口级装饰 + 受影响块重算 + 2MB 阈值熔断 |
| 主包体积 | 复用现有 marked/lezer 依赖，增量预期极小；M3 复核实测 |

## 七、测试策略

- `blocks.ts`：块划分单测（嵌套列表、表格、围栏代码、引用嵌套、CRLF）。
- `render.ts`：每块类型 → HTML 快照；XSS 用例复用分栏预览的攻击样本（实体绕过、`javascript:`、`data:`）。
- `tableWidget.ts`：单元格编辑 → 源码断言（含 CJK 列宽、对齐行保留、增删行列）。
- 手工矩阵：中日 IME、撤销/重做、查找替换、大纲跳转、模式切换、大文件熔断、打印。

## 八、转正与废弃

- 转正标准沿用 ROADMAP：`mdLive` 默认开启不影响启动性能；无未修 P0/P1；连续两个版本无回归。
- 分栏预览废弃节奏：M4 标注 → 相邻版本移除；发布说明告知迁移（`Cmd/Ctrl+/`）。
