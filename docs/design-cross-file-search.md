# 跨文件全文搜索 · 技术设计

> 状态：设计完成（v2，纳入默认保存目录范围），待实现
> 日期：2025-08-08
> 关联：`docs/research-text-editor-needs.md`（需求 #1，最高置信缺口）
> 目标：让用户在自己的"笔记全集"里快速找到包含某段文字的文件并跳转，也能按文件名快速打开。

---

## 一、范围：默认保存目录 = 事实笔记根

Jotpad 虽无显式 workspace，但**每个系统都有默认保存目录**：

- 用户可设 `settings.defaultSaveDirectory`；未设则回落系统文档目录（`documentsDir()`）。
- 解析函数已存在：`resolveDefaultSaveDirectory(override)`（`backend.ts`）。

→ **这个目录就是用户的笔记根**。本设计把它作为主搜索范围，驱动三个能力（用户原话）：

1. **快速打开**（QuickOpen 增强）：按文件名在该目录里模糊查找，`Cmd/Ctrl+P` 能找到"从没打开过"的文件。
2. **跨文件搜索**（CrossSearch 新增）：按内容在该目录里全文检索，`Cmd/Ctrl+Shift+H`。

合并后的**搜索源**（优先级降序）：

| 源 | 获取方式 | 备注 |
|----|---------|------|
| 打开的 tabs | `tab.content`（内存） | 即时；已打开的优先 |
| 最近文件 recentFiles（≤20） | `readFile(path)` 缓存 | 工作记忆 |
| **默认保存目录文件** | 新增 Rust `list_dir_files` 枚举 + `readFile` 批量读 | **笔记全集**，本次新增 |

> 范围解析失败（无 defaultSaveDirectory 且无系统文档目录）时，自动降级为 tabs+recents，功能不中断。

### 范围

- ✅ 在「tabs + recents + 保存目录」内做**内容搜索**（大小写/正则/整词）
- ✅ 在保存目录内做**文件名快速打开**
- ✅ 结果按文件分组，显示 `相对路径:行号` + 命中预览（高亮）
- ✅ 选中 → 打开文件 → 跳转命中位置
- ❌ 不做：跨文件替换（风险高）、保存目录之外的任意文件夹（Tier-2）

---

## 二、现状与可复用件

| 现有件 | 复用 |
|--------|------|
| `backend.ts` → `readFile` | 读取文件内容（tabs/recents/dir 文件统一） |
| `backend.ts` → `resolveDefaultSaveDirectory` / `documentsDir` | 解析保存目录 |
| `backend.ts` → `basename` / `dirname` | 路径展示 |
| `src/lib/search.ts` → `buildMatcher` / `escapeRegExp` | 统一大小写/正则语义 |
| `QuickOpen.tsx` | 文件名打开的 UI/交互范式，将增强其数据源 |
| store → `tabs[].content` / `recentFiles` / `settings.defaultSaveDirectory` | 数据源 |
| **需新增**：Rust `list_dir_files` | JS 无法列目录（沙箱），唯一必须的新后端能力 |

---

## 三、新增 Rust 命令：`list_dir_files`（唯一后端改动）

JS 在 Tauri 沙箱内无法列举目录，故新增一个**纯 std 实现**（不加 crate）的枚举命令。它同时服务于 QuickOpen 与 CrossSearch。

```rust
#[derive(serde::Serialize)]
struct DirEntry {
    path: String,       // 绝对路径
    name: String,       // 文件名
    rel: String,        // 相对根目录的路径（展示用）
    size: u64,
    mtime_ms: u64,
}

#[tauri::command]
fn list_dir_files(
    dir: String,
    recursive: bool,        // 是否递归子目录
    max_files: usize,       // 数量上限，默认 1000
    exts: Vec<String>,      // 允许的扩展名（小写无点）；空=用内置文本默认
) -> Result<Vec<DirEntry>, String>
```

**遍历规则**：
- `recursive=true` 时递归，深度不限但受 `max_files` 截断。
- 跳过隐藏（`.` 开头）、跳过 `.git` / `node_modules` / `.DS_Store` 等噪声。
- 仅保留**文本类扩展名**（默认：`md markdown txt log csv json org rst html xml yml yaml toml ini`）；可被 `exts` 覆盖。
- 跳过 `> BIG_FILE(2MB)`，跳过符号链接（避免环）。
- 按 mtime 降序返回（最近改动的在前，QuickOpen 默认排序也更合理）。

> 注册：加入 `generate_handler![]` 列表。`backend.ts` 加 `listDirFiles(dir, opts)` 包装。

**为何不在 Rust 里做匹配**：保持后端"笨且快"、匹配逻辑只活在 JS（复用 `crossSearch.ts`，大小写/正则/整词语义统一）。文件读取复用现有 `readFile`（带编码检测/归一化），JS 侧并发限流（≤8）批量读，避免 N 次 IPC 串行。

---

## 四、核心匹配模块：`src/lib/crossSearch.ts`（与 v1 一致，范围扩大）

### 4.1 数据模型

