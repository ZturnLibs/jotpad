// @vitest-environment jsdom
// 真实 EditorView 挂载冒烟测试：mdLivePreview 的装饰经 StateField 静态供给，
// CM6 禁止 ViewPlugin 直接提供跨行替换装饰，旧实现挂载即抛 RangeError（Task 6 缺的回归覆盖）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mdLivePreview } from "@/lib/md/decorations";

// suppress 读取真实 useStore（findOpen/replaceOpen 默认 false，不影响断言），无需 mock。

/** 效果经微任务派发，冲刷一个宏任务让派发事务落地并渲染完成。 */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

const crashes: string[] = [];

afterEach(() => {
  // CM 的 logException 只 console.error 不抛出（插件被击杀时测试不会红），
  // 必须显式收集才能守住「挂载不抛错」这条回归线。
  expect(crashes).toEqual([]);
});

describe("mdLivePreview 挂载", () => {
  it("真实 EditorView 挂载不抛错且渲染出块", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      crashes.push(args.map(String).join(" "));
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        // 列表块跨行：其替换装饰覆盖换行符，正是旧 ViewPlugin 实现抛 RangeError 的触发条件
        doc: "# 标题\n\n- 列表\n- 项\n\n段落",
        extensions: [mdLivePreview()],
      }),
      parent: host,
    });
    try {
      await flush();
      // jsdom 无布局，但初始视口覆盖全 doc，widget DOM 在派发事务的更新里同步生成，可直接断言 DOM
      expect(host.querySelectorAll(".cm-md-live-block").length).toBe(2); // 光标在标题：列表（跨行）+ 段落被渲染
      // 光标移动（选区事务）→ 装饰重算回源码/渲染切换，不得抛错
      view.dispatch({ selection: { anchor: 7 } }); // 光标进列表 → 列表回源码，标题+段落渲染
      await flush();
      expect(host.querySelectorAll(".cm-md-live-block").length).toBe(2);
      // 文档编辑（插入文本）→ 位置映射 + 重算，不得抛错且块仍渲染
      view.dispatch({ changes: { from: 0, insert: "！" } });
      await flush();
      expect(host.querySelectorAll(".cm-md-live-block").length).toBeGreaterThanOrEqual(1);
    } finally {
      errSpy.mockRestore();
      view.destroy();
      host.remove();
    }
  });
});
