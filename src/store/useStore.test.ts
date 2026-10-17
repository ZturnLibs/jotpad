// Store 行为回归：状态持久化时机、外部变更检测、reload 对未保存内容的保护。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { AppState, TabState } from "@/types";
import { DEFAULT_SETTINGS } from "@/types";
import * as api from "@/lib/backend";
import type { ReadResult } from "@/lib/backend";
import { isProgrammaticDocChange, setEditorView } from "@/lib/editorRef";

const { destroyMock, recordLocalHistoryMock } = vi.hoisted(() => ({
  destroyMock: vi.fn(),
  recordLocalHistoryMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ destroy: destroyMock }),
}));

vi.mock("@/lib/backend", () => ({
  basename: (p: string) => p.split("/").pop() ?? p,
  dirname: (p: string) => p.slice(0, p.lastIndexOf("/")) || "/",
  joinPath: (dir: string, name: string) => `${dir}/${name}`,
  readState: vi.fn(),
  writeState: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  fileMtime: vi.fn(),
  nativeMessage: vi.fn(),
  voicePackStatus: vi.fn(),
  resolveDefaultSaveDirectory: vi.fn(),
  pickOpenFile: vi.fn(),
  pickSaveFile: vi.fn(),
  nativeConfirm: vi.fn(),
  renameFile: vi.fn(),
  deleteFile: vi.fn(),
  historyPut: vi.fn(),
  listDirFiles: vi.fn(),
  clipboardWriteText: vi.fn(),
  getSystemAccent: vi.fn(),
}));

vi.mock("@/lib/history", () => ({
  recordLocalHistory: recordLocalHistoryMock,
}));

vi.mock("@/lib/updater", () => ({
  UPDATE_TOAST_ID: "app-update",
  checkForAppUpdate: vi.fn(),
  discardPendingUpdate: vi.fn(),
  downloadPending: vi.fn(),
  getCanInstallInApp: vi.fn(),
  getPendingUpdateVersion: vi.fn(() => null),
  installPending: vi.fn(),
  openReleasesPage: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  showToast: vi.fn(),
  dismissToast: vi.fn(),
  updateToast: vi.fn(),
}));

import { useStore } from "@/store/useStore";

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: "a",
    title: "x.txt",
    filePath: "/tmp/x.txt",
    content: "same",
    encoding: "UTF-8",
    hasBom: false,
    lineEnding: "LF",
    dirty: false,
    readOnly: false,
    size: 4,
    diskMtimeMs: 1,
    selection: null,
    scrollTop: 0,
    ...overrides,
  };
}

function makeRead(text: string, mtimeMs: number): ReadResult {
  return {
    text,
    encoding: "UTF-8",
    has_bom: false,
    line_ending: "LF",
    size: text.length,
    mtime_ms: mtimeMs,
  };
}

function lastWriteState(): AppState {
  const calls = vi.mocked(api.writeState).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllTimers();
  // 虚拟时钟前进，让上个测试留下的「自己刚写入」宽限期（4s）失效
  vi.advanceTimersByTime(5000);
  vi.resetAllMocks();
  destroyMock.mockResolvedValue(undefined);
  vi.mocked(api.writeState).mockResolvedValue(undefined);
  vi.mocked(api.writeFile).mockResolvedValue(undefined);
  vi.mocked(api.voicePackStatus).mockRejectedValue(new Error("no voice in tests"));
  useStore.setState({
    ready: true,
    tabs: [],
    activeTabId: null,
    settings: DEFAULT_SETTINGS,
    recentFiles: [],
    pinnedPaths: [],
    sessions: [],
    confirm: null,
    reloadPrompt: null,
  });
});

