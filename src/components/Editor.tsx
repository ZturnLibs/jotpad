import { useEffect, useRef, type CSSProperties } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { findNext, findPrevious, search, selectSelectionMatches } from "@codemirror/search";
import { useStore } from "@/store/useStore";
import { emitEditorInfo, setEditorView, viewInfo } from "@/lib/editorRef";
import { cjkWordSelection } from "@/lib/cjkSelection";

function spellcheckExt(on: boolean) {
  return EditorView.contentAttributes.of({
    spellcheck: on ? "true" : "false",
  });
}

/** 实验特性 markdown：仅 .md/.markdown/.mdx 文件启用。 */
function markdownEnabled(
  settings: { experimental: Record<string, boolean> },
  filePath: string | null,
): boolean {
  if (!settings.experimental?.markdown || !filePath) return false;
  return /\.(md|markdown|mdx)$/i.test(filePath);
}

/** md 嵌套代码块语言高亮（按需懒加载）。 */
function markdownLang(): ReturnType<typeof markdown> {
  return markdown({
    base: markdownLanguage,
    codeLanguages: languages,
  });
}

/** 光标选区包裹 Markdown 标记（粗体/斜体/行内代码）。返回 true 表示已处理。 */
function wrapSelection(view: import("@codemirror/view").EditorView, mark: string): boolean {
  const sel = view.state.selection.main;
  const selected = view.state.sliceDoc(sel.from, sel.to);
  const already =
    selected.startsWith(mark) && selected.endsWith(mark) && selected.length >= mark.length * 2;
  view.dispatch({
    changes: already
      ? { from: sel.from, to: sel.to, insert: selected.slice(mark.length, -mark.length) }
      : { from: sel.from, to: sel.to, insert: mark + selected + mark },
    selection: already
      ? { anchor: sel.from + mark.length, head: sel.to - mark.length }
      : { anchor: sel.from + mark.length, head: sel.to + mark.length },
  });
  view.focus();
  return true;
}

export function Editor() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wrapCompartment = useRef(new Compartment());
  const guttersCompartment = useRef(new Compartment());
  const spellCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const langCompartment = useRef(new Compartment());
  const loadingRef = useRef(false);
  const prevTabIdRef = useRef<string | null>(null);

  const activeTabId = useStore((s) => s.activeTabId);
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const settings = useStore((s) => s.settings);

  useEffect(() => {
    if (!hostRef.current) return;
    const store = useStore.getState();
    const initial = store.activeTab()?.content ?? "";
    const showLines = store.settings.showLineNumbers;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          readOnlyCompartment.current.of(
            store.activeTab()?.readOnly ? EditorState.readOnly.of(true) : [],
          ),
          langCompartment.current.of(
            markdownEnabled(store.settings, store.activeTab()?.filePath ?? null)
              ? markdownLang()
              : [],
          ),
          wrapCompartment.current.of(
            store.settings.wordWrap ? EditorView.lineWrapping : [],
          ),
          guttersCompartment.current.of(
            showLines ? [lineNumbers(), highlightActiveLineGutter()] : [],
          ),
          spellCompartment.current.of(spellcheckExt(!!store.settings.spellCheck)),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            { key: "Mod-d", run: selectSelectionMatches },
            { key: "F3", run: findNext, shift: findPrevious },
            {
              // 实验特性 markdown：Cmd/Ctrl+B 粗体（仅 md 文件生效）
              key: "Mod-b",
              run: (v) =>
                markdownEnabled(useStore.getState().settings, useStore.getState().activeTab()?.filePath ?? null)
                  ? wrapSelection(v, "**")
                  : false,
            },
            {
              // 实验特性 markdown：Cmd/Ctrl+I 斜体（仅 md 文件生效）
              key: "Mod-i",
              run: (v) =>
                markdownEnabled(useStore.getState().settings, useStore.getState().activeTab()?.filePath ?? null)
                  ? wrapSelection(v, "*")
                  : false,
            },
          ]),
          highlightActiveLine(),
          search(),
          rectangularSelection(),
          crosshairCursor(),
          cjkWordSelection,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !loadingRef.current) {
              const id = useStore.getState().activeTabId;
              if (id) useStore.getState().setContent(id, u.state.doc.toString());
            }
            if (u.docChanged || u.selectionSet || u.viewportChanged) {
              emitEditorInfo(viewInfo(u.view));
            }
            // 滚动百分比上报（预览同步用）
            const sc = u.view.scrollDOM;
            const max = sc.scrollHeight - sc.clientHeight;
            (window as unknown as { __mdEditorScroll?: number | undefined }).__mdEditorScroll =
              max > 0 ? sc.scrollTop / max : undefined;
          }),
        ],
      }),
    });
    viewRef.current = view;
    setEditorView(view);
    return () => {
      view.destroy();
      setEditorView(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const prevId = prevTabIdRef.current;
    if (prevId && prevId !== activeTabId) {
      const sel = view.state.selection.main;
      useStore.getState().updateTab(prevId, {
        selection: { from: sel.from, to: sel.to },
        scrollTop: view.scrollDOM.scrollTop,
      });
    }
    prevTabIdRef.current = activeTabId;

    if (!tab) return;

    loadingRef.current = true;
    const current = view.state.doc.toString();
    if (tab.content !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: tab.content },
      });
    }
    const sel = tab.selection;
    view.dispatch({
      selection: sel ? { anchor: sel.from, head: sel.to } : { anchor: 0 },
      scrollIntoView: false,
    });
    loadingRef.current = false;

    if (tab.scrollTop) {
      const top = tab.scrollTop;
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = top;
      });
    }
    emitEditorInfo(viewInfo(view));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(
        settings.wordWrap ? EditorView.lineWrapping : [],
      ),
    });
  }, [settings.wordWrap]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: guttersCompartment.current.reconfigure(
        settings.showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [],
      ),
    });
  }, [settings.showLineNumbers]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: spellCompartment.current.reconfigure(spellcheckExt(!!settings.spellCheck)),
    });
  }, [settings.spellCheck]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        tab?.readOnly ? EditorState.readOnly.of(true) : [],
      ),
    });
  }, [tab?.readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langCompartment.current.reconfigure(
        markdownEnabled(settings, tab?.filePath ?? null) ? markdownLang() : [],
      ),
    });
  }, [settings.experimental, tab?.filePath, settings]);

  const fontSize = settings.fontSize * (settings.zoom / 100);

  const styleVars = {
    "--ef-size": `${fontSize}px`,
    "--ef-family": settings.fontFamily,
  } as CSSProperties;

  return <div className="editor-wrap" ref={hostRef} style={styleVars} />;
}
