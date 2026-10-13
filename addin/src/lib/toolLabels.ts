import type { Lang } from "./i18n";

/** [tool, Vietnamese verb phrase, English gerund, English past, English base]. Shown instead of raw tool names. */
const ROWS: [string, string, string, string, string][] = [
  ["word_get_selection", "đọc phần đang chọn", "Reading the selection", "Read the selection", "read the selection"],
  ["word_get_full_text", "đọc toàn bộ văn bản", "Reading the whole document", "Read the whole document", "read the whole document"],
  ["word_replace_selection", "thay phần đang chọn", "Replacing the selection", "Replaced the selection", "replace the selection"],
  ["word_set_range", "ghi lại nội dung văn bản", "Rewriting the text", "Rewrote the text", "rewrite the text"],
  ["word_insert_text", "chèn văn bản", "Inserting text", "Inserted text", "insert text"],
  ["word_insert_equation", "chèn công thức", "Inserting an equation", "Inserted an equation", "insert an equation"],
  ["word_insert_table", "chèn bảng", "Inserting a table", "Inserted a table", "insert a table"],
  ["word_get_styles", "xem định dạng hiện tại", "Checking the formatting", "Checked the formatting", "check the formatting"],
  ["word_apply_format", "định dạng văn bản", "Formatting the text", "Formatted the text", "format the text"],
  ["word_get_page_setup", "xem cài đặt trang", "Checking the page setup", "Checked the page setup", "check the page setup"],
  ["word_set_page_setup", "chỉnh cài đặt trang", "Adjusting the page setup", "Adjusted the page setup", "adjust the page setup"],
  ["word_apply_style", "áp dụng kiểu", "Applying a style", "Applied a style", "apply a style"],
  ["excel_get_active_sheet", "đọc trang tính đang mở", "Reading the active sheet", "Read the active sheet", "read the active sheet"],
  ["excel_get_range", "đọc vùng ô", "Reading cells", "Read cells", "read cells"],
  ["excel_set_range_values", "điền dữ liệu vào ô", "Filling in cells", "Filled in cells", "fill in cells"],
  ["excel_set_formula", "đặt công thức", "Setting a formula", "Set a formula", "set a formula"],
  ["excel_get_format", "xem định dạng ô", "Checking cell formatting", "Checked cell formatting", "check cell formatting"],
  ["excel_set_format", "định dạng ô", "Formatting cells", "Formatted cells", "format cells"],
  ["excel_create_table", "tạo bảng", "Creating a table", "Created a table", "create a table"],
  ["excel_list_tables", "xem các bảng", "Listing tables", "Listed tables", "list tables"],
  ["excel_add_table_column", "thêm cột vào bảng", "Adding a table column", "Added a table column", "add a table column"],
  ["excel_insert_chart", "vẽ biểu đồ", "Drawing a chart", "Drew a chart", "draw a chart"],
  ["excel_conditional_format", "tô màu theo điều kiện", "Applying conditional formatting", "Applied conditional formatting", "apply conditional formatting"],
  ["excel_design_table", "trình bày lại bảng", "Styling the table", "Styled the table", "style the table"],
  ["excel_sort_filter", "sắp xếp và lọc dữ liệu", "Sorting and filtering", "Sorted and filtered", "sort and filter"],
  ["excel_list_sheets", "xem các trang tính", "Listing sheets", "Listed sheets", "list sheets"],
  ["excel_add_sheet", "thêm trang tính", "Adding a sheet", "Added a sheet", "add a sheet"],
  ["ppt_get_theme", "xem giao diện slide", "Checking the slide theme", "Checked the slide theme", "check the slide theme"],
  ["ppt_format_shape", "định dạng khối nội dung", "Formatting a shape", "Formatted a shape", "format a shape"],
  ["ppt_apply_format", "định dạng slide", "Formatting the slides", "Formatted the slides", "format the slides"],
  ["ppt_apply_palette", "đổi bảng màu", "Applying a colour palette", "Applied a colour palette", "apply a colour palette"],
  ["ppt_generate_slide", "tạo slide", "Creating a slide", "Created a slide", "create a slide"],
  ["ppt_get_slides", "đọc các slide", "Reading the slides", "Read the slides", "read the slides"],
  ["ppt_add_slide", "thêm slide", "Adding a slide", "Added a slide", "add a slide"],
  ["ppt_insert_text_box", "chèn khung chữ", "Adding a text box", "Added a text box", "add a text box"],
  ["style_get_profile", "xem thói quen định dạng", "Checking your style habits", "Checked your style habits", "check your style habits"],
  ["style_save_profile", "ghi nhớ thói quen định dạng", "Saving your style habits", "Saved your style habits", "save your style habits"],
  ["design_palette", "chọn bảng màu", "Choosing a palette", "Chose a palette", "choose a palette"],
  ["design_font_pair", "chọn cặp phông chữ", "Choosing fonts", "Chose fonts", "choose fonts"],
  ["doc_list", "xem tài liệu đính kèm", "Looking at the attachments", "Looked at the attachments", "look at the attachments"],
  ["doc_search", "tìm trong tài liệu đính kèm", "Searching the attachments", "Searched the attachments", "search the attachments"],
  ["doc_read", "đọc một đoạn tài liệu", "Reading part of a document", "Read part of a document", "read part of a document"],
  ["doc_outline", "xem mục lục tài liệu", "Reading the outline", "Read the outline", "read the outline"],
  ["doc_summarize_part", "tóm tắt một phần tài liệu", "Summarizing part of a document", "Summarized part of a document", "summarize part of a document"],
];
const MAP = new Map(ROWS.map((r) => [r[0], r]));

export type Phase = "run" | "done" | "fail" | "plan";

export function toolLabel(tool: string | undefined, lang: Lang, phase: Phase): string {
  const name = (tool ?? "").replace(/^office_/, "");
  const r = MAP.get(name);
  const human = name.replace(/_/g, " ");
  const vi = lang === "vi";
  if (!r) return vi ? { run: "Đang chạy ", done: "Đã chạy ", fail: "Không chạy được ", plan: "Sẽ chạy " }[phase] + human : { run: "Running ", done: "Ran ", fail: "Couldn't run ", plan: "Run " }[phase] + human;
  if (vi) return { run: "Đang ", done: "Đã ", fail: "Không thể ", plan: "Sẽ " }[phase] + r[1];
  return { run: r[2], done: r[3], fail: "Couldn't " + r[4], plan: r[4][0].toUpperCase() + r[4].slice(1) }[phase];
}
