import { requireHost } from "./host";
import { equationToOoxml, hasMath, textToOoxml } from "./equation";

type Loc = "Start" | "End" | "Replace";

/** Insert `text` at `range`; text containing $..$, $$..$$, \(..\), \[..\] or bare LaTeX becomes native Word equations. */
async function put(range: Word.Range | Word.Body | Word.Paragraph, text: string, loc: Word.InsertLocation, ctx: Word.RequestContext): Promise<void> {
  if (hasMath(text)) {
    try {
      range.insertOoxml(textToOoxml(text), loc as any);
      await ctx.sync();
      return;
    } catch (err) {
      console.warn("insertOoxml failed, falling back to plain text", err);
    }
  }
  range.insertText(text, loc as any);
  await ctx.sync();
}

export async function getSelection(): Promise<string> {
  requireHost("word");
  return Word.run(async (ctx) => {
    const sel = ctx.document.getSelection();
    sel.load("text");
    await ctx.sync();
    return sel.text;
  });
}

export async function replaceSelection(text: string): Promise<void> {
  requireHost("word");
  await Word.run(async (ctx) => {
    await put(ctx.document.getSelection(), text, Word.InsertLocation.replace, ctx);
  });
}

/** Whole-body text; `getRange` in Word terms. */
/** Long documents: cap what one read sends to the model. */
const MAX_READ_CHARS = 60000;

export async function getRange(which: "whole" | "selection" = "whole"): Promise<string> {
  requireHost("word");
  return Word.run(async (ctx) => {
    const range = which === "whole" ? ctx.document.body.getRange("Whole") : ctx.document.getSelection();
    range.load("text");
    await ctx.sync();
    const t = range.text;
    if (which === "whole" && t.length > MAX_READ_CHARS) {
      return t.slice(0, MAX_READ_CHARS) + `\n\n[... cut: ${t.length} characters in total, only the first ${MAX_READ_CHARS} are shown. Work on the selection or ask the user which part to open.]`;
    }
    return t;
  });
}

/** Replace the whole body (or the selection) with `text`; `setRange` in Word terms. */
export async function setRange(text: string, which: "whole" | "selection" = "whole"): Promise<void> {
  requireHost("word");
  await Word.run(async (ctx) => {
    const range = which === "whole" ? ctx.document.body.getRange("Whole") : ctx.document.getSelection();
    await put(range, text, Word.InsertLocation.replace, ctx);
  });
}

export async function insertText(text: string, location: "Start" | "End" = "End"): Promise<void> {
  requireHost("word");
  await Word.run(async (ctx) => {
    await put(ctx.document.body, text, location === "Start" ? Word.InsertLocation.start : Word.InsertLocation.end, ctx);
  });
}

/** Insert one LaTeX formula (math, physics, or chemistry such as `\ce{CaCO3 -> CaO + CO2}`) as a native Word equation. */
export async function insertEquation(latex: string, location: Loc = "End"): Promise<void> {
  requireHost("word");
  if (!latex.trim()) throw new Error("latex must be non-empty");
  await Word.run(async (ctx) => {
    const target = location === "Replace" ? ctx.document.getSelection() : ctx.document.body;
    const loc = location === "Start" ? Word.InsertLocation.start : location === "End" ? Word.InsertLocation.end : Word.InsertLocation.replace;
    target.insertOoxml(equationToOoxml(latex), loc as any);
    await ctx.sync();
  });
}

export async function insertTable(values: string[][]): Promise<void> {
  requireHost("word");
  if (!values.length) throw new Error("values must be a non-empty 2D array");
  await Word.run(async (ctx) => {
    const sel = ctx.document.getSelection();
    sel.insertTable(values.length, Math.max(...values.map((r) => r.length)), Word.InsertLocation.after, values);
    await ctx.sync();
  });
}

/** Paragraph containing the selection start (the "current line" when nothing is selected). */
export async function getParagraph(): Promise<string> {
  requireHost("word");
  return Word.run(async (ctx) => {
    const p = ctx.document.getSelection().paragraphs.getFirst();
    p.load("text");
    await ctx.sync();
    return p.text;
  });
}

export async function replaceParagraph(text: string): Promise<void> {
  requireHost("word");
  await Word.run(async (ctx) => {
    await put(ctx.document.getSelection().paragraphs.getFirst(), text, Word.InsertLocation.replace, ctx);
  });
}

export interface WordFormat {
  fontName?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  alignment?: string;
  lineSpacing?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  firstLineIndent?: number;
  leftIndent?: number;
}

/** Font and paragraph formatting of the selection (or the first paragraph of the body when `which` is "document"). */
export async function getStyles(which: "selection" | "document" = "selection"): Promise<Record<string, unknown>> {
  requireHost("word");
  return Word.run(async (ctx) => {
    const range = which === "document" ? ctx.document.body.getRange("Start") : ctx.document.getSelection();
    const p = range.paragraphs.getFirst();
    range.load("font/name,font/size,font/bold,font/italic,font/color");
    p.load("style,alignment,lineSpacing,spaceBefore,spaceAfter,firstLineIndent,leftIndent");
    const sections = ctx.document.sections;
    sections.load("items");
    await ctx.sync();
    const f = range.font;
    return {
      scope: which,
      font: { name: f.name, size: f.size, bold: f.bold, italic: f.italic, color: f.color },
      paragraph: {
        style: p.style,
        alignment: p.alignment,
        lineSpacing: p.lineSpacing,
        spaceBefore: p.spaceBefore,
        spaceAfter: p.spaceAfter,
        firstLineIndent: p.firstLineIndent,
        leftIndent: p.leftIndent,
      },
    };
  });
}

/** Apply font/paragraph formatting to the selection, or to the whole body when `which` is "document". */
export async function applyFormat(fmt: WordFormat, which: "selection" | "document" = "selection"): Promise<void> {
  requireHost("word");
  await Word.run(async (ctx) => {
    const range = which === "document" ? ctx.document.body.getRange("Whole") : ctx.document.getSelection();
    if (fmt.fontName !== undefined) range.font.name = fmt.fontName;
    if (fmt.fontSize !== undefined) range.font.size = fmt.fontSize;
    if (fmt.bold !== undefined) range.font.bold = fmt.bold;
    if (fmt.italic !== undefined) range.font.italic = fmt.italic;
    if (fmt.color !== undefined) range.font.color = fmt.color;
    const paras = range.paragraphs;
    paras.load("items");
    await ctx.sync();
    for (const p of paras.items) {
      if (fmt.alignment !== undefined) p.alignment = fmt.alignment as Word.Alignment;
      if (fmt.lineSpacing !== undefined) p.lineSpacing = fmt.lineSpacing;
      if (fmt.spaceBefore !== undefined) p.spaceBefore = fmt.spaceBefore;
      if (fmt.spaceAfter !== undefined) p.spaceAfter = fmt.spaceAfter;
      if (fmt.firstLineIndent !== undefined) p.firstLineIndent = fmt.firstLineIndent;
      if (fmt.leftIndent !== undefined) p.leftIndent = fmt.leftIndent;
    }
    await ctx.sync();
  });
}
