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
import { findNext, findPrevious, search, selectSelectionMatches } from "@codemirror/search";
import { useStore } from "@/store/useStore";
import { emitEditorInfo, setEditorView, viewInfo } from "@/lib/editorRef";
import { cjkWordSelection } from "@/lib/cjkSelection";

function spellcheckExt(on: boolean) {
  return EditorView.contentAttributes.of({
    spellcheck: on ? "true" : "false",
  });
}

export function Editor() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wrapCompartment = useRef(new Compartment());
  const guttersCompartment = useRef(new Compartment());
  const spellCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
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

  const fontSize = settings.fontSize * (settings.zoom / 100);

  const styleVars = {
    "--ef-size": `${fontSize}px`,
    "--ef-family": settings.fontFamily,
  } as CSSProperties;

  return <div className="editor-wrap" ref={hostRef} style={styleVars} />;
}
