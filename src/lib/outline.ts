// 文档大纲（TOC）：从 Markdown 文本解析标题树。设计详见 docs/design-outline.md。

export interface OutlineItem {
  /** 标题层级 1-6（# 数）。 */
  level: number;
  /** 标题文本（已 trim，去掉尾部 # 序列）。 */
  text: string;
  /** 标题行起始在全文中的偏移（跳转选区用）。 */
  from: number;
  /** 1-based 行号（展示用）。 */
  line: number;
}

const ATX_RE = /^(#{1,6})[ \t]+(\S.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^[ \t]{0,3}(```|~~~)/;

/** 解析 ATX 标题；代码围栏（``` / ~~~）内部不解析。 */
export function parseOutline(text: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  let inFence = false;
  let fenceMark = "";
  let offset = 0; // 当前行起始偏移
  let line = 0;
  for (const raw of text.split("\n")) {
    line++;
    const body = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const fence = FENCE_RE.exec(body);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMark = fence[1]!;
      } else if (fence[1] === fenceMark) {
        inFence = false;
        fenceMark = "";
      }
      offset += raw.length + 1;
      continue;
    }
    if (!inFence) {
      const m = ATX_RE.exec(body);
      if (m) {
        out.push({
          level: m[1]!.length,
          text: m[2]!.trim(),
          from: offset,
          line,
        });
      }
    }
    offset += raw.length + 1;
  }
  return out;
}
