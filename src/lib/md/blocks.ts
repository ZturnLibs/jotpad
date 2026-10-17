// 块级扫描：把 Markdown 文本切成行对齐的渲染块（即时渲染按视口调用）。
// M1 简化（设计文档已记）：空行结束可聚合块（宽松列表拆多块）；围栏闭合按任意围栏线；
// 4 空格缩进代码块不识别（按段落）；表格行按段落聚合（marked 会渲染表格，M2a 正式化）。

export type BlockType = "heading" | "list" | "quote" | "code" | "hr" | "paragraph";

export interface BlockInfo {
  /** 块首行行首偏移（相对传入文本） */
  from: number;
  /** 块尾行行尾偏移（不含换行符） */
  to: number;
  type: BlockType;
}

const RE_HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const RE_HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const RE_LIST = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const RE_QUOTE = /^ {0,3}>/;
const RE_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RE_SETEXT = /^ {0,3}(?:=+|-{2,})\s*$/;

function classifyLine(text: string): BlockType {
  if (RE_HEADING.test(text)) return "heading";
  if (RE_FENCE.test(text)) return "code";
  if (RE_HR.test(text)) return "hr";
  if (RE_LIST.test(text)) return "list";
  if (RE_QUOTE.test(text)) return "quote";
  return "paragraph";
}

export function parseBlocks(text: string): BlockInfo[] {
  const blocks: BlockInfo[] = [];
  const lines: { text: string; from: number; to: number }[] = [];
  let pos = 0;
  for (const raw of text.split("\n")) {
    lines.push({ text: raw, from: pos, to: pos + raw.length });
    pos += raw.length + 1;
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.text.trim()) {
      i++;
      continue;
    }

    // 围栏代码：吞掉到闭合围栏或文末（跨空行）
    if (RE_FENCE.test(line.text)) {
      let j = i + 1;
      while (j < lines.length && !RE_FENCE.test(lines[j].text)) j++;
      const end = Math.min(j, lines.length - 1);
      blocks.push({ from: line.from, to: lines[end].to, type: "code" });
      i = end + 1;
      continue;
    }

    const type = classifyLine(line.text);
    if (type === "heading" || type === "hr") {
      blocks.push({ from: line.from, to: line.to, type });
      i++;
      continue;
    }

    // 可聚合块（list / quote / paragraph）：同类型连续行合并
    let j = i + 1;
    let setext = false;
    while (j < lines.length) {
      const next = lines[j];
      if (type === "paragraph" && RE_SETEXT.test(next.text)) {
        setext = true;
        break;
      }
      if (!next.text.trim()) break;
      if (classifyLine(next.text) !== type) break;
      j++;
    }
    const end = setext ? j : j - 1;
    blocks.push({ from: line.from, to: lines[end].to, type: setext ? "heading" : type });
    i = end + 1;
  }
  return blocks;
}
