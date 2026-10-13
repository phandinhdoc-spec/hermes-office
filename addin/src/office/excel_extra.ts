/**
 * Excel tools added for the Office skill set (own file, so excel.ts stays untouched).
 * Pure rules live in excel_logic.ts. NOT run against a real Excel in the build sandbox.
 * Undo is the taskpane's snapshot of the used cells (snapshot.ts).
 */
import { requireHost } from "./host";
import { Cell, cleanGrid, diffGrids, lintGrid, parseCell, cellAddress } from "./excel_logic";

type Args = Record<string, any>;
const MAX_CELLS = 100_000;
const MAX_WRITES = 5000;

const toInt = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== "" && v !== null && v !== undefined ? Math.trunc(Number(v)) : d);

function sheetOf(ctx: Excel.RequestContext, name?: unknown): Excel.Worksheet {
  return name ? ctx.workbook.worksheets.getItem(String(name)) : ctx.workbook.worksheets.getActiveWorksheet();
}

async function rangeOf(ctx: Excel.RequestContext, sheet: Excel.Worksheet, address?: unknown): Promise<Excel.Range> {
  const r = address ? sheet.getRange(String(address)) : sheet.getUsedRange(true);
  r.load("address,rowCount,columnCount,rowIndex,columnIndex");
  await ctx.sync();
  if (r.rowCount * r.columnCount > MAX_CELLS) throw new Error(`Vùng quá lớn (${r.rowCount * r.columnCount} ô, tối đa ${MAX_CELLS}); hãy chọn vùng nhỏ hơn.`);
  return r;
}

const plain = (r: Excel.Range): Cell[][] => r.values as Cell[][];

// ---------------------------------------------------------------------------------------------------- data validation, freeze

export async function setValidation(a: Args): Promise<unknown> {
  requireHost("excel");
  if (!a.address) throw new Error("Thiếu address (ví dụ A2:A100)");
  return Excel.run(async (ctx) => {
    const r = ctx.workbook.worksheets.getActiveWorksheet().getRange(String(a.address));
    const type = String(a.type ?? "list");
    const op = String(a.operator ?? "Between");
    let rule: Excel.DataValidationRule;
    if (type === "list") {
      let source: string;
      if (a.source) source = String(a.source);
      else if (Array.isArray(a.values) && a.values.length) {
        if (a.values.some((v: unknown) => String(v).includes(","))) throw new Error("Mục trong danh sách không được chứa dấu phẩy; dùng source là vùng ô.");
        source = a.values.map(String).join(",");
      } else throw new Error("Danh sách cần values hoặc source");
      rule = { list: { inCellDropDown: true, source } };
    } else if (["whole", "decimal", "date", "textLength"].includes(type)) {
      const f1 = a.min ?? a.value;
      if (f1 === undefined) throw new Error("Cần min (và max nếu Between)");
      const body = { formula1: f1 as string | number, formula2: a.max as string | number | undefined, operator: op as Excel.DataValidationOperator };
      rule = type === "whole" ? { wholeNumber: body } : type === "decimal" ? { decimal: body } : type === "date" ? { date: body as any } : { textLength: body };
    } else throw new Error("type phải là list, whole, decimal, date hoặc textLength");
    r.dataValidation.clear();
    r.dataValidation.rule = rule;
    r.dataValidation.ignoreBlanks = true;
    if (a.prompt) r.dataValidation.prompt = { showPrompt: true, title: "Gợi ý", message: String(a.prompt).slice(0, 255) };
    r.dataValidation.errorAlert = { showAlert: true, style: "Stop", title: "Giá trị không hợp lệ", message: String(a.error ?? "Giá trị nhập vào không đúng quy định.").slice(0, 255) };
    await ctx.sync();
    return { ok: true, address: a.address };
  });
}

