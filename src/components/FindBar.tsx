import { useEffect, useRef, useState } from "react";
import { findNext, findPrevious, replaceAll, replaceNext } from "@codemirror/search";
import { useStore } from "@/store/useStore";
import { useT } from "@/lib/i18n";
import { getEditorView, subscribeEditor } from "@/lib/editorRef";
import { applySearchQuery, currentMatchIndex, matchCount } from "@/lib/search";
import { Icon } from "./icons";

export function FindBar() {
  const findOpen = useStore((s) => s.findOpen);
  const replaceOpen = useStore((s) => s.replaceOpen);
  const setFindOpen = useStore((s) => s.setFindOpen);
  const setReplaceOpen = useStore((s) => s.setReplaceOpen);
  const t = useT();

  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const doApply = () => {
    const v = getEditorView();
    if (!v) return;
    applySearchQuery(v, { search, caseSensitive, regexp, replace });
    setCount(matchCount(v));
    setIndex(currentMatchIndex(v));
  };

  // When opening, prefill with current selection + focus + run search.
  useEffect(() => {
    if (findOpen) {
      const v = getEditorView();
      if (v) {
        const { from, to } = v.state.selection.main;
        if (from !== to) {
          const sel = v.state.sliceDoc(from, to);
          if (sel.length < 500 && !sel.includes("\n")) setSearch(sel);
        }
      }
      requestAnimationFrame(() => inputRef.current?.select());
      doApply();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, replaceOpen]);

  // Re-apply when query options change.
  useEffect(() => {
    doApply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, caseSensitive, regexp, replace]);

  // Recompute index on cursor movement.
  useEffect(() => {
    return subscribeEditor(() => {
      const v = getEditorView();
      if (v && search) {
        setIndex(currentMatchIndex(v));
        setCount(matchCount(v));
      }
    });
  }, [search]);

  if (!findOpen) return null;

  const next = () => {
    const v = getEditorView();
    if (v) {
      findNext(v);
      v.focus();
    }
  };
  const prev = () => {
    const v = getEditorView();
    if (v) {
      findPrevious(v);
      v.focus();
    }
  };
  const replaceOne = () => {
    const v = getEditorView();
    if (v) {
      replaceNext(v);
      v.focus();
      doApply();
    }
  };
  const replaceAllFn = () => {
    const v = getEditorView();
    if (!v) return;
    replaceAll(v);
    v.focus();
    doApply();
  };
  const close = () => {
    const v = getEditorView();
    if (v) applySearchQuery(v, { search: "", caseSensitive, regexp, replace: "" });
    setFindOpen(false);
    setReplaceOpen(false);
    v?.focus();
  };

  const countText = !search
    ? ""
    : count === 0
      ? t("find.noMatch")
      : index > 0
        ? t("find.matchCount", { i: index, n: count })
        : t("find.matchCountOnly", { n: count });

  const labeledBtn = (text: string, title: string, fn: () => void, disabled: boolean) => (
    <button
      className="find-icon-btn"
      onClick={fn}
      title={title}
      disabled={disabled}
      style={{ width: "auto", padding: "0 10px", fontSize: 12 }}
    >
      {text}
    </button>
  );

  return (
    <div className="findbar">
      <div className="findbar-row">
        <div className="find-input-wrap">
          <input
            ref={inputRef}
            value={search}
            placeholder={t("find.placeholder")}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.shiftKey ? prev() : next();
              } else if (e.key === "Escape") {
                close();
              }
            }}
          />
          <span className="find-count">{countText}</span>
        </div>
        <button
          className={"find-icon-btn" + (caseSensitive ? " active" : "")}
          onClick={() => setCaseSensitive((v) => !v)}
          title={t("find.caseSensitive")}
          aria-pressed={caseSensitive}
          style={{ fontWeight: 700 }}
        >
          Aa
        </button>
        <button
          className={"find-icon-btn" + (regexp ? " active" : "")}
          onClick={() => setRegexp((v) => !v)}
          title={t("find.regexp")}
          aria-pressed={regexp}
          style={{ fontFamily: "monospace" }}
        >
          .*
        </button>
        <button className="find-icon-btn" onClick={prev} title={t("find.prev")} disabled={!search}>
          <Icon name="chevronUp" size={16} />
        </button>
        <button className="find-icon-btn" onClick={next} title={t("find.next")} disabled={!search}>
          <Icon name="chevronDown" size={16} />
        </button>
        <button className="find-icon-btn" onClick={close} title={t("dialog.cancel")}>
          <Icon name="close" size={16} />
        </button>
      </div>

      {replaceOpen && (
        <div className="findbar-row">
          <div className="find-input-wrap">
            <input
              value={replace}
              placeholder={t("find.replacePlaceholder")}
              onChange={(e) => setReplace(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
              }}
            />
          </div>
          {labeledBtn(t("find.replaceOne"), t("find.replaceOne"), replaceOne, !search)}
          {labeledBtn(t("find.replaceAll"), t("find.replaceAll"), replaceAllFn, !search)}
        </div>
      )}
    </div>
  );
}
