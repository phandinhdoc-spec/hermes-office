/** Word lint rules that need no Office.js (tests: addin/tests/word_logic.test.ts). */

export interface ParaInfo {
  index: number;
  text: string;
  style: string; // style name as Word reports it ("Heading 1", "Normal", "Tiêu đề 1" ...)
  isList?: boolean;
  alignment?: string;
  fontName?: string | null;
  fontSize?: number | null;
  bold?: boolean | null;
  inTable?: boolean;
}

export interface WordIssue {
  rule: string;
  severity: "error" | "warn" | "info";
  paragraph?: number;
  message: string;
  fix?: Record<string, unknown>;
}

/** Heading level from a (possibly Vietnamese) style name; 0 for none; 10 for Title. */
export function headingLevel(style: string): number {
  const m = /^(?:heading|tiêu đề|tieu de)\s*(\d)$/i.exec((style || "").trim());
  if (m) return Number(m[1]);
  if (/^(title|tiêu đề chính|tựa đề)$/i.test((style || "").trim())) return 10;
  return 0;
}

const isNormal = (s: string) => /^(normal|bình thường|binh thuong|body text|nội dung)$/i.test((s || "").trim()) || !s;
const MANUAL_NUMBER = /^\s*(\d{1,2}[.)]|[a-z][.)]|[-•*–])\s+\S/;

function mode<T>(xs: T[]): T | undefined {
  const c = new Map<T, number>();
  xs.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function lintParagraphs(paras: ParaInfo[], opt: { maxFonts?: number } = {}): { issues: WordIssue[]; summary: Record<string, number>; stats: Record<string, unknown> } {
  const issues: WordIssue[] = [];
  const body = paras.filter((p) => isNormal(p.style) && !p.inTable && p.text.trim());
  const bodySize = mode(body.map((p) => p.fontSize).filter((x): x is number => typeof x === "number" && x > 0)) ?? 12;
  let blanks = 0;
  let lastLevel = 0;
  for (const p of paras) {
    const t = p.text;
    if (!t.trim()) {
      blanks++;
      if (blanks === 2 && !p.inTable) issues.push({ rule: "empty-lines", severity: "warn", paragraph: p.index, message: `Đoạn ${p.index}: nhiều dòng trống liên tiếp; dùng giãn đoạn thay vì Enter.` });
      continue;
    }
    blanks = 0;
    const lvl = headingLevel(p.style);
    if (lvl > 0 && lvl < 10) {
      if (lastLevel && lvl > lastLevel + 1) issues.push({ rule: "heading-skip", severity: "warn", paragraph: p.index, message: `Đoạn ${p.index}: tiêu đề cấp ${lvl} nhảy cách từ cấp ${lastLevel}.`, fix: { style: `Heading ${lastLevel + 1}` } });
      lastLevel = lvl;
    }
    if (/ {2,}/.test(t.trim())) issues.push({ rule: "double-space", severity: "warn", paragraph: p.index, message: `Đoạn ${p.index}: có hai dấu cách liền nhau.` });
    if (/\s[,;:!?]/.test(t) || /\s\.(?=\s|$)/.test(t)) issues.push({ rule: "space-before-punct", severity: "warn", paragraph: p.index, message: `Đoạn ${p.index}: có dấu cách trước dấu câu.` });
    if (/[,;:!?][^\s\d)"”’'\]\n,;:!?.-]/.test(t)) issues.push({ rule: "no-space-after-punct", severity: "warn", paragraph: p.index, message: `Đoạn ${p.index}: thiếu dấu cách sau dấu câu.` });
    if (isNormal(p.style) && !p.isList && !p.inTable && MANUAL_NUMBER.test(t)) {
      issues.push({ rule: "manual-numbering", severity: "info", paragraph: p.index, message: `Đoạn ${p.index}: đánh số/gạch đầu dòng gõ tay; nên dùng danh sách tự động.`, fix: { numbering: /^\s*\d|^\s*[a-z][.)]/i.test(t) ? "number" : "bullet" } });
    }
    if (isNormal(p.style) && !p.inTable && t.trim().length <= 80 && !/[.;,]$/.test(t.trim()) && ((p.bold && (p.fontSize ?? 0) >= bodySize) || (p.fontSize ?? 0) >= bodySize + 3)) {
      issues.push({ rule: "fake-heading", severity: "info", paragraph: p.index, message: `Đoạn ${p.index}: trông như tiêu đề nhưng dùng kiểu Bình thường ("${t.trim().slice(0, 40)}").`, fix: { style: "Heading 2" } });
    }
    if (t.length > 1500) issues.push({ rule: "long-paragraph", severity: "info", paragraph: p.index, message: `Đoạn ${p.index}: dài ${t.length} ký tự; nên tách ý.` });
  }
  if (paras.length > 30 && !paras.some((p) => headingLevel(p.style) > 0)) {
    issues.push({ rule: "no-headings", severity: "warn", message: "Tài liệu dài nhưng chưa có tiêu đề (Heading); không tạo được mục lục." });
  }
  const fonts = new Map<string, number>();
  body.forEach((p) => p.fontName && fonts.set(p.fontName, (fonts.get(p.fontName) ?? 0) + 1));
  const maxFonts = opt.maxFonts ?? 2;
  if (fonts.size > maxFonts) {
    const top = [...fonts.entries()].sort((a, b) => b[1] - a[1]);
    issues.push({ rule: "mixed-fonts", severity: "warn", message: `Phần nội dung dùng ${fonts.size} phông (${top.map((x) => x[0]).join(", ")}); nên thống nhất.`, fix: { fontName: top[0][0] } });
  }
  const sizes = new Set(body.map((p) => p.fontSize).filter((x) => typeof x === "number"));
  if (sizes.size > 3) issues.push({ rule: "mixed-sizes", severity: "info", message: `Phần nội dung có ${sizes.size} cỡ chữ khác nhau.`, fix: { fontSize: bodySize } });
  const summary: Record<string, number> = {};
  issues.forEach((i) => (summary[i.rule] = (summary[i.rule] ?? 0) + 1));
  return { issues, summary, stats: { paragraphs: paras.length, headings: paras.filter((p) => headingLevel(p.style) > 0).length, bodySize, fonts: [...fonts.keys()] } };
}

/** Built-in style names the tools accept, mapped to Word.Style enum member names (locale independent). */
export const BUILTIN_STYLES: Record<string, string> = {
  normal: "Normal", title: "Title", subtitle: "Subtitle", quote: "Quote", caption: "Caption",
  "list bullet": "ListBullet", "list number": "ListNumber", "list paragraph": "ListParagraph",
  "heading 1": "Heading1", "heading 2": "Heading2", "heading 3": "Heading3", "heading 4": "Heading4", "heading 5": "Heading5",
  "heading 6": "Heading6", "heading 7": "Heading7", "heading 8": "Heading8", "heading 9": "Heading9",
};

export function builtinStyle(name: string): string | undefined {
  return BUILTIN_STYLES[(name || "").trim().toLowerCase()];
}
