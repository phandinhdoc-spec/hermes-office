/**
 * Smart search + colour marking + comments for Word, Excel and PowerPoint (own file; pure rules in search_logic.ts).
 * NOT run against a real Office in the build sandbox. Undo is the taskpane's whole-document snapshot (snapshot.ts).
 *
 * Naming rule of the bridge: tools with `_list_` in the name only read; the others ask the user for approval.
 * Office.js has no comment API in PowerPoint, so PowerPoint comments are sticky-note shapes named "Hermes-BinhLuan-n".
 */
import { requireHost } from "./host";
import { cellAddress } from "./excel_logic";
import { headingLevel } from "./word_logic";
import { Query, Swatch, distinctMatches, matchMany, matchText, parseQuery, snippet, swatch } from "./search_logic";

type Args = Record<string, any>;

const toInt = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== "" && v !== null && v !== undefined ? Math.trunc(Number(v)) : d);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const CYCLE = ["yellow", "green", "blue", "pink", "orange", "red", "gray"];
const NOTE_PREFIX = "Hermes-BinhLuan";
const NOTE_BOX = "Hermes-GhiChu";
const MAX_CELLS = 250_000;

function queryFrom(a: Args, g: Args = a): Query {
  return parseQuery(String(g.query ?? ""), {
    mode: g.mode ?? a.mode,
    fuzzy: g.fuzzy ?? a.fuzzy,
    matchCase: g.matchCase ?? a.matchCase,
    wholeWord: g.wholeWord ?? a.wholeWord,
  });
}

interface Group {
  label: string;
  q: Query;
  sw: Swatch;
  comment: string;
  bold: boolean;
  fontColor?: string;
}

/** One group from the arguments themselves, or up to 8 colour-coded groups from `groups`. */
function groupsFrom(a: Args): Group[] {
  const multi = Array.isArray(a.groups) && a.groups.length > 0;
  const raw: Args[] = multi ? a.groups : [a];
  if (raw.length > 8) throw new Error("Tối đa 8 nhóm màu trong một lần");
  return raw.map((g, i) => ({
    label: String(g.label ?? g.query ?? "").slice(0, 60),
    q: queryFrom(a, g),
    sw: swatch(g.color ?? (multi ? undefined : a.color), CYCLE[i % CYCLE.length]),
    comment: String(g.comment ?? "").trim(),
    bold: g.bold === true,
    fontColor: g.fontColor ? String(g.fontColor) : undefined,
  }));
}

const withMatch = (tpl: string, m: string) => tpl.replace(/\{match\}/g, m);

// ================================================================================================== Word

async function wordParas(ctx: Word.RequestContext): Promise<Word.Paragraph[]> {
  const p = ctx.document.body.paragraphs;
  p.load("items/text,items/style");
  await ctx.sync();
  return p.items;
}

export async function wordListMatches(a: Args): Promise<unknown> {
  requireHost("word");
  const q = queryFrom(a);
  const topK = clamp(toInt(a.top_k, 20), 1, 100);
  return Word.run(async (ctx) => {
    const paras = await wordParas(ctx);
    let section = "";
    const hits: { paragraph: number; score: number; section: string; snippet: string; matched: string[] }[] = [];
    paras.forEach((p, i) => {
      if (headingLevel(p.style) > 0 && p.text.trim()) section = p.text.trim().slice(0, 80);
      const h = matchText(p.text, q);
      if (h) hits.push({ paragraph: i, score: h.score, section, snippet: snippet(p.text, h.spans), matched: distinctMatches(h.spans, 5) });
    });
    if (a.order !== "document") hits.sort((x, y) => y.score - x.score || x.paragraph - y.paragraph);
    return {
      ok: true,
      paragraphsSearched: paras.length,
      totalParagraphsMatched: hits.length,
      shown: Math.min(hits.length, topK),
      truncated: hits.length > topK,
      hits: hits.slice(0, topK),
      note: hits.length ? "paragraph = số thứ tự đoạn (đếm từ 0, cùng cách đánh số với office_word_get_outline)." : "Không có đoạn nào khớp. Thử mode any, bỏ bớt từ, hoặc thêm từ đồng nghĩa bằng dấu | (ví dụ: học|hs).",
    };
  });
}