```ts
export interface LineHit { line: number; col: number; from: number; to: number; text: string; }
export interface FileHit {
  key: string; path: string | null; label: string; rel: string | null;
  tabId: string | null; matchCount: number; lines: LineHit[];
}
export interface SearchSource {
  key: string; path: string | null; label: string; rel: string | null; tabId: string | null;
  getText(): string | Promise<string>;
}
```

### 4.2 匹配函数（复用 buildMatcher）

```ts
import { buildMatcher } from "@/lib/search";
const MAX_LINES_PER_FILE = 50, MAX_TOTAL_HITS = 200, BIG_FILE = 2_000_000;

export function searchText(text: string, re: RegExp, cap = MAX_LINES_PER_FILE): LineHit[] { /* 逐行扫描，行内 exec，记录绝对偏移与行号/列 */ }
export async function searchFiles(sources: SearchSource[], re: RegExp): Promise<FileHit[]> { /* 并发读+匹配，封顶，按命中数降序 */ }
```

### 4.3 搜索源构造（新增目录源）

```ts
// 并发限流读取
async function pooled<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> { /* 简易信号量 */ }

export async function buildSources(opts: {
  tabs: TabState[]; recentFiles: string[]; dirEntries: DirEntry[]; cache: Map<string, string>;
}): Promise<SearchSource[]> {
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  // 1) tabs（内存）
  for (const tb of opts.tabs) {
    const key = tb.filePath ?? tb.id;
    if (tb.filePath) seen.add(tb.filePath);
    out.push({ key, path: tb.filePath, label: tb.title, rel: tb.filePath, tabId: tb.id,
               getText: () => tb.content });
  }
  // 2) recents（去重）+ 3) dir 文件（去重）—— 合并后并发读
  const toRead: { path: string; label: string; rel: string }[] = [];
  for (const p of opts.recentFiles) if (!seen.has(p)) { seen.add(p); toRead.push({path:p,label:basename(p),rel:p}); }
  for (const e of opts.dirEntries) if (!seen.has(e.path)) { seen.add(e.path); toRead.push({path:e.path,label:e.name,rel:e.rel}); }
  await pooled(toRead, 8, async (it) => {
    if (opts.cache.has(it.path)) return;
    try { opts.cache.set(it.path, (await readFile(it.path)).text); } catch { /* 跳过 */ }
  });
  for (const it of toRead) out.push({ key: it.path, path: it.path, label: it.label, rel: it.rel,
                                       tabId: null, getText: () => opts.cache.get(it.path) ?? "" });
  return out;
}
```

> 缓存 `Map<path, text>` 在 CrossSearch 面板生命周期内复用；QuickOpen 不需读内容（只按名匹配）。

---

## 五、QuickOpen 增强：纳入保存目录

当前 QuickOpen 源 = tabs + recents。增强为 **tabs + recents + 保存目录文件**（经 `listDirFiles`）：

```ts
// QuickOpen 打开时（若未缓存）后台拉取目录列表
useEffect(() => {
  if (!open || dirCache.current) return;
  void (async () => {
    const dir = await resolveDefaultSaveDirectory(settings.defaultSaveDirectory);
    if (!dir) return;
    try { dirCache.current = await listDirFiles(dir, { recursive:true, maxFiles:1000, exts:[] }); }
    catch { dirCache.current = []; }
    // 触发重算 items
  })();
}, [open]);
```

- 文件项加 badge「目录」区分 tabs/recents。
- 模糊匹配 `label + rel`，recent 优先于目录冷文件。
- 选中 → `openPath(path)`（已有逻辑复用）。

> 这样 `Cmd/Ctrl+P` 真正变成"在我的笔记里找文件"，不再局限于历史记录。

---

## 六、CrossSearch 组件：`src/components/CrossSearch.tsx`

镜像 QuickOpen 的 overlay 范式，展示**按文件分组的命中行**。

```ts
const [query, setQuery] = useState("");
const [opts, setOpts] = useState({ caseSensitive:false, regexp:false, wholeWord:false });
const [results, setResults] = useState<FileHit[]>([]);
const [scanning, setScanning] = useState(false);
const contentCache = useRef<Map<string,string>>(new Map());
const dirRef = useRef<string | null>(null);
const dirEntries = useRef<DirEntry[]>([]);
const reqToken = useRef(0);

// 打开时解析目录 + 枚举（一次）
useEffect(() => { if (open) void warmup(); }, [open]);
async function warmup() {
  dirRef.current = await resolveDefaultSaveDirectory(settings.defaultSaveDirectory);
  if (dirRef.current) try { dirEntries.current = await listDirFiles(dirRef.current, {recursive:true,maxFiles:1000,exts:[]}); } catch {}
}

// 输入防抖搜索（200ms，reqToken 取消过期）
useEffect(() => { /* buildMatcher + 整词包裹；buildSources(tabs,recents,dirEntries,cache)；searchFiles；setResults */ }, [query, opts]);
```