export async function freezePanes(a: Args): Promise<unknown> {
  requireHost("excel");
  const rows = Math.max(0, toInt(a.rows, 0));
  const columns = Math.max(0, toInt(a.columns, 0));
  return Excel.run(async (ctx) => {
    const s = sheetOf(ctx, a.sheet);
    s.freezePanes.unfreeze();
    if (rows && columns) s.freezePanes.freezeAt(s.getRangeByIndexes(0, 0, rows, columns));
    else if (rows) s.freezePanes.freezeRows(rows);
    else if (columns) s.freezePanes.freezeColumns(columns);
    await ctx.sync();
    return { ok: true, rows, columns };
  });
}

// ---------------------------------------------------------------------------------------------------- cleaning

export async function removeDuplicates(a: Args): Promise<unknown> {
  requireHost("excel");
  if (!a.address) throw new Error("Thiếu address (ví dụ A1:F200)");
  return Excel.run(async (ctx) => {
    const r = await rangeOf(ctx, ctx.workbook.worksheets.getActiveWorksheet(), a.address);
    const cols: number[] = Array.isArray(a.columns) && a.columns.length ? a.columns.map((x: unknown) => toInt(x, 0)) : Array.from({ length: r.columnCount }, (_, i) => i);
    if (cols.some((c) => c < 0 || c >= r.columnCount)) throw new Error(`Số cột phải từ 0 đến ${r.columnCount - 1}`);
    const res = r.removeDuplicates(cols, a.hasHeaders !== false);
    res.load("removed,uniqueRemaining");
    await ctx.sync();
    return { ok: true, removed: res.removed, remaining: res.uniqueRemaining };
  });
}

export async function findReplace(a: Args): Promise<unknown> {
  requireHost("excel");
  const find = String(a.find ?? "");
  if (!find) throw new Error("Thiếu chuỗi cần tìm");
  const opts = { completeMatch: !!a.wholeCell, matchCase: !!a.matchCase };
  return Excel.run(async (ctx) => {
    const counts: { sheet: string; replaced: number }[] = [];
    if (a.sheet === "all") {
      const sheets = ctx.workbook.worksheets;
      sheets.load("items/name");
      await ctx.sync();
      const res = sheets.items.map((s) => ({ s, r: s.replaceAll(find, String(a.replace ?? ""), opts) }));
      await ctx.sync();
      res.forEach(({ s, r }) => counts.push({ sheet: s.name, replaced: r.value }));
    } else {
      const s = sheetOf(ctx, a.sheet);
      s.load("name");
      const target = a.address ? s.getRange(String(a.address)) : s;
      const n = target.replaceAll(find, String(a.replace ?? ""), opts);
      await ctx.sync();
      counts.push({ sheet: s.name, replaced: n.value });
    }
    return { ok: true, total: counts.reduce((x, y) => x + y.replaced, 0), bySheet: counts };
  });
}

export async function cleanRange(a: Args): Promise<unknown> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const s = ctx.workbook.worksheets.getActiveWorksheet();
    const r = await rangeOf(ctx, s, a.address);
    r.load("values,formulas,numberFormat");
    await ctx.sync();
    const rep = cleanGrid(plain(r), r.formulas as Cell[][], { trim: a.trim !== false, collapseSpaces: a.collapseSpaces !== false, textToNumber: a.textToNumber !== false, removeLineBreaks: !!a.removeLineBreaks }, { row: r.rowIndex, col: r.columnIndex });
    if (rep.changes.length > MAX_WRITES) throw new Error(`Có ${rep.changes.length} ô cần sửa, vượt ${MAX_WRITES}; hãy làm từng vùng nhỏ hơn.`);
    for (const c of rep.changes) {
      const cell = r.getCell(c.row, c.col);
      if (typeof c.value === "number") cell.numberFormat = [["General"]]; // a "text" format would turn the number back into text
      cell.values = [[c.value as string | number]];
    }
    await ctx.sync();
    return {
      ok: true,
      range: r.address,
      cellsChanged: rep.changes.length,
      trimmed: rep.trimmed,
      collapsedSpaces: rep.collapsed,
      lineBreaksRemoved: rep.lineBreaks,
      textToNumber: rep.toNumber,
      leftAlone: rep.ambiguous.length ? { reason: "Không chắc dấu chấm/phẩy là phân cách nghìn hay thập phân", cells: rep.ambiguous.slice(0, 20), count: rep.ambiguous.length } : undefined,
    };
  });
}

