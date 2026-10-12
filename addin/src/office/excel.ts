import { requireHost } from "./host";

export interface RangeData {
  sheet: string;
  address: string;
  values: unknown[][];
  formulas: unknown[][];
}

export async function getActiveSheet(): Promise<{ name: string; usedRange: RangeData | null }> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    sheet.load("name");
    const used = sheet.getUsedRangeOrNullObject(true);
    used.load(["address", "values", "formulas"]);
    await ctx.sync();
    return {
      name: sheet.name,
      usedRange: used.isNullObject
        ? null
        : { sheet: sheet.name, address: used.address, values: used.values, formulas: used.formulas },
    };
  });
}

/** Read `address` (e.g. "A1:C10") on the active sheet, or the current selection when omitted. */
export async function getRange(address?: string): Promise<RangeData> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const range = address ? sheet.getRange(address) : ctx.workbook.getSelectedRange();
    sheet.load("name");
    range.load(["address", "values", "formulas"]);
    await ctx.sync();
    return { sheet: sheet.name, address: range.address, values: range.values, formulas: range.formulas };
  });
}

/** Write a 2D array starting at the top-left of `address`; the target is resized to fit `values`. */
export async function setRange(address: string, values: unknown[][]): Promise<void> {
  requireHost("excel");
  if (!values.length) throw new Error("values must be a non-empty 2D array");
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.worksheets.getActiveWorksheet().getRange(address).getCell(0, 0);
    const target = start.getResizedRange(values.length - 1, Math.max(...values.map((r) => r.length)) - 1);
    target.values = values as any[][];
    await ctx.sync();
  });
}

export async function setFormula(address: string, formula: string): Promise<void> {
  requireHost("excel");
  await Excel.run(async (ctx) => {
    ctx.workbook.worksheets.getActiveWorksheet().getRange(address).formulas = [[formula]];
    await ctx.sync();
  });
}

export async function getSelection(): Promise<RangeData> {
  return getRange();
}

export async function replaceSelection(values: unknown[][] | string): Promise<void> {
  requireHost("excel");
  await Excel.run(async (ctx) => {
    const sel = ctx.workbook.getSelectedRange();
    if (typeof values === "string") {
      sel.values = [[values]];
    } else {
      sel.getCell(0, 0).getResizedRange(values.length - 1, Math.max(...values.map((r) => r.length)) - 1).values =
        values as any[][];
    }
    await ctx.sync();
  });
}

export interface ExcelFormat {
  fontName?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  fontColor?: string;
  fillColor?: string;
  numberFormat?: string;
  horizontalAlignment?: string;
  verticalAlignment?: string;
  wrapText?: boolean;
  columnWidth?: number;
}

const BORDER_SIDES = ["EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight"] as const;

/** Font, number format, fill and borders of `address` (default: the selection). */
export async function getFormat(address?: string): Promise<Record<string, unknown>> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const range = address ? sheet.getRange(address) : ctx.workbook.getSelectedRange();
    range.load(["address", "numberFormat"]);
    range.format.load(["horizontalAlignment", "verticalAlignment", "wrapText", "columnWidth", "rowHeight"]);
    range.format.font.load(["name", "size", "bold", "italic", "color"]);
    range.format.fill.load("color");
    const borders = BORDER_SIDES.map((s) => {
      const b = range.format.borders.getItem(s);
      b.load(["style", "color", "weight"]);
      return b;
    });
    await ctx.sync();
    const f = range.format;
    return {
      address: range.address,
      numberFormat: range.numberFormat[0]?.[0],
      font: { name: f.font.name, size: f.font.size, bold: f.font.bold, italic: f.font.italic, color: f.font.color },
      fillColor: f.fill.color,
      horizontalAlignment: f.horizontalAlignment,
      verticalAlignment: f.verticalAlignment,
      wrapText: f.wrapText,
      columnWidth: f.columnWidth,
      borders: Object.fromEntries(BORDER_SIDES.map((s, i) => [s, { style: borders[i].style, color: borders[i].color, weight: borders[i].weight }])),
    };
  });
}

export async function setFormat(address: string | undefined, fmt: ExcelFormat): Promise<void> {
  requireHost("excel");
  await Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const range = address ? sheet.getRange(address) : ctx.workbook.getSelectedRange();
    const f = range.format;
    if (fmt.fontName !== undefined) f.font.name = fmt.fontName;
    if (fmt.fontSize !== undefined) f.font.size = fmt.fontSize;
    if (fmt.bold !== undefined) f.font.bold = fmt.bold;
    if (fmt.italic !== undefined) f.font.italic = fmt.italic;
    if (fmt.fontColor !== undefined) f.font.color = fmt.fontColor;
    if (fmt.fillColor !== undefined) f.fill.color = fmt.fillColor;
    if (fmt.horizontalAlignment !== undefined) f.horizontalAlignment = fmt.horizontalAlignment as Excel.HorizontalAlignment;
    if (fmt.verticalAlignment !== undefined) f.verticalAlignment = fmt.verticalAlignment as Excel.VerticalAlignment;
    if (fmt.wrapText !== undefined) f.wrapText = fmt.wrapText;
    if (fmt.columnWidth !== undefined) f.columnWidth = fmt.columnWidth;
    if (fmt.numberFormat !== undefined) {
      range.load("rowCount,columnCount");
      await ctx.sync();
      range.numberFormat = Array.from({ length: range.rowCount }, () => Array(range.columnCount).fill(fmt.numberFormat));
    }
    await ctx.sync();
  });
}