export async function wordMarkMatches(a: Args): Promise<unknown> {
  requireHost("word");
  const groups = groupsFrom(a);
  const max = clamp(toInt(a.max, 50), 1, 200);
  const commentMax = clamp(toInt(a.commentMax, 20), 0, 60);
  return Word.run(async (ctx) => {
    const paras = await wordParas(ctx);
    const plan = groups.map((g) => {
      const found: { p: Word.Paragraph; texts: string[]; searches: Word.RangeCollection[] }[] = [];
      let total = 0;
      paras.forEach((p) => {
        const h = matchText(p.text, g.q);
        if (!h) return;
        total++;
        if (found.length >= max) return;
        const texts = distinctMatches(h.spans, 6);
        if (!texts.length) return;
        const searches = texts.map((t) => {
          const r = p.search(t, { matchCase: true, matchWholeWord: false, matchWildcards: false });
          r.load("items");
          return r;
        });
        found.push({ p, texts, searches });
      });
      return { g, found, total };
    });
    await ctx.sync();
    const report = plan.map(({ g, found, total }) => {
      let ranges = 0;
      let commented = 0;
      for (const f of found) {
        let first = true;
        f.searches.forEach((s, k) => {
          s.items.forEach((r) => {
            r.font.highlightColor = g.sw.word as any;
            if (g.bold) r.font.bold = true;
            if (g.fontColor) r.font.color = g.fontColor;
            ranges++;
            if (first && g.comment && commented < commentMax) {
              r.insertComment(withMatch(g.comment, f.texts[k]));
              commented++;
              first = false;
            }
          });
        });
      }
      return { label: g.label, color: g.sw.word ?? "none", paragraphsMatched: total, paragraphsMarked: found.length, rangesMarked: ranges, comments: commented, truncated: total > found.length };
    });
    await ctx.sync();
    return { ok: true, groups: report };
  });
}

export async function wordListComments(a: Args): Promise<unknown> {
  requireHost("word");
  return Word.run(async (ctx) => {
    const cs = ctx.document.body.getComments();
    cs.load("items/id,items/content,items/authorName,items/resolved,items/creationDate");
    await ctx.sync();
    const ranges = cs.items.slice(0, 300).map((c) => {
      const r = c.getRange();
      r.load("text");
      return r;
    });
    await ctx.sync();
    const needle = a.contains ? String(a.contains).toLowerCase() : "";
    let list = cs.items.slice(0, 300).map((c, i) => ({
      id: c.id, author: c.authorName, text: c.content, resolved: c.resolved, date: c.creationDate ? new Date(c.creationDate).toISOString().slice(0, 10) : undefined, on: ranges[i].text.slice(0, 100),
    }));
    if (needle) list = list.filter((c) => (c.text + " " + c.on).toLowerCase().includes(needle));
    if (a.author) list = list.filter((c) => c.author.toLowerCase().includes(String(a.author).toLowerCase()));
    if (a.unresolvedOnly) list = list.filter((c) => !c.resolved);
    return { ok: true, total: cs.items.length, shown: list.length, comments: list };
  });
}

export async function wordDeleteComments(a: Args): Promise<unknown> {
  requireHost("word");
  const ids: string[] = Array.isArray(a.ids) ? a.ids.map(String) : [];
  if (!ids.length && !a.contains && !a.author && a.all !== true) throw new Error("Cần ids, contains, author hoặc all:true để chọn bình luận");
  const resolve = a.action === "resolve";
  return Word.run(async (ctx) => {
    const cs = ctx.document.body.getComments();
    cs.load("items/id,items/content,items/authorName");
    await ctx.sync();
    const needle = a.contains ? String(a.contains).toLowerCase() : "";
    const pick = cs.items.filter(
      (c) => a.all === true || ids.includes(c.id) || (needle && c.content.toLowerCase().includes(needle)) || (a.author && c.authorName.toLowerCase().includes(String(a.author).toLowerCase())),
    );
    pick.forEach((c) => (resolve ? (c.resolved = true) : c.delete()));
    await ctx.sync();
    return { ok: true, [resolve ? "resolved" : "deleted"]: pick.length };
  });
}

// ================================================================================================== Excel

interface XUnit {
  sheet: Excel.Worksheet;
  name: string;
  row0: number;
  col0: number;
  rows: number;
  cols: number;
  text: string[][];
}

