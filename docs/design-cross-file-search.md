# 跨文件全文搜索 · 技术设计

> 状态：设计完成，待实现
> 日期：2025-08-08
> 关联：`docs/research-text-editor-needs.md`（需求 #1，最高置信缺口）
> 目标：让用户在"自己的笔记全集"里快速找到包含某段文字的文件，并跳转到具体位置。

---

## 一、目标与范围

### 需求依据

调研报告第一条强需求（HN 三源一致）："*ability to quickly **search** years worth of notes*"、*"not able to quickly search an old note*"。当前 Jotpad 只有**单文件** FindBar + **文件名** QuickOpen，缺**内容级跨文件搜索**。

### 搜索范围：为什么是「打开的标签 + 最近文件」

Jotpad 是**无 workspace 概念**的多标签记事本——用户的"笔记全集"天然由两部分构成：

1. **打开的标签**（tabs）：内存中的 `content`，即时可搜。
2. **最近文件**（recentFiles，上限 `MAX_RECENT = 20`）：用户的历史笔记路径，需读盘。

这两者就是 Jotpad 语境下最自然的"我的笔记"集合，且 **recents 有界（≤20）**，纯前端读盘+缓存即可，**无需新增 Rust 命令**。

> 不采用「文件夹/工作区搜索」作为 MVP：Jotpad 没有 workspace 概念，每次选目录是额外摩擦。文件夹搜索作为 **Tier-2 增强**（见第九节），需要新增 Rust 遍历命令，不在首版。

### 范围

- ✅ 在「tabs + recents」范围内做内容搜索（大小写/正则/整词）
- ✅ 结果按文件分组，显示 `路径:行号` + 命中预览（高亮）
- ✅ 选中结果 → 打开文件 → 跳转到命中位置 →（可选）同步单文件搜索便于继续翻
- ❌ 不做：替换（跨文件替换风险高，先不做）、文件夹递归搜索（Tier-2）

---

## 二、现状与可复用件

| 现有件 | 复用方式 |
|--------|---------|
| `src/lib/search.ts` → `buildMatcher(q)` / `escapeRegExp` | 直接复用，统一大小写/正则语义 |
| `src/lib/fuzzy.ts` | 不复用（这是精确内容匹配，非模糊文件名） |
| `backend.ts` → `readFile(path): Promise<ReadResult>` | 读取 recent 文件内容 |
| `QuickOpen.tsx` | UI/交互范式参照（overlay + 列表 + 键盘导航） |
| store → `tabs[].content` / `recentFiles` | 搜索数据源 |
| store 模式 → `quickOpenOpen` / `setQuickOpenOpen` | 仿照加 `crossSearchOpen` |

---

## 三、整体架构（纯前端，无 Rust 改动）

```
┌─ CrossSearch.tsx (overlay 组件) ─────────────────────────┐
│  query input  [Aa] [.*] [\b]   ← 大小写/正则/整词          │
│  ─────────────────────────────────────────────────────  │
│  📄 notes.md · /path/notes.md                 3 个匹配   │  ← FileHit
│      12  ...命中行的预览，<mark>关键词</mark>高亮...       │  ← LineHit
│      47  ...                                              │
│  📄 todo.txt · ...                                        │
└──────────────────────────────────────────────────────────┘
        │ 选中命中
        ▼
  openPath(path) / setActiveTab(id)  →  view.dispatch({selection})  →  focus
```

**数据流**：打开面板时后台并行读取 recents → 缓存 `Map<path, string>`；每次输入（防抖 200ms）对 `tabs.content + 缓存` 跑匹配 → 结构化结果 → 渲染。

---

## 四、核心模块：`src/lib/crossSearch.ts`

### 4.1 数据模型

```ts
/** 一条命中：所在行、列、文档绝对偏移、整行文本（已 trim）。 */
export interface LineHit {
  line: number;     // 1-based
  col: number;      // 1-based
  from: number;     // 文本内绝对偏移（用于跳转选区）
  to: number;
  text: string;     // 行文本（超长截断到 ~120 字符）
}

/** 一个文件的命中集合。 */
export interface FileHit {
  key: string;            // tab.id 或 path
  path: string | null;
  label: string;          // 文件名 / "新建"
  tabId: string | null;   // 来自打开的 tab 则有值
  matchCount: number;     // 该文件总命中数（lines 可能被截断）
  lines: LineHit[];       // 展示用，已封顶
}

/** 搜索源：抽象 tab 与 recent 的统一接口。 */
export interface SearchSource {
  key: string;
  path: string | null;
  label: string;
  tabId: string | null;
  getText(): string | Promise<string>;
}
```

