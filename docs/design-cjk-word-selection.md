# CJK 词边界选词优化 · 技术设计

> 状态：设计完成，待实现
> 日期：2025-08-08
> 关联：`docs/research-text-explosion.md`（需求验证结论）
> 目标：修复 Jotpad（CodeMirror）双击中文时"选中整段而非一个词"的体验缺陷。

---

## 一、背景与范围

需求验证（见研究文档第六节）已判定：**「文字大爆炸」大功能不成立**，但其底层痛点「中文双击选词不准」**真实存在**，且是 Jotpad 当前编辑器（CodeMirror 6）的已知缺陷。

本设计把原「大爆炸」窄化为**一个高 ROI 的微修复**：

> 双击中文字符时，选中一个「分词后的词」，而非整段连续中文。

### 范围

- ✅ **在范围内**：双击（`detail === 2`）选中文词
- ❌ **不在范围内**（保留观察）：
  - `Ctrl/Cmd + ←/→` 按词移动光标（`moveByGroup`，走 commands 包另一条路径，单独议题）
  - 三击选行、单击定位、拖拽选区（保持默认）
  - 「大爆炸」多选 / 重排浮层（无需求证据，已砍）

---

## 二、根因分析（CodeMirror 6 源码级）

CodeMirror 双击选词的调用链：

```
mousedown → basicMouseSelection() → get() → rangeForClick(pos, type=2) → groupAt(state, pos)
```

`groupAt`（`@codemirror/view` 内部函数，非导出）的核心：

```js
function groupAt(state, pos, bias = 1) {
  let categorize = state.charCategorizer(pos);   // ← 关键
  // ... 取首簇，记其类别 cat
  while (from > 0) { prev = ...; if (categorize(...) != cat) break; from = prev; }  // 向左扩
  while (to < len)  { next = ...; if (categorize(...) != cat) break; to = next; }   // 向右扩
}
```

即：**从点击处取字符类别，向两侧扩展直到类别变化**。类别由 `makeCategorizer` 给出（`@codemirror/state`）：

```js
function makeCategorizer(wordChars) {
  return (char) => {
    if (!/\S/.test(char)) return Space;
    if (hasWordChar(char)) return Word;   // hasWordChar = /[\p{Alphabetic}\p{Number}_]/
    return Other;
  };
}
```

**根因**：CJK 汉字（U+4E00–U+9FFF）**既不是 Alphabetic 也不是 Number**，故归类为 **`Other`**。一段连续中文全是 `Other`，`groupAt` 一路扩展到词边界（遇到空格/英文/标点）才停 → **双击选中整段中文**。

> 仅靠覆盖 `EditorState.charCategorizer` / `wordChars` **无法解决**：把 CJK 改成 `Word` 仍是同一类别，整段依旧被合并；类别机制只在「类别切换处」断词，中文词内部没有类别切换。

---

## 三、扩展点选型（对比 4 个候选）

| # | 方案 | 可行性 | 结论 |
|---|------|--------|------|
| A | 覆盖 `EditorState.charCategorizer` / `wordChars` | ❌ | 类别是「按段」的，无法在 CJK 内部分词（见根因） |
| B | 重写整个 `mouseSelectionStyle` | ⚠️ | 需复制 `basicMouseSelection` 全部逻辑（单击/三击/拖拽/extend/multiple），风险大 |
| C | DOM 层拦截 `dblclick` 事件 | ❌ | 与 CM 自有鼠标处理打架，脆弱 |
| **D** | **自定义 `mouseSelectionStyle`，仅接管双击 + CJK** | ✅ | **选定** |

### 方案 D 的可行性依据（源码验证）

CM 选择 style 的逻辑（`@codemirror/view`）：

```js
let style = null;
for (let makeStyle of view.state.facet(mouseSelectionStyle)) {
  style = makeStyle(view, event);
  if (style) break;                 // ① 首个非 null 生效
}
if (!style && event.button == 0)
  style = basicMouseSelection(view, event);  // ② 全部返回 null 时回落默认
```

**关键**：facet 值返回 `null` 即「我不处理，交给下一个 / 最终回落 `basicMouseSelection`」。这正是 `rectangularSelectionStyle`（Alt 拖拽列选）的现成模式：

```js
EditorView.mouseSelectionStyle.of((view, event) => filter(event) ? rectangleStyle(...) : null)
```

→ 我的 style 只要：**双击 + 点中 CJK 字符**才返回非 null，其余一律 `null`。于是单击/三击/拖拽/英文双击**完全不受影响**，零回归风险。

---

## 四、选定方案：`Intl.Segmenter` + CJK 门控

### 4.1 分词引擎：用浏览器内置 `Intl.Segmenter`（零依赖）

放弃 `jieba-wasm`（~数百 KB）。改用所有现代 WebView（WebView2 / WKWebView）都内置的 [`Intl.Segmenter`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)，`granularity: "word"` + locale `"zh"`，基于 ICU 词典分词。

**实测（Node 22，与 Tauri WebView 行为一致）**：

```
"文字大爆炸是真实需求吗"   => ["文字","大","爆炸","是","真实","需求","吗"]
"我喜欢用Jotpad写代码和笔记" => ["我","喜欢","用","Jotpad","写","代码","和","笔记"]
"中华人民共和国万岁"       => ["中华","人民","共和国","万岁"]
光标落在"炸"(pos=3)        => 命中 "爆炸" [from=3, to=5]
```