async function excelUnits(ctx: Excel.RequestContext, a: Args): Promise<XUnit[]> {
  let sheets: Excel.Worksheet[];
  if (a.sheet === "all") {
    const ws = ctx.workbook.worksheets;
    ws.load("items/name");
    await ctx.sync();
    sheets = ws.items;
  } else {
    const s = a.sheet ? ctx.workbook.worksheets.getItem(String(a.sheet)) : ctx.workbook.worksheets.getActiveWorksheet();
    s.load("name");
    sheets = [s];
  }
  const ranges = sheets.map((s) => {
    const r = a.address ? s.getRange(String(a.address)) : s.getUsedRangeOrNullObject(true);
    r.load("isNullObject,text,rowIndex,columnIndex,rowCount,columnCount" + (a.inFormulas ? ",formulas" : ""));
    return r;
  });
  await ctx.sync();
  const units: XUnit[] = [];
  let cells = 0;
  sheets.forEach((s, i) => {
    const r = ranges[i];
    if (r.isNullObject) return;
    cells += r.rowCount * r.columnCount;
    if (cells > MAX_CELLS) throw new Error(`Vùng tìm quá lớn (hơn ${MAX_CELLS} ô); hãy chỉ định address hoặc sheet nhỏ hơn.`);
    const text = (r.text as string[][]).map((row, ri) =>
      row.map((t, ci) => {
        const f = a.inFormulas ? (r.formulas as any[][])[ri][ci] : null;
        return typeof f === "string" && f.startsWith("=") ? `${t} ${f}`.trim() : String(t ?? "");
      }),
    );
    units.push({ sheet: s, name: s.name, row0: r.rowIndex, col0: r.columnIndex, rows: r.rowCount, cols: r.columnCount, text });
  });
  return units;
}

interface XHit {
  u: XUnit;
  r: number; // row inside the unit
  cells: number[]; // columns inside the unit that matched
  score: number;
  snips: string[];
}

function excelSearch(units: XUnit[], q: Query, scope: "cell" | "row"): XHit[] {
  const hits: XHit[] = [];
  for (const u of units) {
    for (let r = 0; r < u.rows; r++) {
      const row = u.text[r];
      if (scope === "row") {
        const m = matchMany(row, q);
        if (!m) continue;
        const cols = m.scans.map((s, c) => (s.spans.length ? c : -1)).filter((c) => c >= 0);
        hits.push({ u, r, cells: cols, score: m.score, snips: cols.slice(0, 6).map((c) => snippet(row[c], m.scans[c].spans, 80)) });
      } else {
        for (let c = 0; c < u.cols; c++) {
          if (!row[c]) continue;
          const h = matchText(row[c], q);
          if (h) hits.push({ u, r, cells: [c], score: h.score, snips: [snippet(row[c], h.spans, 80)] });
        }
      }
    }
  }
  return hits;
}

const addrOf = (u: XUnit, r: number, c: number) => cellAddress(u.row0 + r, u.col0 + c);

export async function excelListMatches(a: Args): Promise<unknown> {
  requireHost("excel");
  const q = queryFrom(a);
  const scope = a.scope === "row" ? "row" : "cell";
  const topK = clamp(toInt(a.top_k, 30), 1, 100);
  return Excel.run(async (ctx) => {
    const units = await excelUnits(ctx, a);
    const hits = excelSearch(units, q, scope);
    if (a.order !== "sheet") hits.sort((x, y) => y.score - x.score);
    const shown = hits.slice(0, topK).map((h) => ({
      sheet: h.u.name,
      ...(scope === "row"
        ? { row: h.u.row0 + h.r + 1, cells: h.cells.slice(0, 8).map((c, i) => ({ address: addrOf(h.u, h.r, c), value: h.u.text[h.r][c].slice(0, 80), match: h.snips[i] })) }
        : { address: addrOf(h.u, h.r, h.cells[0]), value: h.snips[0], column: h.r > 0 ? h.u.text[0][h.cells[0]].slice(0, 40) || undefined : undefined }),
      score: h.score,
    }));
    return {
      ok: true, sheetsSearched: units.map((u) => u.name), scope, totalMatches: hits.length, shown: shown.length, truncated: hits.length > topK, hits: shown,
      note: hits.length ? undefined : "Không có ô nào khớp. Thử scope row (các từ nằm ở nhiều ô cùng dòng), mode any, hoặc từ đồng nghĩa bằng dấu |.",
    };
  });
}

async function addExcelComment(ctx: Excel.RequestContext, sheet: Excel.Worksheet, address: string, text: string, kind: string): Promise<string> {
  if (kind === "note") {
    sheet.notes.add(address, text);
    await ctx.sync();
    return "note";
  }
  try {
    sheet.comments.add(address, text);
    await ctx.sync();
    return "comment";
  } catch (e) {
    sheet.notes.add(address, text); // older Excel: comments API missing → plain note
    await ctx.sync();
    return "note";
  }
}

