import { requireHost } from "./host";

function asyncResult<T>(fn: (cb: (r: Office.AsyncResult<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) =>
    fn((r) => (r.status === Office.AsyncResultStatus.Succeeded ? resolve(r.value) : reject(new Error(r.error.message)))),
  );
}

export async function getSelection(): Promise<string> {
  requireHost("powerpoint");
  return asyncResult<string>((cb) =>
    Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (r) => cb(r as Office.AsyncResult<string>)),
  );
}

export async function replaceSelection(text: string): Promise<void> {
  requireHost("powerpoint");
  await asyncResult<void>((cb) =>
    Office.context.document.setSelectedDataAsync(text, { coercionType: Office.CoercionType.Text }, cb),
  );
}

export interface SlideInfo {
  index: number;
  id: string;
  shapes: { id: string; name: string; type: string; text?: string }[];
}

export async function getSlides(): Promise<SlideInfo[]> {
  requireHost("powerpoint");
  return PowerPoint.run(async (ctx) => {
    const slides = ctx.presentation.slides;
    slides.load("items/id");
    await ctx.sync();
    const shapeCols = slides.items.map((s) => {
      s.shapes.load("items/id,items/name,items/type");
      return s.shapes;
    });
    await ctx.sync();
    shapeCols.forEach((c) =>
      c.items.forEach((shape) => {
        if (shape.type !== "Image" && shape.type !== "Table") shape.textFrame.textRange.load("text");
      }),
    );
    try {
      await ctx.sync();
    } catch {
      /* some shapes have no text frame; keep whatever loaded */
    }
    return slides.items.map((s, i) => ({
      index: i,
      id: s.id,
      shapes: shapeCols[i].items.map((sh) => {
        let text: string | undefined;
        try {
          text = sh.textFrame.textRange.text;
        } catch {
          text = undefined;
        }
        return { id: sh.id, name: sh.name, type: String(sh.type), text };
      }),
    }));
  });
}

/** Read the text of a slide (all shapes joined); `getRange` in PowerPoint terms. */
export async function getRange(slideIndex: number): Promise<string> {
  const slides = await getSlides();
  const s = slides[slideIndex];
  if (!s) throw new Error(`No slide at index ${slideIndex}`);
  return s.shapes.map((sh) => sh.text).filter(Boolean).join("\n");
}

export async function addSlide(layoutId?: string, slideMasterId?: string): Promise<string> {
  requireHost("powerpoint");
  return PowerPoint.run(async (ctx) => {
    const opts: PowerPoint.AddSlideOptions = {};
    if (layoutId) opts.layoutId = layoutId;
    if (slideMasterId) opts.slideMasterId = slideMasterId;
    ctx.presentation.slides.add(opts);
    await ctx.sync();
    const slides = ctx.presentation.slides;
    slides.load("items/id");
    await ctx.sync();
    return slides.items[slides.items.length - 1].id;
  });
}

/** Replace the full text of the first text-bearing shape on a slide; `setRange` in PowerPoint terms. */
export async function setRange(slideIndex: number, shapeId: string, text: string): Promise<void> {
  requireHost("powerpoint");
  await PowerPoint.run(async (ctx) => {
    const slides = ctx.presentation.slides;
    slides.load("items");
    await ctx.sync();
    const slide = slides.items[slideIndex];
    if (!slide) throw new Error(`No slide at index ${slideIndex}`);
    slide.shapes.getItem(shapeId).textFrame.textRange.text = text;
    await ctx.sync();
  });
}

export async function insertTextBox(
  text: string,
  box: { left?: number; top?: number; width?: number; height?: number } = {},
): Promise<void> {
  requireHost("powerpoint");
  await PowerPoint.run(async (ctx) => {
    const selected = ctx.presentation.getSelectedSlides();
    selected.load("items");
    await ctx.sync();
    let slide = selected.items[0];
    if (!slide) {
      const all = ctx.presentation.slides;
      all.load("items");
      await ctx.sync();
      slide = all.items[all.items.length - 1];
    }
    if (!slide) throw new Error("The presentation has no slides");
    slide.shapes.addTextBox(text, {
      left: box.left ?? 60,
      top: box.top ?? 60,
      width: box.width ?? 600,
      height: box.height ?? 100,
    });
    await ctx.sync();
  });
}

export interface ShapeFormat {
  fontName?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  fontColor?: string;
  fillColor?: string;
}

/** Masters/layouts of the deck plus font and fill of every shape on `slideIndex` (default: first selected slide). */
export async function getTheme(slideIndex?: number): Promise<Record<string, unknown>> {
  requireHost("powerpoint");
  return PowerPoint.run(async (ctx) => {
    const masters = ctx.presentation.slideMasters;
    masters.load("items/id,items/name");
    await ctx.sync();
    const layoutCols = masters.items.map((m) => {
      m.layouts.load("items/id,items/name");
      return m.layouts;
    });
    let slide: PowerPoint.Slide;
    if (slideIndex === undefined) {
      const sel = ctx.presentation.getSelectedSlides();
      sel.load("items");
      await ctx.sync();
      slide = sel.items[0] ?? ctx.presentation.slides.getItemAt(0);
    } else {
      slide = ctx.presentation.slides.getItemAt(slideIndex);
    }
    slide.layout.load("name");
    slide.shapes.load("items/id,items/name,items/type");
    await ctx.sync();
    const shapes = slide.shapes.items.map((sh) => {
      const textual = sh.type !== "Image" && sh.type !== "Table";
      if (textual) {
        sh.textFrame.textRange.font.load("name,size,bold,italic,color");
        sh.fill.load("foregroundColor,type");
      }
      return { sh, textual };
    });
    let loaded = true;
    try {
      await ctx.sync();
    } catch {
      loaded = false; /* some shapes lack a text frame or fill */
    }
    return {
      masters: masters.items.map((m, i) => ({ id: m.id, name: m.name, layouts: layoutCols[i].items.map((l) => ({ id: l.id, name: l.name })) })),
      slideLayout: slide.layout.name,
      shapes: shapes.map(({ sh, textual }) => {
        const info: Record<string, unknown> = { id: sh.id, name: sh.name, type: String(sh.type) };
        if (textual && loaded) {
          try {
            const f = sh.textFrame.textRange.font;
            info.font = { name: f.name, size: f.size, bold: f.bold, italic: f.italic, color: f.color };
            info.fillColor = sh.fill.type === "Solid" ? sh.fill.foregroundColor : null;
          } catch {
            /* not loaded */
          }
        }
        return info;
      }),
    };
  });
}

export async function formatShape(slideIndex: number, shapeId: string, fmt: ShapeFormat): Promise<void> {
  requireHost("powerpoint");
  await PowerPoint.run(async (ctx) => {
    const shape = ctx.presentation.slides.getItemAt(slideIndex).shapes.getItem(shapeId);
    const font = shape.textFrame.textRange.font;
    if (fmt.fontName !== undefined) font.name = fmt.fontName;
    if (fmt.fontSize !== undefined) font.size = fmt.fontSize;
    if (fmt.bold !== undefined) font.bold = fmt.bold;
    if (fmt.italic !== undefined) font.italic = fmt.italic;
    if (fmt.fontColor !== undefined) font.color = fmt.fontColor;
    if (fmt.fillColor !== undefined) shape.fill.setSolidColor(fmt.fillColor);
    await ctx.sync();
  });
}
