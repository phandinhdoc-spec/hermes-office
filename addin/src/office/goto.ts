import { currentHost } from "./host";

/** Jump to a place Hermes cited: Word = quoted text, Excel = `Sheet!A1`, PowerPoint = slide number (1-based). */
export async function gotoRef(kind: string, target: string): Promise<void> {
  const host = currentHost();
  const k = kind.trim().toLowerCase();
  const t = target.trim().replace(/^["“'«]|["”'»]$/g, "");
  if (host === "word" && (k === "word" || k === "doc")) {
    await Word.run(async (ctx) => {
      const hit = ctx.document.body.search(t.slice(0, 250), { matchCase: false });
      hit.load("items");
      await ctx.sync();
      if (!hit.items.length) throw new Error("text not found");
      hit.items[0].select();
      await ctx.sync();
    });
  } else if (host === "excel" && k === "excel") {
    await Excel.run(async (ctx) => {
      const [sheet, addr] = t.includes("!") ? [t.split("!")[0].replace(/^'|'$/g, ""), t.split("!")[1]] : ["", t];
      const ws = sheet ? ctx.workbook.worksheets.getItem(sheet) : ctx.workbook.worksheets.getActiveWorksheet();
      ws.activate();
      ws.getRange(addr).select();
      await ctx.sync();
    });
  } else if (host === "powerpoint" && (k === "powerpoint" || k === "ppt")) {
    await PowerPoint.run(async (ctx) => {
      const slides = ctx.presentation.slides;
      slides.load("items/id");
      await ctx.sync();
      const i = parseInt(t, 10) - 1;
      if (!(i >= 0 && i < slides.items.length)) throw new Error("slide not found");
      ctx.presentation.setSelectedSlides([slides.items[i].id]);
      await ctx.sync();
    });
  } else {
    throw new Error(`reference "${kind}" does not match this app`);
  }
}