### 4.2 匹配函数（复用 search.ts 的 matcher）

```ts
import { buildMatcher } from "@/lib/search";

const MAX_LINE_LEN = 120;     // 预览行截断
const MAX_LINES_PER_FILE = 50;
const MAX_TOTAL_HITS = 200;
const BIG_FILE = 2_000_000;   // 跳过 >2MB

/** 对单个文本跑匹配，返回行级命中（带绝对偏移）。 */
export function searchText(
  text: string,
  re: RegExp,
  cap = MAX_LINES_PER_FILE,
): LineHit[] {
  const hits: LineHit[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let line = 1, lineStart = 0, nextLF = text.indexOf("\n");
  const advance = (upto: number) => {
    for (let i = lineStart; i < upto; i++) if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
  };
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    advance(m.index);
    const col = m.index - lineStart + 1;
    // 取整行文本
    let le = nextLF; // 简化：后续实现里用当前 line 的 LF
    hits.push({ line, col, from: m.index, to: m.index + m[0].length,
                text: trimLine(text, lineStart, le) });
    if (hits.length >= cap) break;
  }
  return hits;
}

/** 对一批源跑搜索，返回按文件分组、命中数降序的结果。 */
export async function searchFiles(
  sources: SearchSource[],
  re: RegExp,
): Promise<FileHit[]> {
  const out: FileHit[] = [];
  let total = 0;
  for (const src of sources) {
    if (total >= MAX_TOTAL_HITS) break;
    let text: string;
    try { text = await src.getText(); } catch { continue; }
    if (text.length > BIG_FILE) continue;
    if (isBinary(text)) continue;
    const lines = searchText(text, re);
    if (!lines.length) continue;
    out.push({ key: src.key, path: src.path, label: src.label, tabId: src.tabId,
               matchCount: lines.length, lines });
    total += lines.length;
  }
  return out.sort((a, b) => b.matchCount - a.matchCount);
}
```

> `searchText` 的换行追踪在上文为示意骨架；实现时按"逐行扫描 + 行内 exec"的稳妥写法（避免全局 lastIndex 与行偏移错位）。

### 4.3 二进制检测

```ts
function isBinary(text: string): boolean {
  // 前 8000 字符内出现 NUL，或非文本字符占比过高 → 视为二进制跳过
  const sample = text.length > 8000 ? text.slice(0, 8000) : text;
  if (sample.includes("\u0000")) return true;
  return false;
}
```

---

## 五、组件：`src/components/CrossSearch.tsx`

镜像 `QuickOpen.tsx` 的 overlay + 键盘导航范式，但展示**按文件分组的命中行**。

### 状态

```ts
const [query, setQuery] = useState("");
const [opts, setOpts] = useState({ caseSensitive: false, regexp: false, wholeWord: false });
const [results, setResults] = useState<FileHit[]>([]);
const [scanning, setScanning] = useState(false);
const cache = useRef<Map<string, string>>(new Map()); // path -> text
const reqToken = useRef(0);                            // 取消过期请求
```

### 打开时预热缓存（后台并行读 recents）

```ts
useEffect(() => {
  if (!open) return;
  // recents 有界（≤20），并行读取；失败静默跳过
  void Promise.all(recentFiles.map(async (p) => {
    if (cache.current.has(p)) return;
    try { cache.current.set(p, (await readFile(p)).text); } catch { /* 删除/移动 */ }
  }));
}, [open, recentFiles]);
```

### 构造搜索源 + 防抖搜索

```ts
useEffect(() => {
  if (!open || !query.trim()) { setResults([]); return; }
  const token = ++reqToken.current;
  setScanning(true);
  const id = setTimeout(async () => {
    const re = buildMatcher({ search: query, caseSensitive: opts.caseSensitive,
                              regexp: opts.regexp, replace: "" });
    // 整词：包裹 \b...\b（仅非正则模式）
    const finalRe = re && opts.wholeWord && !opts.regexp
      ? new RegExp(`\\b(?:${re.source})\\b`, re.flags) : re;
    if (!finalRe) { setResults([]); setScanning(false); return; }
    const sources = buildSources(tabs, recentFiles, cache.current);
    const hits = await searchFiles(sources, finalRe);
    if (reqToken.current === token) { setResults(hits); setScanning(false); }
  }, 200);
  return () => clearTimeout(id);
}, [query, opts, open, tabs, recentFiles]);
```

`buildSources`：tabs 优先（`getText: () => tab.content`），recents 去重后（`getText: () => cache.get(p) ?? ""`）。

### 键盘导航与选中跳转

把结果拍平成 `FlatItem = { file: FileHit; line: LineHit }`，`↑/↓` 在命中行间移动，`Enter` 跳转：