export async function excelMarkMatches(a: Args): Promise<unknown> {
  requireHost("excel");
  const groups = groupsFrom(a);
  const scope = a.scope === "row" ? "row" : "cell";
  const max = clamp(toInt(a.max, 300), 1, 1000);
  const commentMax = clamp(toInt(a.commentMax, 20), 0, 100);
  const kind = a.kind === "note" ? "note" : "comment";
  return Excel.run(async (ctx) => {
    const units = await excelUnits(ctx, a);
    const report: Record<string, unknown>[] = [];
    let commentsLeft = commentMax;
    for (const g of groups) {
      const hits = excelSearch(units, g.q, scope);
      const done = new Set<string>();
      const cellList: { u: XUnit; r: number; c: number }[] = [];
      for (const h of hits) {
        if (scope === "row" && a.wholeRow === true) {
          const k = `${h.u.name}!row${h.r}`;
          if (done.has(k)) continue;
          done.add(k);
          cellList.push({ u: h.u, r: h.r, c: -1 });
        } else {
          for (const c of h.cells) cellList.push({ u: h.u, r: h.r, c });
        }
      }
      const marked = cellList.slice(0, max);
      for (const m of marked) {
        const rng = m.c < 0 ? m.u.sheet.getRangeByIndexes(m.u.row0 + m.r, m.u.col0, 1, m.u.cols) : m.u.sheet.getRange(addrOf(m.u, m.r, m.c));
        if (g.sw.fill) rng.format.fill.color = g.sw.fill;
        else rng.format.fill.clear();
        if (g.bold) rng.format.font.bold = true;
        if (g.fontColor) rng.format.font.color = g.fontColor;
      }
      await ctx.sync();
      let commented = 0;
      let fallback = false;
      if (g.comment) {
        for (const m of marked) {
          if (commentsLeft <= 0) break;
          if (m.c < 0) continue;
          const txt = withMatch(g.comment, m.u.text[m.r][m.c].slice(0, 60));
          if ((await addExcelComment(ctx, m.u.sheet, addrOf(m.u, m.r, m.c), txt, kind)) !== kind) fallback = true;
          commented++;
          commentsLeft--;
        }
      }
      report.push({
        label: g.label, color: g.sw.fill ?? "none", matches: hits.length, cellsMarked: marked.length, comments: commented,
        truncated: cellList.length > marked.length, note: fallback ? "Excel này chưa có bình luận, đã dùng ghi chú (note)." : undefined,
      });
    }
    return { ok: true, groups: report };
  });
}

export async function excelAddComment(a: Args): Promise<unknown> {
  requireHost("excel");
  const text = String(a.text ?? "").trim();
  if (!text) throw new Error("Thiếu nội dung bình luận (text)");
  const addrs: string[] = (Array.isArray(a.addresses) ? a.addresses : [a.address]).map((x: unknown) => String(x ?? "").trim()).filter(Boolean).slice(0, 100);
  if (!addrs.length) throw new Error("Cần address (một ô như B3) hoặc addresses");
  if (addrs.some((x) => !/^\$?[A-Za-z]{1,3}\$?\d{1,7}$/.test(x))) throw new Error("Mỗi địa chỉ phải là một ô, ví dụ B3");
  return Excel.run(async (ctx) => {
    const sheet = a.sheet ? ctx.workbook.worksheets.getItem(String(a.sheet)) : ctx.workbook.worksheets.getActiveWorksheet();
    let used = a.kind === "note" ? "note" : "comment";
    for (const ad of addrs) used = await addExcelComment(ctx, sheet, ad, text, a.kind === "note" ? "note" : "comment");
    if (a.fill) {
      const sw = swatch(a.fill);
      for (const ad of addrs) sw.fill ? (sheet.getRange(ad).format.fill.color = sw.fill) : sheet.getRange(ad).format.fill.clear();
      await ctx.sync();
    }
    return { ok: true, added: addrs.length, kind: used };
  });
}

