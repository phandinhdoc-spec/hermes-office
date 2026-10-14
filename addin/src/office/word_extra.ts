/**
 * Word tools added for the Office skill set (own file, so word.ts stays untouched).
 * Pure rules live in word_logic.ts. NOT run against a real Word in the build sandbox.
 * Undo for all of these is the taskpane's whole-document snapshot (snapshot.ts), taken before any changing tool.
 */
import { requireHost } from "./host";
import { ParaInfo, builtinStyle, headingLevel, lintParagraphs } from "./word_logic";

type Args = Record<string, any>;
const MAX_PICTURE_WIDTH = 450; // pt: fits an A4 page with 2 cm margins

const toInt = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== "" && v !== null && v !== undefined ? Math.trunc(Number(v)) : d);

async function loadParagraphs(ctx: Word.RequestContext, withFont = true): Promise<Word.Paragraph[]> {
  const paras = ctx.document.body.paragraphs;
  paras.load("items/text,items/style,items/isListItem,items/alignment,items/tableNestingLevel" + (withFont ? ",items/font/name,items/font/size,items/font/bold" : ""));
  await ctx.sync();
  return paras.items;
}

const info = (p: Word.Paragraph, i: number): ParaInfo => ({
  index: i,
  text: p.text,
  style: p.style,
  isList: p.isListItem,
  alignment: p.alignment,
  fontName: p.font.name || null,
  fontSize: p.font.size || null,
  bold: p.font.bold ?? null,
  inTable: p.tableNestingLevel > 0,
});

function applyStyle(p: Word.Paragraph, name: string): void {
  const b = builtinStyle(name);
  if (b) p.styleBuiltIn = (Word.Style as any)[b[0].toLowerCase() + b.slice(1)] ?? (Word.Style as any)[b] ?? b;
  else p.style = name;
}

// ---------------------------------------------------------------------------------------------------- outline

export async function getOutline(a: Args): Promise<unknown> {
  requireHost("word");
  return Word.run(async (ctx) => {
    const items = await loadParagraphs(ctx);
    const from = Math.max(0, toInt(a.from, 0));
    const count = Math.min(400, Math.max(1, toInt(a.count, 150)));
    const all = a.mode === "all";
    const rows = items
      .map((p, i) => ({ i, p }))
      .filter(({ i, p }) => i >= from && (all || headingLevel(p.style) > 0))
      .slice(0, count)
      .map(({ i, p }) => ({
        index: i,
        style: p.style,
        level: headingLevel(p.style) || undefined,
        text: all ? p.text.slice(0, 400) : p.text.slice(0, 160),
        list: p.isListItem || undefined,
        table: p.tableNestingLevel > 0 || undefined,
      }));
    return { ok: true, totalParagraphs: items.length, returned: rows.length, from, paragraphs: rows };
  });
}

export async function getLint(_a: Args): Promise<unknown> {
  requireHost("word");
  return Word.run(async (ctx) => {
    const items = await loadParagraphs(ctx);
    const res = lintParagraphs(items.map(info));
    return { ok: true, issueCount: res.issues.length, summary: res.summary, stats: res.stats, issues: res.issues.slice(0, 80), truncated: res.issues.length > 80 };
  });
}

// ---------------------------------------------------------------------------------------------------- change paragraphs by number

export async function applyStyleByIndex(a: Args): Promise<unknown> {
  requireHost("word");
  const list = Array.isArray(a.items) ? a.items.slice(0, 80) : [];
  if (!list.length) throw new Error("Cần items: [{index, style}]");
  return Word.run(async (ctx) => {
    const items = await loadParagraphs(ctx, false);
    let done = 0;
    const skipped: number[] = [];
    for (const it of list) {
      const p = items[toInt(it?.index, -1)];
      if (!p || !String(it?.style ?? "").trim()) {
        skipped.push(toInt(it?.index, -1));
        continue;
      }
      applyStyle(p, String(it.style));
      done++;
    }
    await ctx.sync();
    return { ok: true, changed: done, skipped };
  });
}

