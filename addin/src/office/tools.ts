import { currentHost } from "./host";
import * as word from "./word";
import * as excel from "./excel";
import * as ppt from "./powerpoint";

type Args = Record<string, any>;
type Handler = (a: Args) => Promise<unknown>;

const ok = async <T,>(p: Promise<T>) => (await p) ?? { ok: true };

/** Tool names match SPEC.md and the bridge's TOOLS table. */
export const tools: Record<string, Handler> = {
  office_word_get_selection: () => word.getSelection(),
  office_word_get_full_text: () => word.getRange("whole"),
  office_word_replace_selection: (a) => ok(word.replaceSelection(String(a.text ?? ""))),
  office_word_set_range: (a) => ok(word.setRange(String(a.text ?? ""), a.which === "selection" ? "selection" : "whole")),
  office_word_insert_text: (a) => ok(word.insertText(String(a.text ?? ""), a.location === "Start" ? "Start" : "End")),
  office_word_insert_equation: (a) =>
    ok(word.insertEquation(String(a.latex ?? ""), /^(start|end|replace)$/i.test(a.location) ? (a.location[0].toUpperCase() + a.location.slice(1).toLowerCase() as "Start" | "End" | "Replace") : "End")),
  office_word_insert_table: (a) => ok(word.insertTable(a.values)),
  office_word_get_styles: (a) => word.getStyles(a.which === "document" ? "document" : "selection"),
  office_word_apply_format: (a) => ok(word.applyFormat(a, a.which === "document" ? "document" : "selection")),

  office_excel_get_active_sheet: () => excel.getActiveSheet(),
  office_excel_get_range: (a) => excel.getRange(a.address),
  office_excel_set_range_values: (a) => ok(excel.setRange(String(a.address), a.values)),
  office_excel_set_formula: (a) => ok(excel.setFormula(String(a.address), String(a.formula))),
  office_excel_get_format: (a) => excel.getFormat(a.address),
  office_excel_set_format: (a) => ok(excel.setFormat(a.address, a)),
  office_excel_create_table: (a) => excel.createTable(a.address, a.name, a.hasHeaders ?? true),
  office_excel_list_tables: () => excel.listTables(),
  office_excel_add_table_column: (a) => excel.addTableColumn(String(a.tableName), String(a.columnName), a.formula),
  office_excel_insert_chart: (a) => excel.insertChart(String(a.dataAddress), a.chartType, a.title, a.targetCell),
  office_excel_conditional_format: (a) => excel.applyConditionalFormat(a as any),
  office_excel_sort_filter: (a) => excel.sortAndFilter(a),
  office_excel_list_sheets: () => excel.listSheets(),
  office_excel_add_sheet: (a) => excel.addSheet(a.name),

  office_ppt_get_slides: () => ppt.getSlides(),
  office_ppt_add_slide: async (a) => ({ slideId: await ppt.addSlide(a.layoutId, a.slideMasterId) }),
  office_ppt_generate_slide: async (a) => ({ slideId: (await ppt.generateSlide(a as any)).slideId }),
  office_ppt_insert_text_box: (a) => ok(ppt.insertTextBox(String(a.text ?? ""), a)),
  office_ppt_get_theme: (a) => ppt.getTheme(a.slideIndex),
  office_ppt_format_shape: (a) => ok(ppt.formatShape(Number(a.slideIndex ?? 0), String(a.shapeId), a)),
  office_ppt_apply_format: (a) => ppt.applyFormat(a),
};

export async function callTool(name: string, args: Args = {}): Promise<unknown> {
  const fn = tools[name];
  if (!fn) throw new Error(`Unknown tool: ${name}`);
  return fn(args);
}

/** Host-agnostic helpers for the UI's quick actions. */
export async function getSelectionText(): Promise<string> {
  switch (currentHost()) {
    case "word":
      return word.getSelection();
    case "powerpoint":
      return ppt.getSelection();
    case "excel": {
      const r = await excel.getSelection();
      return r.values.map((row) => row.join("\t")).join("\n");
    }
    default:
      return "";
  }
}

export async function replaceSelectionText(text: string): Promise<void> {
  switch (currentHost()) {
    case "word":
      return word.replaceSelection(text);
    case "powerpoint":
      return ppt.replaceSelection(text);
    case "excel":
      return excel.replaceSelection(text.split("\n").map((l) => l.split("\t")));
  }
}

/** What an inline edit (Cmd+L / Alt+L) acts on: the selection, or the current paragraph in Word when nothing is selected. */
export interface InlineTarget {
  text: string;
  scope: "selection" | "paragraph";
}

export async function getInlineTarget(): Promise<InlineTarget> {
  const text = await getSelectionText();
  if (text.trim() || currentHost() !== "word") return { text, scope: "selection" };
  return { text: await word.getParagraph(), scope: "paragraph" };
}

export async function applyInlineEdit(target: InlineTarget, text: string): Promise<void> {
  if (target.scope === "paragraph") return word.replaceParagraph(text);
  return replaceSelectionText(text);
}