// ---------------------------------------------------------------------------------------------------- reading: lint, diff

export async function getLint(a: Args): Promise<unknown> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const s = ctx.workbook.worksheets.getActiveWorksheet();
    const r = await rangeOf(ctx, s, a.address);
    r.load("values,formulas,numberFormat");
    const fr = s.freezePanes.getLocationOrNullObject();
    fr.load("address,isNullObject");
    await ctx.sync();
    const res = lintGrid(plain(r), r.formulas as Cell[][], r.numberFormat as string[][], { row: r.rowIndex, col: r.columnIndex });
    if (fr.isNullObject && r.rowCount > 15) {
      res.issues.push({ rule: "no-freeze", severity: "info", message: "Hàng tiêu đề chưa được cố định khi cuộn.", fix: { tool: "office_excel_freeze_panes", rows: 1 } });
      res.summary["no-freeze"] = 1;
    }
    return { ok: true, range: r.address, issueCount: res.issues.length, summary: res.summary, stats: res.stats, issues: res.issues.slice(0, 80), truncated: res.issues.length > 80 };
  });
}

export async function getDiff(a: Args): Promise<unknown> {
  requireHost("excel");
  if (!a.sheetA || !a.sheetB) throw new Error("Cần sheetA và sheetB");
  return Excel.run(async (ctx) => {
    const ra = await rangeOf(ctx, ctx.workbook.worksheets.getItem(String(a.sheetA)), a.rangeA);
    const rb = await rangeOf(ctx, ctx.workbook.worksheets.getItem(String(a.sheetB)), a.rangeB);
    ra.load("values");
    rb.load("values");
    await ctx.sync();
    const key = a.keyColumn === undefined || a.keyColumn === null || a.keyColumn === "" ? undefined : toInt(a.keyColumn, 0);
    const d = diffGrids(plain(ra), plain(rb), key, Math.min(500, Math.max(1, toInt(a.limit, 100))));
    const addr = (rng: Excel.Range, row?: number, col?: number) => (row === undefined ? undefined : cellAddress(rng.rowIndex + row, rng.columnIndex + (col ?? 0)));
    return {
      ok: true,
      rangeA: ra.address,
      rangeB: rb.address,
      counts: d.counts,
      total: d.total,
      truncated: d.total > d.items.length,
      differences: d.items.map((x) => ({
        kind: x.kind,
        key: x.key,
        a: x.kind === "only-in-B" ? undefined : { address: addr(ra, x.row, x.col), value: x.a },
        b: x.kind === "only-in-A" ? undefined : { address: addr(rb, x.kind === "only-in-B" ? x.row : x.rowB, x.col), value: x.b },
      })),
      note: key === undefined ? "So sánh theo vị trí dòng." : `So sánh theo cột khóa số ${key} (đánh số từ 0).`,
    };
  });
}

export async function highlightCells(a: Args): Promise<unknown> {
  requireHost("excel");
  const list: string[] = Array.isArray(a.addresses) ? a.addresses.map(String).slice(0, 300) : [];
  if (!list.length) throw new Error("Cần addresses: danh sách ô");
  list.forEach((x) => x.split(":").forEach((p) => parseCell(p))); // reject junk early
  return Excel.run(async (ctx) => {
    const s = sheetOf(ctx, a.sheet);
    for (const addr of list) {
      const r = s.getRange(addr);
      r.format.fill.color = String(a.fillColor ?? "#FFF2CC");
      if (a.fontColor) r.format.font.color = String(a.fontColor);
    }
    await ctx.sync();
    return { ok: true, highlighted: list.length };
  });
}

export const excelExtraTools: Record<string, (a: Args) => Promise<unknown>> = {
  office_excel_set_validation: setValidation,
  office_excel_freeze_panes: freezePanes,
  office_excel_remove_duplicates: removeDuplicates,
  office_excel_find_replace: findReplace,
  office_excel_clean_range: cleanRange,
  office_excel_get_lint: getLint,
  office_excel_get_diff: getDiff,
  office_excel_highlight_cells: highlightCells,
};