export async function setParagraphText(a: Args): Promise<unknown> {
  requireHost("word");
  const list = Array.isArray(a.items) ? a.items.slice(0, 40) : [];
  if (!list.length) throw new Error("Cần items: [{index, text}]");
  return Word.run(async (ctx) => {
    const items = await loadParagraphs(ctx, false);
    let done = 0;
    const skipped: number[] = [];
    for (const it of list) {
      const p = items[toInt(it?.index, -1)];
      if (!p || typeof it?.text !== "string") {
        skipped.push(toInt(it?.index, -1));
        continue;
      }
      if (p.tableNestingLevel > 0 && /\n/.test(it.text)) {
        skipped.push(toInt(it.index, -1)); // a line break in a table cell paragraph would add paragraphs
        continue;
      }
      p.insertText(it.text.replace(/\r?\n/g, " "), "Replace");
      done++;
    }
    await ctx.sync();
    return { ok: true, changed: done, skipped };
  });
}

export async function setNumbering(a: Args): Promise<unknown> {
  requireHost("word");
  const style = String(a.style ?? "");
  if (!["bullet", "number", "none"].includes(style)) throw new Error('style phải là "bullet", "number" hoặc "none"');
  return Word.run(async (ctx) => {
    let targets: Word.Paragraph[];
    if (Array.isArray(a.indices) && a.indices.length) {
      const items = await loadParagraphs(ctx, false);
      targets = [...new Set<number>(a.indices.map((x: unknown) => toInt(x, -1)))]
        .sort((x, y) => x - y)
        .map((i) => items[i])
        .filter(Boolean);
    } else {
      const ps = ctx.document.getSelection().paragraphs;
      ps.load("items");
      await ctx.sync();
      targets = ps.items;
    }
    if (!targets.length) throw new Error("Không có đoạn nào để đánh dấu");
    if (style === "none") {
      targets.forEach((p) => p.detachFromList());
      await ctx.sync();
      return { ok: true, changed: targets.length };
    }
    const list = targets[0].startNewList();
    list.load("id");
    await ctx.sync();
    if (style === "bullet") list.setLevelBullet(0, Word.ListBullet.solid);
    else list.setLevelNumbering(0, Word.ListNumbering.arabic, [0, "."]);
    targets.slice(1).forEach((p) => p.attachToList(list.id, 0));
    await ctx.sync();
    return { ok: true, changed: targets.length, note: "Đánh số theo thứ tự trong vùng chọn; các đoạn rời nhau vẫn thuộc cùng một danh sách." };
  });
}

// ---------------------------------------------------------------------------------------------------- find & replace, comments

export async function findReplace(a: Args): Promise<unknown> {
  requireHost("word");
  const find = String(a.find ?? "");
  if (!find) throw new Error("Thiếu chuỗi cần tìm");
  if (find.length > 255) throw new Error("Chuỗi tìm tối đa 255 ký tự");
  const replace = String(a.replace ?? "");
  const max = Math.min(2000, Math.max(1, toInt(a.max, 500)));
  return Word.run(async (ctx) => {
    const scope = a.which === "selection" ? ctx.document.getSelection() : ctx.document.body;
    const found = scope.search(find, { matchCase: !!a.matchCase, matchWholeWord: !!a.wholeWord, matchWildcards: false });
    found.load("items");
    await ctx.sync();
    const n = found.items.length;
    found.items.slice(0, max).forEach((r) => r.insertText(replace, "Replace"));
    await ctx.sync();
    return { ok: true, found: n, replaced: Math.min(n, max), truncated: n > max };
  });
}

export async function highlight(a: Args): Promise<unknown> {
  requireHost("word");
  const texts: string[] = (Array.isArray(a.texts) ? a.texts : a.text ? [a.text] : []).map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 60);
  if (!texts.length) throw new Error("Cần texts: danh sách cụm từ/câu cần tô");
  const color = a.color === "none" ? null : String(a.color ?? "Yellow");
  const bold = a.bold === true;
  const fontColor = a.fontColor ? String(a.fontColor) : undefined;
  return Word.run(async (ctx) => {
    const scope = a.which === "selection" ? ctx.document.getSelection() : ctx.document.body;
    const hits = texts.map((t) => ({ t, r: scope.search(t.slice(0, 255), { matchCase: !!a.matchCase, matchWholeWord: false, matchWildcards: false }) }));
    hits.forEach((h) => h.r.load("items"));
    await ctx.sync();
    const report: { text: string; found: number }[] = [];
    for (const h of hits) {
      h.r.items.slice(0, 200).forEach((r) => {
        r.font.highlightColor = color as any;
        if (bold) r.font.bold = true;
        if (fontColor) r.font.color = fontColor;
      });
      report.push({ text: h.t.slice(0, 60), found: h.r.items.length });
    }
    await ctx.sync();
    return { ok: true, highlighted: report.filter((x) => x.found).length, notFound: report.filter((x) => !x.found).map((x) => x.text), detail: report };
  });
}

