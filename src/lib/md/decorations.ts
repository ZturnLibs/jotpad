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
import { type EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
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