describe("保存与持久化", () => {
  it("saveTab 成功后立即把最新 mtime/内容写入 state", async () => {
    const tab = makeTab({ content: "hello", dirty: true, diskMtimeMs: 111, size: 5 });
    useStore.setState({ tabs: [tab], activeTabId: "a" });
    vi.mocked(api.fileMtime).mockResolvedValue(222);

    const ok = await useStore.getState().saveTab("a");

    expect(ok).toBe(true);
    expect(api.writeState).toHaveBeenCalled();
    const saved = lastWriteState();
    expect(saved.tabs[0].dirty).toBe(false);
    expect(saved.tabs[0].diskMtimeMs).toBe(222);
    expect(saved.tabs[0].content).toBe("hello");
  });

  it("退出时选「保存」：整个会话保留在 state 中（不再只剩空白标签）", async () => {
    const a = makeTab({ id: "a", filePath: "/tmp/a.txt", content: "A", dirty: true });
    const b = makeTab({ id: "b", filePath: "/tmp/b.txt", content: "B", diskMtimeMs: 2 });
    useStore.setState({
      tabs: [a, b],
      activeTabId: "a",
      confirm: { kind: "exit", tabIds: ["a"] },
    });
    vi.mocked(api.fileMtime).mockResolvedValue(999);

    await useStore.getState().resolveConfirm("save");

    expect(destroyMock).toHaveBeenCalledTimes(1);
    const saved = lastWriteState();
    expect(saved.tabs).toHaveLength(2);
    expect(saved.tabs.find((t) => t.id === "a")?.dirty).toBe(false);
    expect(saved.tabs.find((t) => t.id === "a")?.diskMtimeMs).toBe(999);
    expect(saved.tabs.find((t) => t.id === "b")?.dirty).toBe(false);
  });

  it("编辑后防抖落盘草稿（dirty 内容进入 state）", async () => {
    useStore.setState({ tabs: [makeTab()], activeTabId: "a" });

    useStore.getState().setContent("a", "typing");
    await vi.advanceTimersByTimeAsync(10);
    expect(api.writeState).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2100);
    expect(api.writeState).toHaveBeenCalled();
    const saved = lastWriteState();
    expect(saved.tabs[0].content).toBe("typing");
    expect(saved.tabs[0].dirty).toBe(true);
  });
});

describe("外部变更检测", () => {
  it("mtime 变化但内容一致：静默刷新基准，不弹窗", async () => {
    useStore.setState({ tabs: [makeTab({ content: "same", diskMtimeMs: 1 })], activeTabId: "a" });
    vi.mocked(api.fileMtime).mockResolvedValue(2);
    vi.mocked(api.readFile).mockResolvedValue(makeRead("same", 2));

    await useStore.getState().checkExternalChanges();

    expect(useStore.getState().reloadPrompt).toBeNull();
    expect(useStore.getState().tabs[0].diskMtimeMs).toBe(2);
  });

  it("mtime 与内容都变了：弹出重新加载确认", async () => {
    // 用独立路径：避免上个测试 doWrite 留下的「自己刚写入」宽限期把本次判定吞掉
    const tab = makeTab({ filePath: "/tmp/y.txt", content: "same", diskMtimeMs: 1 });
    useStore.setState({ tabs: [tab], activeTabId: "a" });
    vi.mocked(api.fileMtime).mockResolvedValue(2);
    vi.mocked(api.readFile).mockResolvedValue(makeRead("diff", 2));

    await useStore.getState().checkExternalChanges();

    expect(useStore.getState().reloadPrompt).toEqual({ tabId: "a", path: "/tmp/y.txt" });
  });

  it("init 恢复：mtime 不一致但内容相同则静默刷新基准，pinnedPaths 不丢失", async () => {
    const persisted: AppState = {
      version: 2,
      activeTabId: "a",
      settings: DEFAULT_SETTINGS,
      recentFiles: [],
      pinnedPaths: ["/tmp/pin"],
      sessions: [],
      tabs: [makeTab({ content: "same", diskMtimeMs: 1 })],
    };
    vi.mocked(api.readState).mockResolvedValue(persisted);
    vi.mocked(api.fileMtime).mockResolvedValue(3);
    vi.mocked(api.readFile).mockResolvedValue(makeRead("same", 3));

    await useStore.getState().init();

    expect(useStore.getState().tabs[0].diskMtimeMs).toBe(3);
    expect(useStore.getState().reloadPrompt).toBeNull();
    expect(useStore.getState().pinnedPaths).toEqual(["/tmp/pin"]);
  });

  it("init 恢复：内容不同则保留快照，交给变更检测提示", async () => {
    const persisted: AppState = {
      version: 2,
      activeTabId: "a",
      settings: DEFAULT_SETTINGS,
      recentFiles: [],
      pinnedPaths: [],
      sessions: [],
      tabs: [makeTab({ content: "same", diskMtimeMs: 1 })],
    };
    vi.mocked(api.readState).mockResolvedValue(persisted);
    vi.mocked(api.fileMtime).mockResolvedValue(3);
    vi.mocked(api.readFile).mockResolvedValue(makeRead("changed", 3));

    await useStore.getState().init();

    expect(useStore.getState().tabs[0].diskMtimeMs).toBe(1);
    expect(useStore.getState().tabs[0].content).toBe("same");
  });
});

