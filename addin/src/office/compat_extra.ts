/**
 * Fallback implementations of five tools that the bridge advertises (TOOLS table) but that this branch's tools.ts does not
 * implement: office_word_get_page_setup, office_word_set_page_setup, office_word_apply_style, office_excel_design_table,
 * office_ppt_apply_palette. Several skills call them.
 *
 * extra.ts spreads these FIRST in the tools table, so an implementation of the same name written in tools.ts always wins.
 * NOT run against real Office in the build sandbox.
 */
import { requireHost } from "./host";
import { builtinStyle } from "./word_logic";
import { normHex, readableOn } from "./ppt_logic";
import { parseCell } from "./excel_logic";

type Args = Record<string, any>;
const pt = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

// ------------------------------------------------------------------------------------------------ Word

export async function getPageSetup(): Promise<unknown> {
  requireHost("word");
  return Word.run(async (ctx) => {
    const ps = ctx.document.sections.getFirst().pageSetup;
    ps.load("topMargin,bottomMargin,leftMargin,rightMargin,orientation,paperSize,pageWidth,pageHeight,headerDistance,footerDistance,verticalAlignment");
    await ctx.sync();
    return {
      unit: "pt",
      topMargin: ps.topMargin, bottomMargin: ps.bottomMargin, leftMargin: ps.leftMargin, rightMargin: ps.rightMargin,
      orientation: ps.orientation, paperSize: ps.paperSize, pageWidth: ps.pageWidth, pageHeight: ps.pageHeight,
      headerDistance: ps.headerDistance, footerDistance: ps.footerDistance, verticalAlignment: ps.verticalAlignment,
    };
  });
}

export async function setPageSetup(a: Args): Promise<unknown> {
  requireHost("word");
  return Word.run(async (ctx) => {
    const sections = ctx.document.sections;
    sections.load("items");
    await ctx.sync();
    const changed: string[] = [];
    for (const sec of sections.items) {
      const ps = sec.pageSetup;
      if (a.paperSize) ps.paperSize = String(a.paperSize) as Word.PaperSize; // set the paper first: it resets the width and height
      if (a.orientation) ps.orientation = a.orientation === "Landscape" ? "Landscape" : "Portrait";
      for (const k of ["topMargin", "bottomMargin", "leftMargin", "rightMargin", "headerDistance", "footerDistance"] as const) {
        const v = pt(a[k]);
        if (v !== undefined) ps[k] = v;
      }
      if (a.verticalAlignment) ps.verticalAlignment = String(a.verticalAlignment) as Word.PageSetupVerticalAlignment;
    }
    await ctx.sync();
    for (const k of ["paperSize", "orientation", "topMargin", "bottomMargin", "leftMargin", "rightMargin", "headerDistance", "footerDistance", "verticalAlignment"]) if (a[k] !== undefined) changed.push(k);
    return { ok: true, sections: sections.items.length, changed };
  });
}

export async function applyStyle(a: Args): Promise<unknown> {
  requireHost("word");
  const name = String(a.style ?? "").trim();
  if (!name) throw new Error("Thiếu tên kiểu (style)");
  return Word.run(async (ctx) => {
    const paras = a.which === "document" ? ctx.document.body.paragraphs : ctx.document.getSelection().paragraphs;
    paras.load("items");
    await ctx.sync();
    const b = builtinStyle(name);
    for (const p of paras.items) {
      if (b) p.styleBuiltIn = (Word.Style as any)[b[0].toLowerCase() + b.slice(1)] ?? (Word.Style as any)[b] ?? b;
      else p.style = name;
    }
    await ctx.sync();
    return { ok: true, paragraphs: paras.items.length };
  });
}

// ------------------------------------------------------------------------------------------------ Excel