```ts
const pick = async (file: FileHit, line: LineHit) => {
  setCrossSearchOpen(false);
  if (file.tabId) setActiveTab(file.tabId);
  else if (file.path) await openPath(file.path);
  // 跳到命中偏移（doc 偏移 = 文件文本偏移，内容一致）
  requestAnimationFrame(() => {
    const v = getEditorView();
    v?.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
    v?.focus();
  });
};
```

> 可选增强：跳转后同步 CodeMirror 单文件搜索查询（`applySearchQuery`），让 `F3` 在该文件内继续翻。首版可不加。

### 触发与快捷键

- 快捷键 **`Cmd/Ctrl+Shift+F`**（业界通用"在文件中查找"约定）。在 `shortcuts.ts` 加 `crossSearch` 条目；`App.tsx` 的全局 keydown 已会走 `runMenuAction`。
- 菜单：在「编辑」菜单 Find 系列下加「在文件中查找…」。

---

## 六、store 改动（极小）

仿照 `quickOpenOpen`：

```ts
// 类型
crossSearchOpen: boolean;
setCrossSearchOpen: (v: boolean) => void;
// 初值
crossSearchOpen: false,
// 实现
setCrossSearchOpen: (v) => set({ crossSearchOpen: v }),
```

`App.tsx` 在 `<QuickOpen />` 旁渲染 `<CrossSearch />`。

---

## 七、性能与边界

| 关注点 | 处理 |
|--------|------|
| 频繁输入 | 200ms 防抖；`reqToken` 丢弃过期结果 |
| 大文件 | `> BIG_FILE(2MB)` 跳过 |
| 二进制 | NUL 检测跳过 |
| 结果爆炸 | 全局封顶 `MAX_TOTAL_HITS=200`，单文件 `MAX_LINES_PER_FILE=50` |
| 预览过长 | 行文本截断 ~120 字符 |
| recents 已删/移动 | `readFile` 抛错静默跳过 |
| 重复读盘 | 缓存 `Map<path,text>`，仅在面板打开时预热一次 |
| 内存 | recents ≤20，缓存文本总量可控 |

---

## 八、实现拆解（文件清单）

| 文件 | 改动 |
|------|------|
| `src/lib/crossSearch.ts` | **新增**：`LineHit`/`FileHit`/`SearchSource` 类型 + `searchText` / `searchFiles` / `isBinary` |
| `src/lib/crossSearch.test.ts` | **新增**：`searchText` 单测（多行偏移、整词、封顶、二进制跳过） |
| `src/components/CrossSearch.tsx` | **新增**：overlay 组件（输入/开关/分组结果/键盘导航/跳转） |
| `src/store/useStore.ts` | 加 `crossSearchOpen` / `setCrossSearchOpen` |
| `src/lib/shortcuts.ts` | 加 `crossSearch` = `Cmd/Ctrl+Shift+F` |
| `src/lib/menuActions.ts` | 菜单项「在文件中查找…」→ `setCrossSearchOpen(true)` |
| `src/lib/i18n.ts` | 新增 `crossSearch.*` 中英键 |
| `src/App.tsx` | 渲染 `<CrossSearch />` |
| `src/styles/app.css` | 复用 `quick-open-*` 样式，加少量命中行样式 |

成本预估：约 1.5 天（核心 lib 半天、组件 1 天、测试与联调半天）。

---

## 九、测试计划

1. **单元**（`crossSearch.test.ts`）：
   - 多行文本命中：行号/列/绝对偏移正确
   - 大小写、正则、整词三种模式
   - 单文件命中封顶 `MAX_LINES_PER_FILE`
   - `isBinary` 对含 NUL 文本返回 true
2. **手动**：
   - 打开面板 → 输入关键词 → 实时分组结果
   - `↑/↓` 在文件间/行间移动，`Enter` 跳转到正确行列
   - 大小写/正则/整词开关生效
   - recents 中已删除文件不报错、不显示
   - 大文件被跳过、结果封顶不卡 UI
3. **回归**：现有 29 测试全过；单文件 FindBar、QuickOpen 不受影响。

---

## 十、范围之外（后续观察项）

- **跨文件替换**：风险高（多文件写入 + 撤销复杂），待明确需求再做。
- **文件夹/工作区搜索（Tier-2）**：需新增 Rust 命令 `search_in_dir(dir, pattern, opts)` 递归遍历 + 读 + 匹配，返回结构化结果。适合作为「在文件夹中查找…」入口，与 MVP 并存。
- **索引加速**：recents ≤20 不需要；若将来支持大目录，再考虑增量索引。
