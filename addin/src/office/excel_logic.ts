/** Excel cleaning, lint and compare rules that need no Office.js (tests: addin/tests/excel_logic.test.ts). */

export type Cell = string | number | boolean | null | undefined;

export function colLetter(n: number): string {
  let s = "";
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

export function colIndex(letters: string): number {
  return letters.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

/** "B3" → {row: 2, col: 1} (0-based) */
export function parseCell(a1: string): { row: number; col: number } {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a1.trim());
  if (!m) throw new Error(`Địa chỉ ô không hợp lệ: ${a1}`);
  return { row: Number(m[2]) - 1, col: colIndex(m[1]) };
}

export const cellAddress = (row: number, col: number) => `${colLetter(col)}${row + 1}`;

export type NumberParse = { value: number } | { ambiguous: true } | null;

/**
 * Text → number for Vietnamese and English layouts.
 * "1.234,5" "1 234 567" "12,5" "-7" "1,234.5" are read; "1.234" and "1,234" could be a thousand separator
 * or a decimal point, so they are reported as ambiguous and left alone.
 */
export function parseNumberText(raw: string): NumberParse {
  const t = raw.replace(/[  ]/g, " ").trim();
  if (!t) return null;
  if (/^[+-]?\d+$/.test(t)) return { value: Number(t) };
  if (/^[+-]?\d{1,3}( \d{3})+(,\d+)?$/.test(t)) return { value: Number(t.replace(/ /g, "").replace(",", ".")) };
  if (/^[+-]?\d{1,3}(\.\d{3})+,\d+$/.test(t)) return { value: Number(t.replace(/\./g, "").replace(",", ".")) };
  if (/^[+-]?\d{1,3}(,\d{3})+\.\d+$/.test(t)) return { value: Number(t.replace(/,/g, "")) };
  if (/^[+-]?\d{1,3}(\.\d{3}){2,}$/.test(t)) return { value: Number(t.replace(/\./g, "")) };
  if (/^[+-]?\d{1,3}(,\d{3}){2,}$/.test(t)) return { value: Number(t.replace(/,/g, "")) };
  if (/^[+-]?\d{1,3}(\.\d{3}|,\d{3})$/.test(t)) return { ambiguous: true };
  if (/^[+-]?\d+,\d{1,2}$/.test(t) || /^[+-]?\d+,\d{4,}$/.test(t)) return { value: Number(t.replace(",", ".")) };
  if (/^[+-]?\d+\.\d+$/.test(t)) return { value: Number(t) };
  return null;
}

export interface CleanOptions {
  trim?: boolean;
  collapseSpaces?: boolean;
  textToNumber?: boolean;
  removeLineBreaks?: boolean;
}

export interface CleanReport {
  trimmed: number;
  collapsed: number;
  lineBreaks: number;
  toNumber: number;
  ambiguous: string[]; // addresses left alone
  changes: { row: number; col: number; value: Cell }[];
}

/** Clean a grid of values. `formulas` marks cells that hold a formula (never touched). */
export function cleanGrid(values: Cell[][], formulas: Cell[][] | null, opt: CleanOptions, origin = { row: 0, col: 0 }): CleanReport {
  const o = { trim: true, collapseSpaces: true, textToNumber: true, removeLineBreaks: false, ...opt };
  const rep: CleanReport = { trimmed: 0, collapsed: 0, lineBreaks: 0, toNumber: 0, ambiguous: [], changes: [] };
  values.forEach((row, r) =>
    row.forEach((v, c) => {
      if (typeof v !== "string") return;
      const f = formulas?.[r]?.[c];
      if (typeof f === "string" && f.startsWith("=")) return;
      let s = v;
      if (o.removeLineBreaks && /[\r\n]/.test(s)) {
        s = s.replace(/\s*[\r\n]+\s*/g, " ");
        rep.lineBreaks++;
      }
      s = s.replace(/[  ​]/g, " ");
      if (o.collapseSpaces && / {2,}/.test(s.trim())) {
        s = s.replace(/ {2,}/g, " ");
        rep.collapsed++;
      }
      if (o.trim && s !== s.trim()) {
        s = s.trim();
        rep.trimmed++;
      }
      let out: Cell = s;
      if (o.textToNumber) {
        const n = parseNumberText(s);
        if (n && "value" in n && Number.isFinite(n.value)) {
          out = n.value;
          rep.toNumber++;
        } else if (n && "ambiguous" in n) {
          rep.ambiguous.push(cellAddress(origin.row + r, origin.col + c));
        }
      }
      if (out !== v) rep.changes.push({ row: r, col: c, value: out });
    }),
  );
  return rep;
}

// ------------------------------------------------------------------ lint

export interface ExcelIssue {
  rule: string;
  severity: "error" | "warn" | "info";
  address?: string;
  message: string;
  fix?: Record<string, unknown>;
}

const ERROR_RE = /^#(REF!|DIV\/0!|N\/A|VALUE!|NAME\?|NUM!|NULL!|SPILL!|CALC!)/;
const isBlank = (v: Cell) => v === null || v === undefined || v === "";

/** Lint a table whose first row is the header. `origin` is the 0-based position of the first cell on the sheet. */
export function lintGrid(values: Cell[][], formulas: Cell[][] | null, numberFormats: string[][] | null, origin = { row: 0, col: 0 }): { issues: ExcelIssue[]; summary: Record<string, number>; stats: Record<string, unknown> } {
  const issues: ExcelIssue[] = [];
  const rows = values.length;
  const cols = rows ? values[0].length : 0;
  const at = (r: number, c: number) => cellAddress(origin.row + r, origin.col + c);
  const head = rows ? values[0] : [];
  const seen = new Map<string, number>();
  for (let c = 0; c < cols; c++) {
    const h = head[c];
    const hasData = values.slice(1).some((r) => !isBlank(r[c]));
    if (isBlank(h) && hasData) issues.push({ rule: "header-empty", severity: "warn", address: at(0, c), message: `${at(0, c)}: cột có dữ liệu nhưng thiếu tiêu đề.` });
    if (!isBlank(h)) {
      const k = String(h).trim().toLowerCase();
      if (seen.has(k)) issues.push({ rule: "header-duplicate", severity: "warn", address: at(0, c), message: `${at(0, c)}: tiêu đề "${String(h).trim()}" trùng với cột ${colLetter(origin.col + (seen.get(k) as number))}.` });
      else seen.set(k, c);
    }
  }
  for (let c = 0; c < cols; c++) {
    let nums = 0;
    let texts = 0;
    let textNums = 0;
    let spaces = 0;
    const fmts = new Set<string>();
    for (let r = 1; r < rows; r++) {
      const v = values[r][c];
      const f = formulas?.[r]?.[c];
      if (typeof v === "string" && ERROR_RE.test(v)) {
        issues.push({ rule: "error-value", severity: "error", address: at(r, c), message: `${at(r, c)}: ô báo lỗi ${v}${typeof f === "string" && f.startsWith("=") ? ` (công thức ${f.slice(0, 60)})` : ""}.` });
        continue;
      }
      if (typeof v === "number") {
        nums++;
        const nf = numberFormats?.[r]?.[c];
        if (nf) fmts.add(nf);
      } else if (typeof v === "string" && v.trim()) {
        if (v !== v.trim() || / {2,}/.test(v)) spaces++;
        if (parseNumberText(v) && !("ambiguous" in (parseNumberText(v) as object))) textNums++;
        else texts++;
      }
    }
    if (textNums) issues.push({ rule: "text-numbers", severity: "warn", address: at(1, c), message: `Cột ${colLetter(origin.col + c)}: ${textNums} ô là số nhưng đang lưu dạng chữ.`, fix: { tool: "office_excel_clean_range", textToNumber: true } });
    if (nums && texts) issues.push({ rule: "mixed-types", severity: "warn", address: at(1, c), message: `Cột ${colLetter(origin.col + c)}: lẫn ${nums} ô số với ${texts} ô chữ.` });
    if (spaces) issues.push({ rule: "extra-spaces", severity: "info", address: at(1, c), message: `Cột ${colLetter(origin.col + c)}: ${spaces} ô thừa dấu cách.`, fix: { tool: "office_excel_clean_range", trim: true } });
    if (fmts.size > 1) issues.push({ rule: "number-format", severity: "info", address: at(1, c), message: `Cột ${colLetter(origin.col + c)}: số có ${fmts.size} định dạng khác nhau (${[...fmts].slice(0, 3).join(" | ")}).` });
  }
  const keyed = new Map<string, number>();
  let dups = 0;
  let blankInside = 0;
  let lastData = -1;
  for (let r = rows - 1; r >= 1; r--) if (values[r].some((v) => !isBlank(v))) { lastData = r; break; }
  for (let r = 1; r <= lastData; r++) {
    if (values[r].every(isBlank)) { blankInside++; continue; }
    const k = JSON.stringify(values[r].map((v) => (typeof v === "string" ? v.trim().toLowerCase() : v)));
    if (keyed.has(k)) dups++;
    else keyed.set(k, r);
  }
  if (dups) issues.push({ rule: "duplicate-rows", severity: "warn", message: `Có ${dups} dòng trùng hoàn toàn với dòng trên.`, fix: { tool: "office_excel_remove_duplicates" } });
  if (blankInside) issues.push({ rule: "blank-rows", severity: "info", message: `Có ${blankInside} dòng trống xen giữa dữ liệu.` });
  const summary: Record<string, number> = {};
  issues.forEach((i) => (summary[i.rule] = (summary[i.rule] ?? 0) + 1));
  return { issues, summary, stats: { rows: Math.max(0, rows - 1), columns: cols, duplicates: dups, blankRows: blankInside } };
}

// ------------------------------------------------------------------ compare

export interface DiffItem {
  kind: "changed" | "only-in-A" | "only-in-B";
  key?: string;
  row?: number; // 0-based inside range A (inside range B for only-in-B)
  rowB?: number; // 0-based inside range B, for "changed"
  col?: number;
  a?: Cell;
  b?: Cell;
}

const norm = (v: Cell) => (typeof v === "string" ? v.trim() : v ?? "");

export function diffGrids(a: Cell[][], b: Cell[][], keyColumn?: number, limit = 100): { items: DiffItem[]; total: number; counts: Record<string, number> } {
  const items: DiffItem[] = [];
  const counts: Record<string, number> = { changed: 0, "only-in-A": 0, "only-in-B": 0 };
  const push = (d: DiffItem) => {
    counts[d.kind]++;
    if (items.length < limit) items.push(d);
  };
  const cmpRow = (ra: Cell[], rb: Cell[], rowA: number, rowB: number, key?: string) => {
    const w = Math.max(ra.length, rb.length);
    for (let c = 0; c < w; c++) if (norm(ra[c]) !== norm(rb[c])) push({ kind: "changed", key, row: rowA, rowB, col: c, a: ra[c] ?? null, b: rb[c] ?? null });
  };
  if (keyColumn === undefined) {
    const n = Math.max(a.length, b.length);
    for (let r = 0; r < n; r++) {
      if (r >= a.length) push({ kind: "only-in-B", row: r });
      else if (r >= b.length) push({ kind: "only-in-A", row: r });
      else cmpRow(a[r], b[r], r, r);
    }
  } else {
    const kb = new Map<string, number>();
    b.forEach((row, i) => { const k = String(norm(row[keyColumn])); if (k !== "" && !kb.has(k)) kb.set(k, i); });
    const usedB = new Set<number>();
    a.forEach((row, i) => {
      const k = String(norm(row[keyColumn]));
      if (k === "") return;
      const j = kb.get(k);
      if (j === undefined) push({ kind: "only-in-A", key: k, row: i });
      else { usedB.add(j); cmpRow(row, b[j], i, j, k); }
    });
    b.forEach((row, j) => { const k = String(norm(row[keyColumn])); if (k !== "" && !usedB.has(j)) push({ kind: "only-in-B", key: k, row: j }); });
  }
  return { items, total: counts.changed + counts["only-in-A"] + counts["only-in-B"], counts };
}
