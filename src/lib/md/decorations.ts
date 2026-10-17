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
    if (crossBlock || i === a || i === b) continue;
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
    mdLinkHandlers,
  ];
}