- **体积**：0 字节新增
- **质量**：足够选词用途（非完美，如「中华/人民/共和国」切分偏细，但双击选中一个分词单元已远好于选整段）
- **降级**：`typeof Intl.Segmenter === "undefined"` 时回落默认 `groupAt` 行为

### 4.2 为什么必须 CJK 门控（不能全局替换）

`Intl.Segmenter` 与 CM 默认对**非中文**的处理有差异：

| 文本 | CM 默认双击 | Intl.Segmenter |
|------|------------|----------------|
| `100.5` | `100`（`.` 是 Other 断开） | `100.5`（整体一个词） |
| `v1.2.3` | `v1` / `2` / `3` | `v1.2.3` |
| `user@example.com` | `user` / `example` / `com` | `user` / `example.com` |

这些差异未必更差，但**违反"只修中文、不改英文"的手术刀原则**。故门控：仅当点击字符落在 CJK 区段才接管，否则返回 `null` → 默认。

CJK 区段正则：`[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]`（CJK 扩展 A + 统一汉字 + 兼容汉字 + 平假名/片假名 + 韩文音节）。

---

## 五、实现（参考代码）

新增 `src/lib/cjkSelection.ts`，在 `Editor.tsx` 的 extensions 中注册。

```ts
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// CJK + 兼容汉字 + 日文假名 + 韩文音节。命中才接管双击。
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (typeof Intl === "undefined" || typeof (Intl as any).Segmenter === "undefined") return null;
  if (!segmenter) segmenter = new Intl.Segmenter("zh", { granularity: "word" });
  return segmenter;
}

/** 返回 pos 所属词的 [from,to)；标点/空白/不支持则 null（交默认）。 */
function wordRangeAt(state: { doc: { lineAt(p: number): any } } & any, pos: number) {
  const seg = getSegmenter();
  if (!seg) return null;
  const line = state.doc.lineAt(pos);
  const rel = pos - line.from;
  for (const s of seg.segment(line.text)) {
    if (rel >= s.index && rel < s.index + s.segment.length) {
      if (!s.isWordLike) return null; // 标点/空白段交默认
      return { from: line.from + s.index, to: line.from + s.index + s.segment.length };
    }
  }
  return null;
}

/** 仅接管「双击 + 点中 CJK」；其余一律返回 null 交默认 basicMouseSelection。 */
export const cjkWordSelection = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.detail !== 2) return null;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) return null;
  if (!CJK_RE.test(view.state.sliceDoc(pos, pos + 1))) return null;

  const startSel = view.state.selection;
  let startPos = pos;

  return {
    update(update: any) {
      if (update.docChanged) startPos = update.changes.mapPos(startPos);
    },
    get(event: MouseEvent, extend: boolean, multiple: boolean) {
      const cur = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? startPos;
      const wr = wordRangeAt(view.state, cur);
      let range = wr ? EditorSelection.range(wr.from, wr.to) : EditorSelection.cursor(cur);

      // 双击后拖拽：按词扩选（与默认 groupAt 拖拽语义对齐）
      if (startPos !== cur && !extend && wr) {
        const sr = wordRangeAt(view.state, startPos);
        if (sr) {
          const from = Math.min(sr.from, wr.from), to = Math.max(sr.to, wr.to);
          range = EditorSelection.range(from, to);
        }
      }
      if (extend) return startSel.replaceRange(startSel.main.extend(range.from, range.to));
      if (multiple) return startSel.addRange(range);
      return EditorSelection.create([range]);
    },
  };
});
```

`Editor.tsx` 注册（在 extensions 数组中追加）：

```ts
import { cjkWordSelection } from "@/lib/cjkSelection";
// ...
extensions: [ /* 既有扩展... */ , cjkWordSelection ],
```

---

## 六、边界与降级

| 情况 | 行为 |
|------|------|
| 点击英文/数字/标点/emoji | `null` → 默认 `groupAt`，零变化 |
| 单击 / 三击 / 拖拽起始 | `null` → 默认 |
| `Intl.Segmenter` 不存在（极旧 WebView） | `wordRangeAt` 返回 null → 默认 |
| 点击落在中文标点（`，。！`）段 | `s.isWordLike === false` → 返回 null → 默认（选中标点本身） |
| 分词跨视觉行（软换行） | `lineAt(pos)` 限定到逻辑行，分词在行内，正确 |

---

## 七、测试计划

1. **手动**：
   - 双击「文字大爆炸」中的「爆」→ 应只选「爆炸」
   - 双击英文单词、版本号 `v1.2.3`、邮箱 → 行为与改动前一致
   - 双击中文标点「，」→ 选中标点（默认行为）
   - 双击后横向拖拽 → 按词扩选
2. **单元**（`cjkSelection.test.ts`）：对 `wordRangeAt` 用 `EditorState.create({doc})` 构造状态，断言各 pos 命中区间；含英文/标点返回 null。
3. **回归**：现有 25 个测试全过；确认未触及 Tab/工具栏/状态栏逻辑。

---

## 八、成本与收益

- **成本**：约 1 个新文件（~50 行）+ Editor.tsx 加一行注册；分词零依赖。预计半天。
- **收益**：修掉 CodeMirror 已知 CJK 缺陷，所有中文用户双击选词即受益；无新 UI、不臃肿，契合极简定位与 Bear 用户「别臃肿」诉求。
