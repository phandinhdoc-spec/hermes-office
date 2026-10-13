/**
 * PowerPoint tools added for the Office skill set. Kept in its own file so it does not collide with powerpoint.ts.
 * The layout and lint rules are in ppt_logic.ts (no Office.js there, covered by node --test).
 * NOT run against a real PowerPoint in the build sandbox: see docs/office-skills/PROGRESS.md "Cần thử trong Office thật".
 */
import { requireHost } from "./host";
import { Box, LintShape, LintSlide, fitRect, lintSlides, normHex, planSlide } from "./ppt_logic";

type Args = Record<string, any>;
const NOTE_BOX = "Hermes-GhiChu";

const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);

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

async function pickSlide(ctx: PowerPoint.RequestContext, index?: unknown): Promise<{ slide: PowerPoint.Slide; index: number }> {
  const slides = ctx.presentation.slides;
  slides.load("items/id");
  await ctx.sync();
  if (!slides.items.length) throw new Error("Bộ trình chiếu chưa có slide nào");
  if (index !== undefined && index !== null && index !== "") {
    const i = Math.trunc(Number(index));
    if (!(i >= 0 && i < slides.items.length)) throw new Error(`Không có slide số ${i} (có ${slides.items.length} slide, đánh số từ 0)`);
    return { slide: slides.items[i], index: i };
  }
  const sel = ctx.presentation.getSelectedSlides();
  sel.load("items/id");
  await ctx.sync();
  const id = sel.items[0]?.id ?? slides.items[slides.items.length - 1].id;
  const i = slides.items.findIndex((s) => s.id === id);
  return { slide: slides.items[i], index: i };
}

function setText(shape: PowerPoint.Shape, b: Box): void {
  const tf = shape.textFrame;
  tf.wordWrap = true;
  tf.autoSizeSetting = "AutoSizeNone";
  if (b.valign) tf.verticalAlignment = b.valign;
  const r = tf.textRange;
  if (b.size) r.font.size = b.size;
  r.font.bold = !!b.bold;
  r.font.italic = !!b.italic;
  if (b.color) r.font.color = b.color;
  if (b.fontName) r.font.name = b.fontName;
  if (b.align) r.paragraphFormat.horizontalAlignment = b.align;
}

async function addNoteBox(ctx: PowerPoint.RequestContext, slide: PowerPoint.Slide, text: string, append: boolean, H: number): Promise<void> {
  // PowerPoint's add-in API has no speaker-notes property: keep the notes in a box below the slide (not shown, not printed).
  slide.shapes.load("items/id,items/name");
  await ctx.sync();
  const old = slide.shapes.items.find((s) => s.name === NOTE_BOX);
  if (old) {
    old.textFrame.textRange.load("text");
    await ctx.sync();
    const prev = append ? old.textFrame.textRange.text : "";
    old.textFrame.textRange.text = prev ? prev + "\n" + text : text;
    return;
  }
  const box = slide.shapes.addTextBox(text, { left: 0, top: H + 40, width: 600, height: 200 });
  box.name = NOTE_BOX;
  box.textFrame.textRange.font.size = 14;
  box.altTextDescription = "Ghi chú thuyết trình của Hermes (nằm ngoài trang chiếu)";
}

async function blankLayoutId(ctx: PowerPoint.RequestContext): Promise<string | undefined> {
  try {
    const masters = ctx.presentation.slideMasters;
    masters.load("items/id");
    await ctx.sync();
    if (!masters.items.length) return undefined;
    const layouts = masters.items[0].layouts;
    layouts.load("items/id,items/name");
    await ctx.sync();
    return layouts.items.find((l) => /^(blank|trống|trắng)/i.test(l.name))?.id;
  } catch {
    return undefined;
  }
}

async function dropEmptyPlaceholders(ctx: PowerPoint.RequestContext, slide: PowerPoint.Slide): Promise<void> {
  slide.shapes.load("items/id,items/type");
  await ctx.sync();
  const ph = slide.shapes.items.filter((s) => String(s.type) === "Placeholder");
  ph.forEach((s) => s.textFrame.textRange.load("text"));
  try {
    await ctx.sync();
    ph.forEach((s) => {
      if (!s.textFrame.textRange.text.trim()) s.delete();
    });
    await ctx.sync();
  } catch {
    /* a placeholder that cannot report text is left alone */
  }
}

// ---------------------------------------------------------------------------------------------------- build slide