// --- Excel Copilot-grade Advanced Capabilities ---

export interface TableInfo {
  id: string;
  name: string;
  columns: string[];
  rowCount: number;
}

export async function createTable(address?: string, name?: string, hasHeaders = true): Promise<{ name: string; range: string }> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const range = address ? sheet.getRange(address) : sheet.getUsedRange(true);
    const table = sheet.tables.add(range, hasHeaders);
    if (name) table.name = name;
    const tRange = table.getRange();
    table.load("name");
    tRange.load("address");
    await ctx.sync();
    return { name: table.name, range: tRange.address };
  });
}

export async function listTables(): Promise<TableInfo[]> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const tables = ctx.workbook.tables;
    tables.load("items/id,items/name,items/columns/items/name,items/rows/count");
    await ctx.sync();
    return tables.items.map((t) => ({
      id: t.id,
      name: t.name,
      columns: t.columns.items.map((c) => c.name),
      rowCount: t.rows.count,
    }));
  });
}

export async function addTableColumn(tableName: string, columnName: string, formula?: string): Promise<{ success: boolean }> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const table = ctx.workbook.tables.getItem(tableName);
    const col = table.columns.add(undefined, undefined, columnName);
    if (formula) {
      col.getDataBodyRange().formulas = [[formula]];
    }
    await ctx.sync();
    return { success: true };
  });
}

export async function insertChart(
  dataAddress: string,
  chartType: string = "ColumnClustered",
  title?: string,
  targetCell?: string,
): Promise<{ chartName: string }> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const dataRange = sheet.getRange(dataAddress);
    const type = (Excel.ChartType as any)[chartType] ?? Excel.ChartType.columnClustered;
    const chart = sheet.charts.add(type, dataRange, Excel.ChartSeriesBy.auto);
    if (title) {
      chart.title.text = title;
    }
    if (targetCell) {
      const cell = sheet.getRange(targetCell);
      chart.setPosition(cell, cell);
    }
    chart.load("name");
    await ctx.sync();
    return { chartName: chart.name };
  });
}

export interface ConditionalFormatArgs {
  address?: string;
  ruleType: "colorScale" | "preset" | "cellValue";
  criteria?: string;
  fillColor?: string;
  fontColor?: string;
}

export async function applyConditionalFormat(args: ConditionalFormatArgs): Promise<{ success: boolean }> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const range = args.address ? sheet.getRange(args.address) : ctx.workbook.getSelectedRange();
    if (args.ruleType === "colorScale") {
      range.conditionalFormats.add(Excel.ConditionalFormatType.colorScale);
    } else if (args.ruleType === "preset") {
      const cf = range.conditionalFormats.add(Excel.ConditionalFormatType.presetCriteria);
      const presetRule = cf.preset;
      (presetRule as any).rule = {
        criterion: args.criteria === "duplicateValues"
          ? Excel.ConditionalFormatPresetCriterion.duplicateValues
          : Excel.ConditionalFormatPresetCriterion.uniqueValues,
      };
      if (args.fillColor) presetRule.format.fill.color = args.fillColor;
      if (args.fontColor) presetRule.format.font.color = args.fontColor;
    } else if (args.ruleType === "cellValue" && args.criteria) {
      const cf = range.conditionalFormats.add(Excel.ConditionalFormatType.cellValue);
      const cvRule = cf.cellValue;
      (cvRule as any).rule = {
        operator: Excel.ConditionalCellValueOperator.greaterThan,
        formula1: args.criteria,
      };
      if (args.fillColor) cvRule.format.fill.color = args.fillColor;
      if (args.fontColor) cvRule.format.font.color = args.fontColor;
    }
    await ctx.sync();
    return { success: true };
  });
}

export interface SortFilterArgs {
  address?: string;
  sortColumn?: number;
  ascending?: boolean;
  filterColumn?: number;
  filterCriteria?: string;
}

export async function sortAndFilter(args: SortFilterArgs): Promise<{ success: boolean }> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const range = args.address ? sheet.getRange(args.address) : ctx.workbook.getSelectedRange();
    if (args.sortColumn !== undefined) {
      range.sort.apply([
        {
          key: args.sortColumn,
          ascending: args.ascending ?? true,
        },
      ]);
    }
    if (args.filterColumn !== undefined && args.filterCriteria !== undefined) {
      sheet.autoFilter.apply(range, args.filterColumn, { filterOn: Excel.FilterOn.values, values: [args.filterCriteria] });
    }
    await ctx.sync();
    return { success: true };
  });
}

export async function listSheets(): Promise<{ sheets: { name: string; position: number; visibility: string }[] }> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const sheets = ctx.workbook.worksheets;
    sheets.load("items/name,items/position,items/visibility");
    await ctx.sync();
    return {
      sheets: sheets.items.map((s) => ({
        name: s.name,
        position: s.position,
        visibility: s.visibility,
      })),
    };
  });
}

export async function addSheet(name?: string): Promise<{ name: string }> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.add(name);
    sheet.load("name");
    await ctx.sync();
    return { name: sheet.name };
  });
}