async function excelCommentRows(ctx: Excel.RequestContext, sheets: Excel.Worksheet[]) {
  const out: { sheet: string; kind: "comment" | "note"; address: string; author: string; text: string; resolved?: boolean; c: Excel.Comment | Excel.Note }[] = [];
  const cs = sheets.map((s) => {
    s.comments.load("items/content,items/authorName,items/resolved");
    return s;
  });
  await ctx.sync();
  const locs: { s: Excel.Worksheet; c: Excel.Comment; r: Excel.Range }[] = [];
  cs.forEach((s) =>
    s.comments.items.forEach((c) => {
      const r = c.getLocation();
      r.load("address");
      locs.push({ s, c, r });
    }),
  );
  await ctx.sync();
  const strip = (x: string) => x.replace(/^.*!/, "").replace(/\$/g, "");
  locs.forEach(({ s, c, r }) => out.push({ sheet: s.name, kind: "comment", address: strip(r.address), author: c.authorName, text: c.content, resolved: c.resolved, c }));
  try {
    sheets.forEach((s) => s.notes.load("items/content,items/authorName"));
    await ctx.sync();
    const nl: { s: Excel.Worksheet; n: Excel.Note; r: Excel.Range }[] = [];
    sheets.forEach((s) =>
      s.notes.items.forEach((n) => {
        const r = n.getLocation();
        r.load("address");
        nl.push({ s, n, r });
      }),
    );
    await ctx.sync();
    nl.forEach(({ s, n, r }) => out.push({ sheet: s.name, kind: "note", address: strip(r.address), author: n.authorName, text: n.content, c: n }));
  } catch {
    /* Excel without the notes API: comments only */
  }
  return out;
}

async function sheetsFor(ctx: Excel.RequestContext, a: Args): Promise<Excel.Worksheet[]> {
  if (a.sheet === "all") {
    const ws = ctx.workbook.worksheets;
    ws.load("items/name");
    await ctx.sync();
    return ws.items;
  }
  const s = a.sheet ? ctx.workbook.worksheets.getItem(String(a.sheet)) : ctx.workbook.worksheets.getActiveWorksheet();
  s.load("name");
  await ctx.sync();
  return [s];
}

export async function excelListComments(a: Args): Promise<unknown> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const rows = await excelCommentRows(ctx, await sheetsFor(ctx, a));
    const needle = a.contains ? String(a.contains).toLowerCase() : "";
    const list = rows.filter((r) => !needle || r.text.toLowerCase().includes(needle)).slice(0, 300);
    return { ok: true, total: rows.length, shown: list.length, comments: list.map(({ c, ...rest }) => rest) };
  });
}

export async function excelDeleteComments(a: Args): Promise<unknown> {
  requireHost("excel");
  if (!a.address && !a.contains && a.all !== true) throw new Error("Cần address, contains hoặc all:true để chọn bình luận");
  return Excel.run(async (ctx) => {
    const rows = await excelCommentRows(ctx, await sheetsFor(ctx, a));
    const addr = a.address ? String(a.address).replace(/\$/g, "").toUpperCase() : "";
    const needle = a.contains ? String(a.contains).toLowerCase() : "";
    const pick = rows.filter((r) => (a.all === true || (addr && r.address.toUpperCase() === addr) || (needle && r.text.toLowerCase().includes(needle))) && (!a.kind || a.kind === r.kind));
    pick.forEach((r) => r.c.delete());
    await ctx.sync();
    return { ok: true, deleted: pick.length };
  });
}

// ================================================================================================== PowerPoint

interface PUnit {
  slideIndex: number;
  slide: PowerPoint.Slide;
  shape: PowerPoint.Shape;
  id: string;
  name: string;
  text: string;
  notes: boolean;
  box: { left: number; top: number; width: number; height: number };
}

async function slideSize(ctx: PowerPoint.RequestContext): Promise<{ W: number; H: number }> {
  try {
    const ps = ctx.presentation.pageSetup;
    ps.load("slideWidth,slideHeight");
    await ctx.sync();
    if (ps.slideWidth > 0 && ps.slideHeight > 0) return { W: ps.slideWidth, H: ps.slideHeight };
  } catch {
    /* older PowerPoint: assume 16:9 */
  }
  return { W: 960, H: 540 };
}

async function pptSlides(ctx: PowerPoint.RequestContext, only?: unknown): Promise<{ slide: PowerPoint.Slide; index: number }[]> {
  const slides = ctx.presentation.slides;
  slides.load("items/id");
  await ctx.sync();
  const all = slides.items.map((slide, index) => ({ slide, index }));
  if (only === undefined || only === null || only === "") return all;
  const i = toInt(only, -1);
  if (i < 0 || i >= all.length) throw new Error(`Không có slide số ${i} (có ${all.length} slide, đánh số từ 0)`);
  return [all[i]];
}