export async function buildSlide(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  const hasImage = typeof a.base64 === "string" && a.base64.length > 0;
  return PowerPoint.run(async (ctx) => {
    const { W, H } = await slideSize(ctx);
    const plan = planSlide(
      { layout: a.layout, title: a.title, subtitle: a.subtitle, bullets: a.bullets, right: a.right, hasImage, titleSize: a.titleSize, bodySize: a.bodySize, theme: a.theme },
      W,
      H,
    );
    const layoutId = await blankLayoutId(ctx);
    ctx.presentation.slides.add(layoutId ? { layoutId } : {});
    await ctx.sync();
    const slides = ctx.presentation.slides;
    slides.load("items/id");
    await ctx.sync();
    const slide = slides.items[slides.items.length - 1];
    if (!layoutId) await dropEmptyPlaceholders(ctx, slide);

    slide.background.fill.setSolidFill({ color: plan.background });
    const img = plan.boxes.find((b) => b.role === "image");
    for (const b of plan.boxes) {
      if (b.role === "image") continue;
      if (b.role === "bar" || b.role === "band") {
        const s = slide.shapes.addGeometricShape("Rectangle", { left: b.left, top: b.top, width: b.width, height: b.height });
        s.name = b.name;
        s.fill.setSolidColor(b.fill ?? "#000000");
        s.lineFormat.visible = false;
        s.isDecorative = true;
        continue;
      }
      if (b.role === "card") {
        const s = slide.shapes.addGeometricShape("RoundRectangle", { left: b.left, top: b.top, width: b.width, height: b.height });
        s.name = b.name;
        s.fill.setSolidColor(b.fill ?? "#F1F5F9");
        s.lineFormat.visible = false;
        s.textFrame.textRange.text = b.text ?? "";
        setText(s, b);
        continue;
      }
      const t = slide.shapes.addTextBox(b.text ?? "", { left: b.left, top: b.top, width: b.width, height: b.height });
      t.name = b.name;
      setText(t, b);
    }
    // Picture: a rectangle filled with the picture, sized to the picture's own proportions so it is never stretched.
    let imageShapeId: string | undefined;
    if (img && hasImage) {
      const r = fitRect(num(a.imageWidth, 0), num(a.imageHeight, 0), img, plan.layout === "full-image" ? "cover" : "contain");
      const pic = slide.shapes.addGeometricShape("Rectangle", r);
      pic.name = img.name;
      pic.fill.setImage(String(a.base64));
      pic.lineFormat.visible = false;
      pic.altTextDescription = String(a.imageAlt || a.title || "Ảnh minh họa");
      if (plan.layout === "full-image") pic.setZOrder("SendToBack");
      imageShapeId = pic.id;
    }
    await ctx.sync();
    if (hasImage && !a.imageAlt) plan.warnings.push("Ảnh chưa có imageAlt; đã dùng tiêu đề làm văn bản thay thế.");

    const noteParts: string[] = [];
    if (a.notes) noteParts.push(String(a.notes));
    if (a.credit && hasImage) noteParts.push("Nguồn ảnh: " + String(a.credit));
    if (noteParts.length) {
      await addNoteBox(ctx, slide, noteParts.join("\n"), false, H);
      await ctx.sync();
    }
    if (a.index !== undefined && a.index !== null && a.index !== "") {
      slide.moveTo(Math.max(0, Math.trunc(Number(a.index))));
      await ctx.sync();
    }
    slide.load("id");
    await ctx.sync();
    return { ok: true, slideId: slide.id, layout: plan.layout, shapes: plan.boxes.length, imageShapeId, warnings: plan.warnings };
  });
}

// ---------------------------------------------------------------------------------------------------- picture, background, notes