export async function addComment(a: Args): Promise<unknown> {
  requireHost("word");
  const text = String(a.text ?? "").trim();
  if (!text) throw new Error("Thiếu nội dung bình luận");
  return Word.run(async (ctx) => {
    let range: Word.Range;
    if (a.quote) {
      const q = String(a.quote).slice(0, 255);
      const hits = ctx.document.body.search(q, { matchCase: true });
      hits.load("items");
      await ctx.sync();
      if (!hits.items.length) return { ok: false, error: `Không tìm thấy đoạn "${q.slice(0, 40)}" để gắn bình luận` };
      range = hits.items[0];
    } else {
      range = ctx.document.getSelection();
    }
    range.insertComment(text);
    await ctx.sync();
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------------------------------- picture, header/footer, TOC, table

export async function insertImage(a: Args): Promise<unknown> {
  requireHost("word");
  const b64 = String(a.base64 ?? "");
  if (!b64) throw new Error("Thiếu ảnh: cần imageId hoặc base64");
  if (!String(a.altText ?? "").trim()) throw new Error("Cần altText mô tả ảnh");
  return Word.run(async (ctx) => {
    const loc = /^(start|end|replace)$/i.test(String(a.location)) ? (String(a.location)[0].toUpperCase() + String(a.location).slice(1).toLowerCase()) : "End";
    const pic =
      loc === "Replace"
        ? ctx.document.getSelection().insertInlinePictureFromBase64(b64, "Replace")
        : ctx.document.body.insertInlinePictureFromBase64(b64, loc === "Start" ? "Start" : "End");
    const want = Math.min(MAX_PICTURE_WIDTH, Math.max(40, toInt(a.width, 380)));
    const iw = Number(a.imageWidth) || 0;
    const ih = Number(a.imageHeight) || 0;
    pic.lockAspectRatio = true;
    pic.width = want;
    if (iw > 0 && ih > 0) pic.height = (want * ih) / iw;
    pic.altTextDescription = String(a.altText);
    pic.altTextTitle = String(a.altText).slice(0, 60);
    if (a.caption) {
      const par = pic.paragraph;
      par.alignment = "Centered";
      const cap = par.insertParagraph(String(a.caption), "After");
      cap.alignment = "Centered";
      cap.font.italic = true;
      cap.font.size = 11;
    }
    await ctx.sync();
    return { ok: true, width: want };
  });
}

export async function setHeaderFooter(a: Args): Promise<unknown> {
  requireHost("word");
  const align = /^(left|centered|right)$/i.test(String(a.alignment)) ? (String(a.alignment)[0].toUpperCase() + String(a.alignment).slice(1).toLowerCase()) : "Centered";
  const pageNumber = String(a.pageNumber ?? "none");
  return Word.run(async (ctx) => {
    const sec = ctx.document.sections.getFirst();
    const out: string[] = [];
    if (typeof a.header === "string") {
      const h = sec.getHeader("Primary");
      h.insertText(a.header, "Replace");
      h.paragraphs.getFirst().alignment = align as Word.Alignment;
      out.push("header");
    }
    if (typeof a.footer === "string") {
      const f = sec.getFooter("Primary");
      f.insertText(a.footer, "Replace");
      f.paragraphs.getFirst().alignment = align as Word.Alignment;
      out.push("footer");
    }
    await ctx.sync();
    if (pageNumber !== "none") {
      const inHeader = pageNumber.startsWith("header");
      const body = inHeader ? sec.getHeader("Primary") : sec.getFooter("Primary");
      const where = pageNumber.endsWith("right") ? "Right" : "Centered";
      const paragraph = body.paragraphs.getLast();
      const hasText = (inHeader ? typeof a.header === "string" : typeof a.footer === "string") && String(inHeader ? a.header : a.footer).trim();
      const target = hasText ? body.insertParagraph("", "End") : paragraph;
      target.alignment = where as Word.Alignment;
      try {
        target.getRange("End").insertField("End", Word.FieldType.page);
        await ctx.sync();
        out.push("pageNumber");
      } catch (e) {
        return { ok: true, applied: out, warning: "Chưa chèn được số trang trên bản Word này: " + (e as Error).message };
      }
    }
    if (a.firstPageDifferent !== undefined) {
      try {
        (sec as any).pageSetup.differentFirstPageHeaderFooter = !!a.firstPageDifferent;
        await ctx.sync();
        out.push("firstPageDifferent");
      } catch {
        return { ok: true, applied: out, warning: "Bản Word này chưa hỗ trợ đặt trang đầu khác biệt." };
      }
    }
    return { ok: true, applied: out };
  });
}

export async function insertToc(a: Args): Promise<unknown> {
  requireHost("word");
  const levels = Math.min(3, Math.max(1, toInt(a.levels, 3)));
  const loc = String(a.location ?? "Start");
  return Word.run(async (ctx) => {
    let range: Word.Range;
    if (loc === "Selection") range = ctx.document.getSelection();
    else range = loc === "End" ? ctx.document.body.getRange("End") : ctx.document.body.getRange("Start");
    if (a.title) {
      const t = range.insertParagraph(String(a.title), loc === "End" ? "After" : "Before");
      t.style = "Normal";
      t.alignment = "Centered";
      t.font.bold = true;
      t.font.size = 14;
    }
    try {
      const where = loc === "End" ? "End" : loc === "Selection" ? "Replace" : "Start";
      range.insertField(where as Word.InsertLocation, Word.FieldType.toc, `\\o "1-${levels}" \\h \\z \\u`, true);
      await ctx.sync();
    } catch (e) {
      return { ok: false, error: "Word này chưa cho chèn mục lục tự động: " + (e as Error).message + ". Hãy dùng References > Table of Contents." };
    }
    return { ok: true, note: "Mục lục lấy từ các đoạn có kiểu Heading 1-" + levels + "; bấm chuột phải > Update Field để cập nhật số trang." };
  });
}

export async function formatTable(a: Args): Promise<unknown> {
  requireHost("word");
  return Word.run(async (ctx) => {
    const tables = ctx.document.body.tables;
    tables.load("items");
    await ctx.sync();
    if (!tables.items.length) throw new Error("Tài liệu chưa có bảng");
    const idx = a.tableIndex === undefined ? tables.items.length - 1 : toInt(a.tableIndex, -1);
    const t = tables.items[idx];
    if (!t) throw new Error(`Không có bảng số ${idx} (có ${tables.items.length} bảng, đánh số từ 0)`);
    if (a.style) t.style = String(a.style);
    if (a.fontSize) t.font.size = Number(a.fontSize);
    if (a.alignment) t.alignment = String(a.alignment) as Word.Alignment;
    t.headerRowCount = 1;
    const head = t.rows.getFirst();
    if (a.headerFill) head.shadingColor = String(a.headerFill);
    if (a.headerFontColor) head.font.color = String(a.headerFontColor);
    head.font.bold = a.headerBold !== false;
    await ctx.sync();
    return { ok: true, tableIndex: idx };
  });
}

export const wordExtraTools: Record<string, (a: Args) => Promise<unknown>> = {
  office_word_insert_image: insertImage,
  office_word_set_header_footer: setHeaderFooter,
  office_word_insert_toc: insertToc,
  office_word_add_comment: addComment,
  office_word_find_replace: findReplace,
  office_word_highlight: highlight,
  office_word_set_numbering: setNumbering,
  office_word_get_outline: getOutline,
  office_word_apply_style_by_index: applyStyleByIndex,
  office_word_set_paragraph_text: setParagraphText,
  office_word_format_table: formatTable,
  office_word_get_lint: getLint,
};