/** Every text shape of the chosen slides, with its text. The speaker-note box of Hermes counts as notes; sticky notes are skipped. */
async function pptUnits(ctx: PowerPoint.RequestContext, only?: unknown): Promise<{ units: PUnit[]; stickies: PUnit[] }> {
  const slides = await pptSlides(ctx, only);
  slides.forEach(({ slide }) => slide.shapes.load("items/id,items/name,items/type,items/left,items/top,items/width,items/height,items/altTextDescription"));
  await ctx.sync();
  const cand: { idx: number; slide: PowerPoint.Slide; s: PowerPoint.Shape }[] = [];
  slides.forEach(({ slide, index }) => slide.shapes.items.forEach((s) => cand.push({ idx: index, slide, s })));
  const textual = cand.filter((c) => /TextBox|GeometricShape|Placeholder/i.test(String(c.s.type)));
  textual.forEach((c) => c.s.textFrame.textRange.load("text"));
  try {
    await ctx.sync();
  } catch {
    for (const c of textual) {
      try {
        c.s.textFrame.textRange.load("text");
        await ctx.sync();
      } catch {
        /* a shape without a text frame */
      }
    }
  }
  const units: PUnit[] = [];
  const stickies: PUnit[] = [];
  for (const c of textual) {
    let text = "";
    try {
      text = c.s.textFrame.textRange.text ?? "";
    } catch {
      continue;
    }
    const u: PUnit = {
      slideIndex: c.idx, slide: c.slide, shape: c.s, id: c.s.id, name: c.s.name, text, notes: c.s.name === NOTE_BOX,
      box: { left: c.s.left, top: c.s.top, width: c.s.width, height: c.s.height },
    };
    if (c.s.name.startsWith(NOTE_PREFIX)) stickies.push(u);
    else if (text.trim()) units.push(u);
  }
  return { units, stickies };
}

export async function pptListMatches(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  const q = queryFrom(a);
  const topK = clamp(toInt(a.top_k, 20), 1, 100);
  const where = a.where === "notes" || a.where === "slides" ? a.where : "all";
  return PowerPoint.run(async (ctx) => {
    const { units } = await pptUnits(ctx, a.slideIndex);
    const hits: Record<string, unknown>[] = [];
    for (const u of units) {
      if ((where === "notes" && !u.notes) || (where === "slides" && u.notes)) continue;
      const h = matchText(u.text, q);
      if (h) hits.push({ slideIndex: u.slideIndex, slideNumber: u.slideIndex + 1, shapeId: u.id, shapeName: u.name, in: u.notes ? "notes" : "slide", score: h.score, snippet: snippet(u.text, h.spans, 140) });
    }
    if (a.order !== "slide") hits.sort((x, y) => (y.score as number) - (x.score as number));
    return {
      ok: true, shapesSearched: units.length, totalMatches: hits.length, shown: Math.min(hits.length, topK), truncated: hits.length > topK, hits: hits.slice(0, topK),
      note: "Chỉ tìm trong hộp chữ; chữ trong bảng, nhóm hình, biểu đồ chưa được quét." + (hits.length ? "" : " Không có kết quả: thử mode any hoặc từ đồng nghĩa bằng dấu |."),
    };
  });
}

type Placement = "margin" | "onslide";

function stickyHeight(text: string): number {
  return clamp(30 + Math.ceil(text.length / 34) * 16, 50, 230);
}

function addSticky(
  slide: PowerPoint.Slide, text: string, sw: Swatch, o: { anchor?: PUnit["box"]; anchorId?: string; placement: Placement; W: number; H: number; author: string; taken: { top: number; height: number }[]; n: number },
): void {
  const width = 260;
  const height = stickyHeight(text);
  let left: number;
  let top = o.anchor ? o.anchor.top : 16;
  if (o.placement === "margin") left = o.W + 24;
  else left = o.anchor ? clamp(o.anchor.left + o.anchor.width - 60, 0, o.W - width - 8) : o.W - width - 12;
  top = clamp(top, 0, Math.max(0, o.H - height));
  const clash = (t: number) => o.taken.some((x) => t < x.top + x.height + 6 && t + height + 6 > x.top);
  for (let guard = 0; clash(top) && guard < 40; guard++) top += 20;
  if (o.placement === "onslide") top = Math.min(top, Math.max(0, o.H - height));
  o.taken.push({ top, height });
  const box = slide.shapes.addGeometricShape("Rectangle", { left, top, width, height });
  box.name = `${NOTE_PREFIX}-${o.n}`;
  box.fill.setSolidColor(sw.fill ?? "#FFF2A8");
  box.lineFormat.color = sw.strong ?? "#C79100";
  box.lineFormat.weight = 1;
  const tf = box.textFrame;
  tf.wordWrap = true;
  tf.autoSizeSetting = "AutoSizeNone";
  tf.verticalAlignment = "Top";
  tf.textRange.text = text;
  tf.textRange.font.size = 12;
  tf.textRange.font.color = "#222222";
  tf.textRange.font.bold = false;
  box.altTextDescription = `Bình luận của Hermes|anchor=${o.anchorId ?? ""}|by=${o.author}|at=${new Date().toISOString().slice(0, 10)}`;
}