export async function insertImage(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  const base64 = String(a.base64 ?? "");
  if (!base64) throw new Error("Thiếu ảnh: cần imageId hoặc base64");
  if (!String(a.altText ?? "").trim()) throw new Error("Cần altText mô tả ảnh (để người khiếm thị đọc được)");
  return PowerPoint.run(async (ctx) => {
    const { W, H } = await slideSize(ctx);
    const { slide, index } = await pickSlide(ctx, a.slideIndex);
    const box = { left: num(a.left, 0), top: num(a.top, 0), width: num(a.width, W), height: num(a.height, H) };
    const r = fitRect(num(a.imageWidth, 0), num(a.imageHeight, 0), box, a.fit === "cover" ? "cover" : "contain");
    const pic = slide.shapes.addGeometricShape("Rectangle", r);
    pic.name = String(a.name || "Hermes-Anh");
    pic.fill.setImage(base64);
    pic.lineFormat.visible = false;
    pic.altTextDescription = String(a.altText);
    pic.load("id");
    await ctx.sync();
    return { ok: true, slideIndex: index, shapeId: pic.id, left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

export async function setBackground(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  const color = a.color ? normHex(String(a.color), "") : "";
  const base64 = a.base64 ? String(a.base64) : "";
  if (!color && !base64) throw new Error("Cần color (#RRGGBB) hoặc imageId");
  return PowerPoint.run(async (ctx) => {
    let targets: PowerPoint.Slide[];
    if (a.scope === "presentation") {
      ctx.presentation.slides.load("items/id");
      await ctx.sync();
      targets = ctx.presentation.slides.items;
    } else {
      targets = [(await pickSlide(ctx, a.slideIndex)).slide];
    }
    for (const s of targets) {
      if (base64) s.background.fill.setPictureOrTextureFill({ imageBase64: base64, transparency: 0 });
      else s.background.fill.setSolidFill({ color });
    }
    await ctx.sync();
    return { ok: true, slides: targets.length, note: color ? "Chữ cũ có thể khó đọc trên nền mới: chạy office_ppt_get_lint." : undefined };
  });
}

export async function setNotes(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  const text = String(a.text ?? "").trim();
  if (!text) throw new Error("Thiếu nội dung ghi chú");
  return PowerPoint.run(async (ctx) => {
    const { H } = await slideSize(ctx);
    const { slide, index } = await pickSlide(ctx, a.slideIndex);
    await addNoteBox(ctx, slide, text, !!a.append, H);
    await ctx.sync();
    return {
      ok: true,
      slideIndex: index,
      storedAs: "offslide-textbox",
      note: `PowerPoint chưa cho tiện ích ghi vào ngăn Ghi chú; lời thuyết trình được lưu trong khung "${NOTE_BOX}" nằm dưới trang chiếu (không hiện khi chiếu).`,
    };
  });
}

// ---------------------------------------------------------------------------------------------------- reading shapes

async function readSlides(ctx: PowerPoint.RequestContext, only?: number): Promise<{ slides: LintSlide[]; W: number; H: number }> {
  const { W, H } = await slideSize(ctx);
  const all = ctx.presentation.slides;
  all.load("items/id");
  await ctx.sync();
  const idx = only === undefined ? all.items.map((_, i) => i) : [only];
  const out: LintSlide[] = [];
  for (const i of idx) {
    const slide = all.items[i];
    if (!slide) throw new Error(`Không có slide số ${i}`);
    slide.shapes.load("items/id,items/name,items/type,items/left,items/top,items/width,items/height,items/altTextDescription");
    const bgFill = slide.background.fill;
    const solid = bgFill.getSolidFillOrNullObject();
    solid.load("color,isNullObject");
    await ctx.sync();
    const shapes = slide.shapes.items;
    const textual = shapes.filter((s) => /TextBox|GeometricShape|Placeholder|Unsupported/i.test(String(s.type)));
    const loadText = (s: PowerPoint.Shape) => {
      s.textFrame.textRange.load("text");
      s.textFrame.textRange.font.load("name,size,color");
      s.fill.load("type,foregroundColor");
    };
    textual.forEach(loadText);
    const data = new Map<string, Partial<LintShape>>();
    const grab = (s: PowerPoint.Shape) => {
      let fill: string | null = null;
      try {
        fill = s.fill.type === "Solid" ? s.fill.foregroundColor : null;
      } catch {
        /* no fill info */
      }
      const f = s.textFrame.textRange.font;
      data.set(s.id, { text: s.textFrame.textRange.text, fontName: f.name || null, fontSize: f.size || null, fontColor: f.color || null, fill });
    };
    try {
      await ctx.sync();
      textual.forEach(grab);
    } catch {
      // a shape without a text frame spoils the batch: ask again one by one, skipping the ones that refuse
      for (const s of textual) {
        try {
          loadText(s);
          await ctx.sync();
          grab(s);
        } catch {
          /* leave it as a shape without text */
        }
      }
    }
    out.push({
      index: i,
      background: !solid.isNullObject ? solid.color : null,
      shapes: shapes.map((s) => ({
        id: s.id,
        name: s.name,
        type: String(s.type),
        left: s.left,
        top: s.top,
        width: s.width,
        height: s.height,
        alt: s.altTextDescription,
        ...(data.get(s.id) ?? {}),
      })),
    });
  }
  return { slides: out, W, H };
}

export async function listShapes(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  return PowerPoint.run(async (ctx) => {
    const sel = a.slideIndex === undefined || a.slideIndex === null || a.slideIndex === "" ? (await pickSlide(ctx)).index : Math.trunc(Number(a.slideIndex));
    const { slides, W, H } = await readSlides(ctx, sel);
    const r = (n: number) => Math.round(n * 10) / 10;
    return {
      slideIndex: sel,
      slideWidth: W,
      slideHeight: H,
      background: slides[0].background,
      shapes: slides[0].shapes.map((s) => ({
        id: s.id, name: s.name, type: s.type, left: r(s.left), top: r(s.top), width: r(s.width), height: r(s.height),
        text: s.text ? s.text.slice(0, 200) : undefined, fontSize: s.fontSize, fontName: s.fontName, fontColor: s.fontColor, fill: s.fill, alt: s.alt || undefined,
      })),
    };
  });
}

export async function getLint(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  return PowerPoint.run(async (ctx) => {
    const only = a.scope === "slide" ? (a.slideIndex === undefined ? (await pickSlide(ctx)).index : Math.trunc(Number(a.slideIndex))) : undefined;
    const { slides, W, H } = await readSlides(ctx, only);
    const res = lintSlides(slides, { slideWidth: W, slideHeight: H, minTitle: num(a.minTitle, 36), minBody: num(a.minBody, 24), maxLines: num(a.maxLines, 6) });
    return { ok: true, slidesChecked: slides.length, issueCount: res.issues.length, summary: res.summary, fonts: res.fonts, issues: res.issues.slice(0, 80), truncated: res.issues.length > 80 };
  });
}

// ---------------------------------------------------------------------------------------------------- edit one shape

async function shapeOf(ctx: PowerPoint.RequestContext, a: Args): Promise<PowerPoint.Shape> {
  if (a.shapeId === undefined || a.shapeId === null || a.shapeId === "") throw new Error("Thiếu shapeId (lấy từ office_ppt_list_shapes)");
  const { slide } = await pickSlide(ctx, a.slideIndex);
  return slide.shapes.getItem(String(a.shapeId));
}

export async function moveShape(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  return PowerPoint.run(async (ctx) => {
    const s = await shapeOf(ctx, a);
    if (a.left !== undefined) s.left = num(a.left, 0);
    if (a.top !== undefined) s.top = num(a.top, 0);
    await ctx.sync();
    return { ok: true };
  });
}

export async function resizeShape(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  return PowerPoint.run(async (ctx) => {
    const s = await shapeOf(ctx, a);
    if (a.width !== undefined) s.width = Math.max(1, num(a.width, 1));
    if (a.height !== undefined) s.height = Math.max(1, num(a.height, 1));
    if (a.left !== undefined) s.left = num(a.left, 0);
    if (a.top !== undefined) s.top = num(a.top, 0);
    await ctx.sync();
    return { ok: true };
  });
}

export async function deleteShape(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  return PowerPoint.run(async (ctx) => {
    (await shapeOf(ctx, a)).delete();
    await ctx.sync();
    return { ok: true };
  });
}

export async function setAltText(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  const text = String(a.text ?? "").trim();
  if (!text) throw new Error("Thiếu nội dung alt text");
  return PowerPoint.run(async (ctx) => {
    (await shapeOf(ctx, a)).altTextDescription = text;
    await ctx.sync();
    return { ok: true };
  });
}

export async function setShapeText(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  if (typeof a.text !== "string") throw new Error("Thiếu text");
  return PowerPoint.run(async (ctx) => {
    const s = await shapeOf(ctx, a);
    s.textFrame.textRange.text = a.text; // font, size and colour of the first run are kept by PowerPoint
    await ctx.sync();
    return { ok: true };
  });
}

export async function deleteSlide(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  if (a.slideIndex === undefined || a.slideIndex === null || a.slideIndex === "") throw new Error("Cần slideIndex rõ ràng (không xóa slide đang chọn theo mặc định)");
  return PowerPoint.run(async (ctx) => {
    const { slide, index } = await pickSlide(ctx, a.slideIndex);
    slide.delete();
    await ctx.sync();
    return { ok: true, deleted: index };
  });
}

export async function reorderSlide(a: Args): Promise<unknown> {
  requireHost("powerpoint");
  return PowerPoint.run(async (ctx) => {
    const from = Math.trunc(Number(a.from));
    const to = Math.trunc(Number(a.to));
    const { slide } = await pickSlide(ctx, from);
    ctx.presentation.slides.load("items/id");
    await ctx.sync();
    if (!(to >= 0 && to < ctx.presentation.slides.items.length)) throw new Error(`Vị trí đến ${to} không hợp lệ`);
    slide.moveTo(to);
    await ctx.sync();
    return { ok: true, from, to };
  });
}

export const pptExtraTools: Record<string, (a: Args) => Promise<unknown>> = {
  office_ppt_build_slide: buildSlide,
  office_ppt_insert_image: insertImage,
  office_ppt_set_background: setBackground,
  office_ppt_set_notes: setNotes,
  office_ppt_list_shapes: listShapes,
  office_ppt_move_shape: moveShape,
  office_ppt_resize_shape: resizeShape,
  office_ppt_delete_shape: deleteShape,
  office_ppt_set_shape_text: setShapeText,
  office_ppt_delete_slide: deleteSlide,
  office_ppt_reorder_slide: reorderSlide,
  office_ppt_set_alt_text: setAltText,
  office_ppt_get_lint: getLint,
};