**键盘导航**：结果拍平为 `FlatItem={file,line}`，`↑/↓` 跨行移动、`Enter` 跳转：

```ts
const pick = async (file: FileHit, line: LineHit) => {
  setCrossSearchOpen(false);
  if (file.tabId) setActiveTab(file.tabId);
  else if (file.path) await openPath(file.path);
  requestAnimationFrame(() => {
    const v = getEditorView();
    v?.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
    v?.focus();
  });
};
```

**展示**：文件头 `📄 name · rel · n 个匹配`，其下 `行号  预览（<mark>高亮</mark>）`。

---

## 七、store / 快捷键 / 菜单 / i18n

- **store**：仿 `quickOpenOpen` 加 `crossSearchOpen` / `setCrossSearchOpen`。
- **快捷键**：`crossSearch` = `Cmd/Ctrl+Shift+H`（原定 Cmd/Ctrl+Shift+F，实测在 macOS 被 WKWebView 之前的系统层吞掉，遂改 H），加入 `shortcuts.ts`。
- **菜单**：「编辑」下 Find 系列加「在文件中查找…」→ `setCrossSearchOpen(true)`。
- **i18n**：新增 `crossSearch.*`（title/placeholder/noResults/scanning/caseSensitive/regexp/wholeWord/results）+ QuickOpen 的「目录」badge。

---

## 八、性能与边界

| 关注点 | 处理 |
|--------|------|
| 目录文件多 | `list_dir_files` 封顶 `maxFiles=1000`，按 mtime 降序 |
| 频繁输入 | 200ms 防抖；`reqToken` 丢弃过期结果 |
| 大文件 | `>2MB` 在 Rust 枚举阶段即跳过 |
| 二进制 | 扩展名白名单 + JS 侧 NUL 检测双保险 |
| 结果爆炸 | 全局 `MAX_TOTAL_HITS=200`，单文件 `MAX_LINES_PER_FILE=50` |
| 读盘并发 | `pooled` 限流 ≤8，避免 IPC 风暴 |
| 目录解析失败 | 降级 tabs+recents，功能不中断 |
| 缓存 | 内容缓存随面板生命周期；目录列表缓存到 `dirRef` |

---

## 九、实现拆解（文件清单）

| 文件 | 改动 | 类型 |
|------|------|------|
| `src-tauri/src/lib.rs` | 新增 `list_dir_files` 命令 + 注册 | Rust（纯 std） |
| `src/lib/backend.ts` | `listDirFiles(dir, opts)` 包装 | TS |
| `src/lib/crossSearch.ts` | **新增**：类型 + `searchText`/`searchFiles`/`buildSources`/`pooled`/`isBinary` | TS |
| `src/lib/crossSearch.test.ts` | **新增**：`searchText`/`isBinary` 单测 | TS |
| `src/components/CrossSearch.tsx` | **新增**：overlay 组件 | TSX |
| `src/components/QuickOpen.tsx` | 增强：数据源加保存目录文件 | TSX |
| `src/store/useStore.ts` | `crossSearchOpen` / `setCrossSearchOpen` | TS |
| `src/lib/shortcuts.ts` | `crossSearch` 快捷键 | TS |
| `src/lib/menuActions.ts` | 菜单项 | TS |
| `src/lib/i18n.ts` | `crossSearch.*` + QuickOpen badge 中英 | TS |
| `src/App.tsx` | 渲染 `<CrossSearch />` | TSX |
| `src/styles/app.css` | 复用 quick-open 样式 + 命中行样式 | CSS |

成本预估：约 2 天（Rust 枚举 + 命令半天、crossSearch lib 半天、CrossSearch 组件半天、QuickOpen 增强与联调半天）。

---

## 十、测试计划

1. **Rust**（手动 / `cargo test` 可选）：`list_dir_files` 递归、隐藏/噪声跳过、扩展名过滤、`max_files` 截断、mtime 排序。
2. **单元**（`crossSearch.test.ts`）：多行命中偏移/行号/列、大小写/正则/整词、`MAX_LINES_PER_FILE` 封顶、`isBinary` NUL 检测。
3. **手动**：
   - `Cmd+Shift+H` → 输入词 → 实时分组结果（含保存目录文件）
   - `↑/↓/Enter` 跳转到正确行列
   - `Cmd+P` 能找到保存目录里"从未打开"的文件
   - 三开关（大小写/正则/整词）生效
   - 已删除文件、超大文件、二进制不报错不显示
   - 目录解析失败时降级为 tabs+recents
4. **回归**：现有测试全过；单文件 FindBar 不受影响。

---

## 十一、范围之外（后续）

- **跨文件替换**：多文件写入 + 撤销复杂，待明确需求。
- **任意文件夹搜索**：在保存目录之外"选择文件夹搜索"，UI 加一个目录选择入口，复用 `list_dir_files(recursive=true)`。可与默认目录并存。
- **忽略规则**：尊重 `.gitignore` / `.jotpadignore`（需引入 `ignore` crate 或自实现，非 MVP）。
- **增量索引**：目录很大时再做持久化索引加速。