export async function pptMarkMatches(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  const groups = groupsFrom(a);
  const how = ["text", "outline", "fill", "both"].includes(a.how) ? (a.how as string) : "text";
  const placement: Placement = a.placement === "onslide" ? "onslide" : "margin";
  const max = clamp(toInt(a.max, 60), 1, 200);
  const author = String(a.author ?? "Hermes").slice(0, 30);
  if (groups.some((g) => g.sw.strong === null)) throw new Error("PowerPoint không xóa được màu đã tô (không biết màu cũ). Dùng Hoàn tác (undo) của khung Hermes, hoặc tô lại bằng màu khác.");
  return PowerPoint.run(async (ctx) => {
    const { units, stickies } = await pptUnits(ctx, a.slideIndex);
    const { W, H } = await slideSize(ctx);
    const counters = new Map<number, number>();
    const taken = new Map<number, { top: number; height: number }[]>();
    stickies.forEach((s) => {
      counters.set(s.slideIndex, Math.max(counters.get(s.slideIndex) ?? 0, toInt(s.name.split("-").pop(), 0)));
      if (s.box.left >= W) (taken.get(s.slideIndex) ?? taken.set(s.slideIndex, []).get(s.slideIndex)!).push({ top: s.box.top, height: s.box.height });
    });
    const report: Record<string, unknown>[] = [];
    for (const g of groups) {
      let shapes = 0;
      let spansMarked = 0;
      let notes = 0;
      let total = 0;
      for (const u of units) {
        if (u.notes) continue;
        const h = matchText(u.text, g.q);
        if (!h) continue;
        total++;
        if (shapes >= max) continue;
        shapes++;
        const sw = g.sw;
        if (how === "text" || how === "both") {
          h.spans.slice(0, 60).forEach((sp) => {
            const f = u.shape.textFrame.textRange.getSubstring(sp.start, sp.end - sp.start).font;
            f.color = g.fontColor ?? sw.strong!;
            f.bold = true;
            spansMarked++;
          });
        }
        if (how === "outline" || how === "both") {
          u.shape.lineFormat.visible = true;
          u.shape.lineFormat.color = sw.strong!;
          u.shape.lineFormat.weight = 3;
        }
        if (how === "fill") u.shape.fill.setSolidColor(sw.fill!);
        if (g.comment) {
          const n = (counters.get(u.slideIndex) ?? 0) + 1;
          counters.set(u.slideIndex, n);
          const list = taken.get(u.slideIndex) ?? taken.set(u.slideIndex, []).get(u.slideIndex)!;
          addSticky(u.slide, withMatch(g.comment, h.spans[0]?.text ?? ""), sw, { anchor: u.box, anchorId: u.id, placement, W, H, author, taken: list, n });
          notes++;
        }
      }
      await ctx.sync();
      report.push({ label: g.label, color: g.sw.strong, how, shapesMatched: total, shapesMarked: shapes, textRangesColoured: spansMarked, comments: notes, truncated: total > shapes });
    }
    return {
      ok: true, groups: report,
      note: notes0(report) ? (placement === "margin" ? "Bình luận nằm ở lề phải ngoài trang chiếu (không hiện khi chiếu/in); xem bằng cách thu nhỏ khung nhìn." : "Bình luận nằm trên trang chiếu; xóa bằng office_ppt_delete_comments trước khi trình chiếu.") : undefined,
    };
  });
}

const notes0 = (r: Record<string, unknown>[]) => r.some((x) => (x.comments as number) > 0);

