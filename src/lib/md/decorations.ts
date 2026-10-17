// 即时渲染（M1）：非活动块替换为渲染 HTML；活动块（光标/选区所在）显示源码。
// 块装饰由 StateField 在事务内同步计算（全文范围 + 渲染 HTML 记忆化）：选区/编辑事务
// 提交时装饰即与几何同步定型，方向键等光标移动不存在「选区已动、装饰后到」的异步空窗。
// M2c 一期：活动块源码行再叠「渲染形」样式（buildSourceStyling）——标记隐藏/替换为
// 渲染等价形，块切换（源码↔渲染）视觉归零。一切编辑仍是 CM6 transaction（撤销/IME 原生）。
// 渲染失败回退源码（renderBlockHtml → null）。
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  StateField,
  type EditorState,
  type Extension,
  RangeSetBuilder,
} from "@codemirror/state";
import { type BlockInfo, parseBlocks } from "@/lib/md/blocks";
import { renderBlockHtml } from "@/lib/md/render";
import { useStore } from "@/store/useStore";

class BlockWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(other: BlockWidget): boolean {
    return other.html === this.html && other.from === this.from && other.to === this.to;
  }
  toDOM(): HTMLElement {
    const host = document.createElement("div");
    host.className = "cm-md-live-block";
    host.innerHTML = this.html;
    // 把块源码区间挂到 DOM 上，供 mousedown 处理器按内容区比例映射光标到块内源码行列
    host.dataset.mdFrom = String(this.from);
    host.dataset.mdTo = String(this.to);
    return host;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 块活动域扩展终点（与替换装饰的吞并范围一致）：下一块 from（吞并块尾换行 + 分隔空行）；
 *  末块为文本末。 */
function extendedEnds(blocks: BlockInfo[], textLength: number): number[] {
  return blocks.map((_, i) => (i + 1 < blocks.length ? blocks[i + 1].from : textLength));
}

/**
 * 位置所在块下标（活动域判定）：域 = [block.from, 扩展终点)。
 * 不变量：光标位置永不被替换装饰覆盖——分隔空行带已被前块装饰吞并，其上的插入点
 * 必须归前块活动域（前块保持源码 → 空行可见、光标可见、上下键逐可见行移动）。
 * 末块活动域额外含文本末位置本身（尾随空行也被吞并，文档末光标同样归末块）。
 * 首块之前的引导空行不属于任何块（-1，全部渲染）。
 */
function indexAt(blocks: BlockInfo[], ends: number[], pos: number, base: number): number {
  for (let i = 0; i < blocks.length; i++) {
    if (pos < base + blocks[i].from) return -1;
    const end = base + ends[i];
    if (pos < end || (pos === end && i === blocks.length - 1)) return i;
  }
  return -1;
}

/** 共享活动块判定（buildBlockDecorations / buildSourceStyling 同语义）：
 *  多光标 / 跨块选区 → null（全部回源码，避免盲编辑不可见文本）；否则活动块下标
 *  （-1 = 不在任何块活动域）。suppress 由调用方先行短路。 */
function activeBlock(
  state: EditorState,
  blocks: BlockInfo[],
  ends: number[],
  base: number,
): number | null {
  if (state.selection.ranges.length > 1) return null;
  const sel = state.selection.main;
  const a = indexAt(blocks, ends, sel.from, base);
  const b = indexAt(blocks, ends, Math.max(sel.from, sel.to - 1), base);
  if (sel.from !== sel.to && a !== b) return null; // 跨块选区
  return a;
}

/** 块文本 → 渲染 HTML 记忆化：全文重算只对变更块真正调 marked。超上限整体清空（简单防膨胀）。 */
const renderCache = new Map<string, string | null>();
const RENDER_CACHE_MAX = 500;
function cachedRender(text: string): string | null {
  if (!renderCache.has(text)) {
    if (renderCache.size >= RENDER_CACHE_MAX) renderCache.clear();
    renderCache.set(text, renderBlockHtml(text));
  }
  return renderCache.get(text) ?? null;
}

/** 纯函数：[from,to) 内的块 → 装饰集。suppress=true 时返回空（查找面板等全源码场景）。 */
export function buildBlockDecorations(
  state: EditorState,
  from: number,
  to: number,
  suppress: boolean,
): DecorationSet {
  if (suppress) return Decoration.none;
  // 多光标（Mod-d / Alt+点击）可能落在已渲染块内：全部回源码，避免盲编辑不可见文本
  if (state.selection.ranges.length > 1) return Decoration.none;
  const text = state.sliceDoc(from, to);
  const blocks = parseBlocks(text);
  if (!blocks.length) return Decoration.none;
  const ends = extendedEnds(blocks, text.length);

  // 活动域含块后空行带：光标在分隔空行上时前块保持源码，光标永落可见区
  const active = activeBlock(state, blocks, ends, from);
  if (active == null) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  for (let i = 0; i < blocks.length; i++) {
    if (i === active) continue;
    const block = blocks[i];
    const html = cachedRender(text.slice(block.from, block.to));
    if (html == null) continue;
    // 吞掉块尾换行与块间分隔空行：间距完全由 widget 边距提供，避免「空行+边距」双重间距
    const end = ends[i];
    // block: true 让 widget 整体占有行空间：行内 replace 会与该行不可见 strut
    // （编辑器字体行高）叠加导致渲染块偏高。块装饰要求区间对齐行边界：
    // 起点即块首行行首，终点为下一块行首（吞并分隔空行后的整行边界），合法。
    // StateField 供给的块装饰不受「插件禁供块装饰」限制（CM 6.43.6）。
    // 注意：widget 的 dataset 终点仍传原始 block.to（点击映射只落真实块行，不落空行）。
    builder.add(
      from + block.from,
      from + end,
      Decoration.replace({
        widget: new BlockWidget(html, from + block.from, from + block.to),
        block: true,
      }),
    );
  }
  return builder.finish();
}

/** 活动块无序列表标记的渲染形：• 与渲染态 ul > li::before 同几何（宽 2ch、强调色）。 */
export class BulletWidget extends WidgetType {
  eq(other: BulletWidget): boolean {
    return other instanceof BulletWidget; // 无状态：同类即等值，单实例语义即可
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-bullet";
    span.textContent = "•";
    return span;
  }
}

// 活动块「标记 → 渲染形」的行形识别：均要求标记后跟一个空白（裸标记无渲染形，走强调色）
const RE_LINE_HEADING = /^(\s*)(#{1,6})(\s)/; // 捕获 1=前导空格 2=# 串 3=一个空白
const RE_LINE_UL = /^(\s*)([-*+])(\s)/;
const RE_LINE_QUOTE = /^(\s*>)(\s)/; // 捕获 1 含前导空格与 >，替换须剔除前导空格

// 行首标记强调色（原 buildMarkerDecorations 语义，保留不动）
const RE_LINE_MARKER = /^(\s*)([-*+]|#{1,6}|\d{1,9}[.)]|>)(\s?)/;

/**
 * 源码态「渲染形」样式（M2c 一期）：活动块（光标所在）源码行的标记替换为渲染形，
 * 让活动块看起来已渲染——标题 "# " 零宽隐藏、"- " → •、" >" 隐藏 + 引用竖线行类、
 * 代码块行加底色；有序列表数字保留可见（下方 cm-md-marker 强调色即其渲染形）。
 * 非活动块行、有序数字、裸标记仍走 cm-md-marker 强调色（与旧两构建器一致）。
 * suppress（查找面板）/ 多光标 / 跨块选区 → 无活动块，全部退回纯强调色。
 * 单 RangeSetBuilder：严格按 from 升序零重叠——行类点（startSide=-2e8）先于
 * 同行行内 replace/mark（startSide≈5e8）入集；replace 仅覆盖标记+一个空格，不跨行。
 */
export function buildSourceStyling(
  state: EditorState,
  from: number,
  to: number,
  suppress: boolean,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = state.sliceDoc(from, to);
  const blocks = parseBlocks(text);
  const ends = extendedEnds(blocks, text.length);

  // 活动块判定与 buildBlockDecorations 同语义（共享 activeBlock）：suppress / 多光标 /
  // 跨块选区 → 无活动块，全部退回纯强调色；活动域同样含块后空行带。
  const active = (suppress ? null : activeBlock(state, blocks, ends, from)) ?? -1;

  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  let bi = 0; // 行/块双指针：行号与块区间均随文档位置递增
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    while (bi < blocks.length && from + blocks[bi].to < line.from) bi++;
    const blk =
      bi < blocks.length &&
      line.from >= from + blocks[bi].from &&
      line.from <= from + blocks[bi].to
        ? blocks[bi]
        : null;

    // 代码块行：仅底色行类。代码是逐字内容，不做任何标记隐藏/强调（含行内 "#"/"-" 注释样式）
    if (blk?.type === "code") {
      builder.add(line.from, line.from, Decoration.line({ class: "cm-md-codeline" }));
      continue;
    }

    const mh = RE_LINE_HEADING.exec(line.text);
    const mu = mh ? null : RE_LINE_UL.exec(line.text);
    const mq = mh || mu ? null : RE_LINE_QUOTE.exec(line.text);
    const isActiveLine = blk != null && blk === blocks[active];

    // 1) 行类点装饰（无条件标题类 + 活动块引用类）；点先于行内区间入集（startSide 升序合法）
    if (mh) {
      builder.add(
        line.from,
        line.from,
        Decoration.line({ class: `cm-md-h${mh[2].length}` }),
      );
    }
    if (isActiveLine && mq) {
      builder.add(line.from, line.from, Decoration.line({ class: "cm-md-quote" }));
    }

    // 2) 行内装饰：活动块的标记替换（渲染形）与强调色 mark 二选一（单集禁重叠）
    let replaced = false;
    if (isActiveLine) {
      if (mh) {
        // 标题：零宽隐藏 "# "（从前导空格之后起，宽度与渲染态标题一致）
        builder.add(line.from + mh[1].length, line.from + mh[0].length, Decoration.replace({}));
        replaced = true;
      } else if (mu) {
        // 无序列表："- " → •（BulletWidget 与渲染态 ul::before 同几何）
        builder.add(
          line.from + mu[1].length,
          line.from + mu[0].length,
          Decoration.replace({ widget: new BulletWidget() }),
        );
        replaced = true;
      } else if (mq) {
        // 引用：隐藏 "> "（剔除前导空格），文字落点由 cm-md-quote 行类补 2ch 内边距
        builder.add(line.from + mq[1].length - 1, line.from + mq[0].length, Decoration.replace({}));
        replaced = true;
      }
      // 有序列表数字 / 裸标记：无替换，落到底部强调色分支（渲染形 = 强调色数字）
    }
    if (!replaced) {
      const m = RE_LINE_MARKER.exec(line.text);
      if (m) {
        const start = line.from + m[1].length;
        // 标记 + 其后一个空格；行尾无尾随空格时钳到行尾（start<end 才入集）
        const end = Math.min(start + m[2].length + m[3].length, line.to);
        if (start < end) builder.add(start, end, Decoration.mark({ class: "cm-md-marker" }));
      }
    }
  }
  return builder.finish();
}

function suppressed(): boolean {
  const s = useStore.getState();
  return s.findOpen || s.replaceOpen;
}

/** 渲染态链接点击 → 系统浏览器打开（经 opener 插件）；渲染块点击 → 内容区比例映射光标到块内源码行列。 */
const mdLinkHandlers = EditorView.domEventHandlers({
  mousedown(event, view) {
    const anchor = (event.target as HTMLElement | null)?.closest?.("a");
    if (anchor && view.dom.contains(anchor)) {
      const href = anchor.getAttribute("href");
      if (href) {
        event.preventDefault();
        void import("@tauri-apps/plugin-opener")
          .then(({ openUrl }) => openUrl(href))
          .catch(() => {
            /* 打不开则忽略 */
          });
        return true;
      }
    }
    const host = (event.target as HTMLElement | null)?.closest?.(".cm-md-live-block") as
      | HTMLElement
      | null;
    if (!host || !view.dom.contains(host)) return false;
    // 点击渲染块：内容区比例映射到块内源码行列，光标落在点击点附近
    event.preventDefault();
    // 内容区几何（排除 widget 自身边距，避免纵向比例偏差）
    const rect = host.getBoundingClientRect();
    const first = host.firstElementChild as HTMLElement | null;
    const last = host.lastElementChild as HTMLElement | null;
    const contentTop = first ? first.getBoundingClientRect().top : rect.top;
    const contentBottom = last ? last.getBoundingClientRect().bottom : rect.bottom;
    const contentLeft = first ? first.getBoundingClientRect().left : rect.left;
    const contentRight = last ? last.getBoundingClientRect().right : rect.right;
    const contentH = Math.max(1, contentBottom - contentTop);
    const contentW = Math.max(1, contentRight - contentLeft);

    const bFrom = Number(host.dataset.mdFrom);
    const bTo = Number(host.dataset.mdTo);
    const firstLine = view.state.doc.lineAt(bFrom);
    const lastLine = view.state.doc.lineAt(bTo);
    const lineCount = lastLine.number - firstLine.number + 1;

    const fracY = Math.min(0.999, Math.max(0, (event.clientY - contentTop) / contentH));
    const targetLine = view.state.doc.line(firstLine.number + Math.floor(fracY * lineCount));
    // 横向也按比例落到行内字符（近似；CJK/等宽差异由 clamp 兜底）
    const fracX = Math.min(1, Math.max(0, (event.clientX - contentLeft) / contentW));
    const selAnchor =
      targetLine.from +
      Math.min(
        targetLine.to - targetLine.from,
        Math.round(fracX * (targetLine.to - targetLine.from)),
      );

    view.dispatch({ selection: { anchor: selAnchor } });
    return true;
  },
});

/** 全文重算块装饰（StateField 事务内同步执行）。suppress 读 zustand：查找/替换面板
 *  开合由 Editor.tsx 派发空事务到达 update → 重算（空事务也会走到这里，路径保持有效）。 */
function compute(state: EditorState): DecorationSet {
  return buildBlockDecorations(state, 0, state.doc.length, suppressed());
}

/**
 * 块装饰在事务内同步计算（全文 + 渲染记忆化）：选区/编辑事务提交时装饰即定型，
 * 方向键等纵向移动读取的高度图与选区同帧一致，不存在「选区已动、装饰后到」的空窗
 * （旧实现 ViewPlugin → queueMicrotask → effect 异步落地，快速按键时 CM 读到过期几何）。
 * CM6 要求跨行替换/块装饰经 StateField 静态供给（插件禁供），此字段即唯一供给方。
 */
const liveDecorationsField = StateField.define<DecorationSet>({
  create: (state) => compute(state),
  update: (_v, tr) => compute(tr.state),
});

/** 挂到编辑器扩展集。块装饰随每事务全文同步重算（cachedRender 记忆化控制成本）；
 *  源码形样式（buildSourceStyling）仍由 ViewPlugin 按视口供给。 */
export function mdLivePreview(): Extension[] {
  return [
    liveDecorationsField,
    EditorView.decorations.from(liveDecorationsField),
    // 原子区间防护：程序化跳转 / 拖拽选区等路径经替换块时整体跨过，不落入被吞并的隐藏区
    EditorView.atomicRanges.of((view) => view.state.field(liveDecorationsField)),
    // 源码态「渲染形」样式（M2c）：依赖选区（活动块判定），随选区事务重建；
    // 行类与行内 replace/mark 均可由 ViewPlugin 合法供给（replace 不跨行）。
    // 查找/替换面板开合只派发空事务（Editor.tsx），doc/selection/viewport 旗标皆不变，
    // 故额外跟踪 suppress 位变化强制重建（否则活动块的隐藏标记在查找态残留）。
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        private lastSuppress = false;
        constructor(view: EditorView) {
          this.lastSuppress = suppressed();
          this.decorations = buildSourceStyling(
            view.state,
            view.viewport.from,
            view.viewport.to,
            this.lastSuppress,
          );
        }
        update(u: ViewUpdate) {
          const sup = suppressed();
          if (sup === this.lastSuppress && !u.docChanged && !u.selectionSet && !u.viewportChanged)
            return;
          this.lastSuppress = sup;
          this.decorations = buildSourceStyling(
            u.state,
            u.view.viewport.from,
            u.view.viewport.to,
            sup,
          );
        }
      },
      { decorations: (v) => v.decorations },
    ),
    mdLinkHandlers,
  ];
}
