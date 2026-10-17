// 即时渲染（M1）：视口内非活动块替换为渲染 HTML；活动块（光标/选区所在）显示源码。
// 一切编辑仍是 CM6 transaction（撤销/IME 原生）。渲染失败回退源码（renderBlockHtml → null）。
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  RangeSet,
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

/** 位置所在块下标；from 闭、to 开；块尾边界与块间空隙返回 -1（相邻块保持渲染）。 */
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
  // 多光标（Mod-d / Alt+点击）可能落在已渲染块内：全部回源码，避免盲编辑不可见文本
  if (state.selection.ranges.length > 1) return Decoration.none;
  const text = state.sliceDoc(from, to);
  const blocks = parseBlocks(text);
  if (!blocks.length) return Decoration.none;

  const sel = state.selection.main;
  const a = indexAt(blocks, sel.from, from);
  const b = indexAt(blocks, Math.max(sel.from, sel.to - 1), from);
  const crossBlock = sel.from !== sel.to && a !== b;

  const builder = new RangeSetBuilder<Decoration>();
  for (let i = 0; i < blocks.length; i++) {
    if (crossBlock || i === a || i === b) continue;
    const block = blocks[i];
    const html = renderBlockHtml(text.slice(block.from, block.to));
    if (html == null) continue;
    // 吞掉块尾换行与块间分隔空行：间距完全由 widget 边距提供，避免「空行+边距」双重间距
    const end = i + 1 < blocks.length ? blocks[i + 1].from : text.length;
    // block: true 让 widget 整体占有行空间：行内 replace 会与该行不可见 strut
    // （编辑器字体行高）叠加导致渲染块偏高。块装饰要求区间对齐行边界：
    // 起点即块首行行首，终点为下一块行首（吞并分隔空行后的整行边界），合法。
    // StateField 供给的块装饰不受「插件禁供块装饰」限制（CM 6.43.6）。
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

const RE_LINE_HEADING = /^ {0,3}(#{1,6})(?:\s|$)/;

/** 视口内标题行 → WYSIWYG 行样式（几何与渲染态对齐，减少块切换跳动）。 */
export function buildHeadingLineDecorations(
  state: EditorState,
  from: number,
  to: number,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    const m = RE_LINE_HEADING.exec(line.text);
    if (!m) continue;
    builder.add(line.from, line.from, Decoration.line({ class: `cm-md-h${m[1].length}` }));
  }
  return builder.finish();
}

const RE_LINE_MARKER = /^(\s*)([-*+]|#{1,6}|\d{1,9}[.)]|>)(\s?)/;

/** 可见行首标记（# / - / 1. / >）上渲染强调色：源码态与渲染态颜色连续，翻转仅剩字符形差异。 */
export function buildMarkerDecorations(
  state: EditorState,
  from: number,
  to: number,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    const m = RE_LINE_MARKER.exec(line.text);
    if (!m) continue;
    const start = line.from + m[1].length;
    // 标记 + 其后一个空格；行尾无尾随空格时钳到行尾（start<end 才入集）
    const end = Math.min(start + m[2].length + m[3].length, line.to);
    if (start < end) builder.add(start, end, Decoration.mark({ class: "cm-md-marker" }));
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

/** 视口装饰集的搬运通道：ViewPlugin 算出集后经此效果写入下方 StateField。 */
const setLiveDecorations = StateEffect.define<DecorationSet>();

/**
 * 装饰必须经 StateField 静态供给：CM6 禁止 ViewPlugin 提供跨行替换/块装饰
 * （RangeError: Decorations that replace line breaks may not be specified via plugins）。
 * 效果到达取效果值；无效果而文档已变时映射旧集，保证两次事务之间不持有过期区间。
 */
const liveDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value;
    let has = false;
    for (const e of tr.effects) {
      if (e.is(setLiveDecorations)) {
        next = e.value;
        has = true;
      }
    }
    if (!has && tr.docChanged) return value.map(tr.changes);
    return next;
  },
});

/** 挂到编辑器扩展集。ViewPlugin 负责视口/抑制态检测并经 effect 派发（保留视口窗口化）。 */
export function mdLivePreview(): Extension[] {
  return [
    liveDecorationsField,
    EditorView.decorations.from(liveDecorationsField),
    ViewPlugin.fromClass(
      class {
        /** 上次派发的装饰集；eq 相同则不再派发，否则派发自身又触发 update 会死循环。 */
        private last = Decoration.none;
        constructor(view: EditorView) {
          this.sync(view);
        }
        update(u: ViewUpdate) {
          this.sync(u.view);
        }
        /**
         * 重算视口装饰并派发。不能同步 view.dispatch：CM 6.43.6 在更新进行中调用
         * update 会抛错，且该异常会被 CM 捕获后直接击杀本插件；故经微任务在
         * 更新周期结束后派发（CM 自身对延迟派发亦用同款微任务模式）。
         */
        private sync(view: EditorView) {
          const set = buildBlockDecorations(
            view.state,
            view.viewport.from,
            view.viewport.to,
            suppressed(),
          );
          // RangeSet 无实例 eq，用静态 RangeSet.eq 全区间比较（widget 经 BlockWidget.eq）
          if (RangeSet.eq([this.last], [set])) return;
          this.last = set;
          queueMicrotask(() => {
            view.dispatch({ effects: setLiveDecorations.of(set) });
          });
        }
      },
    ),
    // 源码态标题行样式：行装饰可由 ViewPlugin 合法供给（多行替换禁令不适用于行装饰）；
    // 不依赖选区，仅随文档/视口变化重建。
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildHeadingLineDecorations(
            view.state,
            view.viewport.from,
            view.viewport.to,
          );
        }
        update(u: ViewUpdate) {
          if (!u.docChanged && !u.viewportChanged) return;
          this.decorations = buildHeadingLineDecorations(
            u.state,
            u.view.viewport.from,
            u.view.viewport.to,
          );
        }
      },
      { decorations: (v) => v.decorations },
    ),
    // 源码态行首标记强调色：mark 装饰不跨行，ViewPlugin 合法供给；
    // 与标题行装饰分属两个插件（RangeSetBuilder 单集内禁止重叠区间，分插件最简），
    // 同样不依赖选区，仅随文档/视口变化重建。
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildMarkerDecorations(
            view.state,
            view.viewport.from,
            view.viewport.to,
          );
        }
        update(u: ViewUpdate) {
          if (!u.docChanged && !u.viewportChanged) return;
          this.decorations = buildMarkerDecorations(
            u.state,
            u.view.viewport.from,
            u.view.viewport.to,
          );
        }
      },
      { decorations: (v) => v.decorations },
    ),
    mdLinkHandlers,
  ];
}