export async function pptAddComment(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  const text = String(a.text ?? "").trim();
  if (!text) throw new Error("Thiếu nội dung bình luận (text)");
  const placement: Placement = a.placement === "onslide" ? "onslide" : "margin";
  const sw = swatch(a.color, "yellow");
  if (sw.strong === null) throw new Error("color không được là none");
  const author = String(a.author ?? "Hermes").slice(0, 30);
  return PowerPoint.run(async (ctx) => {
    let target: { slide: PowerPoint.Slide; index: number };
    if (a.slideIndex === undefined || a.slideIndex === null || a.slideIndex === "") {
      const sel = ctx.presentation.getSelectedSlides();
      sel.load("items/id");
      const all = await pptSlides(ctx);
      await ctx.sync();
      const id = sel.items[0]?.id;
      target = (id ? all.find((x) => x.slide.id === id) : undefined) ?? all[all.length - 1];
      if (!target) throw new Error("Bộ trình chiếu chưa có slide nào");
    } else target = (await pptSlides(ctx, a.slideIndex))[0];
    const { units, stickies } = await pptUnits(ctx, target.index);
    const { W, H } = await slideSize(ctx);
    let anchor: PUnit | undefined;
    if (a.shapeId !== undefined && a.shapeId !== null && a.shapeId !== "") {
      anchor = units.find((u) => u.id === String(a.shapeId));
      if (!anchor) throw new Error(`Không thấy hình ${a.shapeId} trên slide ${target.index} (lấy shapeId từ office_ppt_list_shapes)`);
    }
    const n = stickies.reduce((m, s) => Math.max(m, toInt(s.name.split("-").pop(), 0)), 0) + 1;
    const taken = stickies.filter((s) => s.box.left >= W).map((s) => ({ top: s.box.top, height: s.box.height }));
    addSticky(target.slide, text, sw, { anchor: anchor?.box, anchorId: anchor?.id, placement, W, H, author, taken, n });
    if (anchor && a.markAnchor !== false) {
      anchor.shape.lineFormat.visible = true;
      anchor.shape.lineFormat.color = sw.strong!;
      anchor.shape.lineFormat.weight = 2.5;
    }
    await ctx.sync();
    return {
      ok: true, slideIndex: target.index, name: `${NOTE_PREFIX}-${n}`, placement,
      note: placement === "margin" ? "PowerPoint chưa có API bình luận: ghi chú là một khung màu nằm ở lề phải ngoài trang chiếu (không hiện khi chiếu/in)." : "Khung ghi chú nằm trên trang chiếu; xóa trước khi trình chiếu.",
    };
  });
}

export async function pptListComments(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  return PowerPoint.run(async (ctx) => {
    const { stickies } = await pptUnits(ctx, a.slideIndex);
    const needle = a.contains ? String(a.contains).toLowerCase() : "";
    const list = stickies
      .filter((s) => !needle || s.text.toLowerCase().includes(needle))
      .slice(0, 300)
      .map((s) => ({ slideIndex: s.slideIndex, slideNumber: s.slideIndex + 1, id: s.id, name: s.name, text: s.text, onSlide: s.box.left < 900 }));
    return { ok: true, total: stickies.length, shown: list.length, comments: list };
  });
}

export async function pptDeleteComments(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  const ids: string[] = Array.isArray(a.ids) ? a.ids.map(String) : [];
  if (!ids.length && !a.contains && a.all !== true && (a.slideIndex === undefined || a.slideIndex === "")) throw new Error("Cần ids, contains, slideIndex hoặc all:true để chọn bình luận");
  return PowerPoint.run(async (ctx) => {
    const { stickies } = await pptUnits(ctx, a.slideIndex);
    const needle = a.contains ? String(a.contains).toLowerCase() : "";
    const pick = stickies.filter((s) => a.all === true || ids.includes(s.id) || (needle && s.text.toLowerCase().includes(needle)) || (a.slideIndex !== undefined && a.slideIndex !== "" && !ids.length && !needle));
    pick.forEach((s) => s.shape.delete());
    await ctx.sync();
    return { ok: true, deleted: pick.length, note: "Màu chữ/viền đã tô trên hình không bị xóa; dùng Hoàn tác nếu cần." };
  });
}

export const annotTools: Record<string, (a: Args) => Promise<unknown>> = {
  office_word_list_matches: wordListMatches,
  office_word_mark_matches: wordMarkMatches,
  office_word_list_comments: wordListComments,
  office_word_delete_comments: wordDeleteComments,
  office_excel_list_matches: excelListMatches,
  office_excel_mark_matches: excelMarkMatches,
  office_excel_add_comment: excelAddComment,
  office_excel_list_comments: excelListComments,
  office_excel_delete_comments: excelDeleteComments,
  office_ppt_list_matches: pptListMatches,
  office_ppt_mark_matches: pptMarkMatches,
  office_ppt_add_comment: pptAddComment,
  office_ppt_list_comments: pptListComments,
  office_ppt_delete_comments: pptDeleteComments,
};