describe("md 视图设置归一化", () => {
  it("持久化的 mdViewMode=source 生效，非法值回落 live", async () => {
    vi.mocked(api.readState).mockResolvedValue({
      version: 2,
      activeTabId: "a",
      settings: { ...DEFAULT_SETTINGS, startupMode: "restore", mdViewMode: "source" },
      recentFiles: [],
      pinnedPaths: [],
      sessions: [],
      tabs: [makeTab()],
    } as AppState);
    await useStore.getState().init();
    expect(useStore.getState().settings.mdViewMode).toBe("source");

    vi.mocked(api.readState).mockResolvedValue({
      version: 2,
      activeTabId: "a",
      settings: { ...DEFAULT_SETTINGS, startupMode: "restore", mdViewMode: "bogus" },
      recentFiles: [],
      pinnedPaths: [],
      sessions: [],
      tabs: [makeTab()],
    } as unknown as AppState);
    await useStore.getState().init();
    expect(useStore.getState().settings.mdViewMode).toBe("live");
  });
});

describe("重新加载对未保存内容的保护", () => {
  it("reload 覆盖 dirty 内容前先快照到本地历史", async () => {
    useStore.setState({
      tabs: [makeTab({ content: "draft", dirty: true, diskMtimeMs: 4 })],
      activeTabId: "a",
      reloadPrompt: { tabId: "a", path: "/tmp/x.txt" },
    });
    vi.mocked(api.readFile).mockResolvedValue(makeRead("disk", 5));

    await useStore.getState().resolveReloadPrompt("reload");

    expect(recordLocalHistoryMock).toHaveBeenCalledWith("/tmp/x.txt", "draft", "auto");
    const tab = useStore.getState().tabs[0];
    expect(tab.content).toBe("disk");
    expect(tab.dirty).toBe(false);
    expect(tab.diskMtimeMs).toBe(5);
  });

  it("reload 干净标签时不产生历史快照", async () => {
    useStore.setState({
      tabs: [makeTab({ dirty: false, diskMtimeMs: 4 })],
      activeTabId: "a",
      reloadPrompt: { tabId: "a", path: "/tmp/x.txt" },
    });
    vi.mocked(api.readFile).mockResolvedValue(makeRead("disk", 5));

    await useStore.getState().resolveReloadPrompt("reload");

    expect(recordLocalHistoryMock).not.toHaveBeenCalled();
  });

  it("applyDocToEditor 的程序化替换期间标记生效，且结束后复位", async () => {
    let insideDispatch: boolean | null = null;
    const fakeView = {
      state: { doc: { toString: () => "old" } },
      dispatch: () => {
        insideDispatch = isProgrammaticDocChange();
      },
    };
    setEditorView(fakeView as unknown as EditorView);
    useStore.setState({
      tabs: [makeTab({ content: "old", dirty: false, diskMtimeMs: 4 })],
      activeTabId: "a",
      reloadPrompt: { tabId: "a", path: "/tmp/x.txt" },
    });
    vi.mocked(api.readFile).mockResolvedValue(makeRead("new", 7));

    try {
      await useStore.getState().resolveReloadPrompt("reload");

      expect(insideDispatch).toBe(true);
      expect(isProgrammaticDocChange()).toBe(false);
    } finally {
      setEditorView(null);
    }
  });
});