export async function designTable(a: Args): Promise<unknown> {
  requireHost("excel");
  return Excel.run(async (ctx) => {
    const r = a.address ? ctx.workbook.worksheets.getActiveWorksheet().getRange(String(a.address)) : ctx.workbook.getSelectedRange();
    r.load("address,rowCount,columnCount");
    await ctx.sync();
    if (a.address) String(a.address).split(":").forEach((x) => parseCell(x.replace(/^.*!/, "")));
    const header = a.header !== false;
    if (header) {
      const h = r.getRow(0);
      h.format.fill.color = normHex(a.headerFill, "#1F4E78");
      h.format.font.color = normHex(a.headerFontColor, "#FFFFFF");
      h.format.font.bold = true;
      h.format.verticalAlignment = "Center";
    }
    if (a.banded !== false && r.rowCount > (header ? 2 : 1)) {
      const band = normHex(a.bandFill, "#F2F6FA");
      for (let i = header ? 2 : 1; i < r.rowCount; i += 2) r.getRow(i).format.fill.color = band;
    }
    if (a.borders !== false) {
      const color = normHex(a.borderColor, "#BFBFBF");
      for (const edge of ["EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight", "InsideHorizontal", "InsideVertical"] as const) {
        const b = r.format.borders.getItem(edge);
        b.style = "Continuous";
        b.color = color;
      }
    }
    if (a.autoFit !== false) r.format.autofitColumns();
    await ctx.sync();
    return { ok: true, range: r.address };
  });
}

// ------------------------------------------------------------------------------------------------ PowerPoint

export async function applyPalette(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  return PowerPoint.run(async (ctx) => {
    let slides: PowerPoint.Slide[];
    const scope = a.scope ?? (a.slideIndex !== undefined ? "slide" : "presentation");
    if (scope === "selection") {
      const sel = ctx.presentation.getSelectedSlides();
      sel.load("items");
      await ctx.sync();
      slides = sel.items;
    } else if (scope === "slide") {
      slides = [ctx.presentation.slides.getItemAt(Math.trunc(Number(a.slideIndex ?? 0)))];
    } else {
      ctx.presentation.slides.load("items");
      await ctx.sync();
      slides = ctx.presentation.slides.items;
    }
    const shapeSets = slides.map((s) => {
      s.shapes.load("items/id,items/name,items/type,items/height,items/top");
      return s.shapes;
    });
    await ctx.sync();
    let touched = 0;
    for (let i = 0; i < slides.length; i++) {
      const items = shapeSets[i].items.filter((s) => !/^Hermes-(GhiChu|BinhLuan)/.test(s.name) && s.top < 600);
      const textual = items.filter((s) => /TextBox|GeometricShape|Placeholder/i.test(String(s.type)));
      textual.forEach((s) => {
        s.textFrame.textRange.load("text");
        s.textFrame.textRange.font.load("size");
      });
      try {
        await ctx.sync();
      } catch {
        /* some shapes have no text frame; the rest still load */
      }
      const withText = textual.filter((s) => {
        try {
          return !!s.textFrame.textRange.text?.trim();
        } catch {
          return false;
        }
      });
      const size = (s: PowerPoint.Shape) => {
        try {
          return s.textFrame.textRange.font.size ?? 0;
        } catch {
          return 0;
        }
      };
      const title = withText.reduce<PowerPoint.Shape | undefined>((best, s) => (!best || size(s) > size(best) ? s : best), undefined);
      if (a.backgroundColor) slides[i].background.fill.setSolidFill({ color: normHex(a.backgroundColor, "#FFFFFF") });
      const bg = a.backgroundColor ? normHex(a.backgroundColor, "#FFFFFF") : "#FFFFFF";
      for (const s of withText) {
        const want = s === title ? a.titleColor : a.bodyColor;
        if (want) {
          s.textFrame.textRange.font.color = readableOn(bg, normHex(want, "#000000"));
          touched++;
        }
      }
      if (a.accentColor) {
        for (const s of items.filter((x) => !withText.includes(x) && /GeometricShape/i.test(String(x.type)))) {
          s.fill.setSolidColor(normHex(a.accentColor, "#F59E0B"));
          touched++;
        }
      }
    }
    await ctx.sync();
    return { ok: true, slides: slides.length, shapesChanged: touched, note: "Màu chữ được tự điều chỉnh nếu độ tương phản với nền dưới 4,5:1." };
  });
}

export const compatTools: Record<string, (a: Args) => Promise<unknown>> = {
  office_word_get_page_setup: () => getPageSetup(),
  office_word_set_page_setup: setPageSetup,
  office_word_apply_style: applyStyle,
  office_excel_design_table: designTable,
  office_ppt_apply_palette: applyPalette,
};
