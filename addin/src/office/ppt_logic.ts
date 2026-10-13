/**
 * PowerPoint logic that does not touch Office.js: colours, slide layouts and the lint rules.
 * Kept free of imports so `node --test` can run it (addin/tests/ppt_logic.test.ts).
 * Units: points (1 pt = 1/72 inch). A 16:9 slide is 960 x 540 pt.
 */

export interface Theme {
  background: string;
  surface: string;
  text: string;
  primary: string;
  accent: string;
  muted: string;
  fontHeading: string;
  fontBody: string;
}

export const DEFAULT_THEME: Theme = {
  background: "#FFFFFF",
  surface: "#F1F5F9",
  text: "#1F2937",
  primary: "#1D4ED8",
  accent: "#F59E0B",
  muted: "#475569",
  fontHeading: "Calibri",
  fontBody: "Calibri",
};

export const MIN_TITLE = 36;
export const MIN_BODY = 24;
export const MAX_LINES = 6;
export const MIN_CONTRAST = 4.5;

// ------------------------------------------------------------------ colours

export function parseHex(c: string | null | undefined): [number, number, number] | null {
  if (!c) return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function normHex(c: string | null | undefined, fallback: string): string {
  const p = parseHex(c);
  return p ? "#" + p.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase() : fallback;
}

function lin(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(c: string): number {
  const p = parseHex(c) ?? [0, 0, 0];
  return 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
}

/** WCAG contrast ratio, 1..21. Unreadable colours count as 1 so they are reported, not trusted. */
export function contrastRatio(fg: string, bg: string): number {
  if (!parseHex(fg) || !parseHex(bg)) return 1;
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `preferred` if it reads well on `bg`, else black or white, whichever reads better. */
export function readableOn(bg: string, preferred?: string, min = MIN_CONTRAST): string {
  if (preferred && parseHex(preferred) && contrastRatio(preferred, bg) >= min) return normHex(preferred, "#000000");
  return contrastRatio("#FFFFFF", bg) >= contrastRatio("#111111", bg) ? "#FFFFFF" : "#111111";
}

export function fullTheme(t?: Partial<Theme> | null): Theme {
  const o = { ...DEFAULT_THEME };
  for (const k of Object.keys(DEFAULT_THEME) as (keyof Theme)[]) {
    const v = t?.[k];
    if (typeof v === "string" && v.trim()) o[k] = k.startsWith("font") ? v.trim() : normHex(v, DEFAULT_THEME[k]);
  }
  o.text = readableOn(o.background, o.text);
  return o;
}

// ------------------------------------------------------------------ text measuring

/** Rough line count for text in a box. Vietnamese with diacritics is wider than plain Latin, hence 0.54 em. */
export function estimateLines(text: string, sizePt: number, widthPt: number): number {
  const usable = Math.max(widthPt - 14, 10); // default text box insets
  const perLine = Math.max(1, Math.floor(usable / (sizePt * 0.54)));
  return (text || "")
    .split(/\r?\n/)
    .reduce((n, para) => n + Math.max(1, Math.ceil(para.trim().length / perLine)), 0);
}

export function textHeight(lines: number, sizePt: number, spacing = 1.2): number {
  return lines * sizePt * spacing + 10;
}

// ------------------------------------------------------------------ layouts

export type LayoutName =
  | "title" | "section" | "bullets" | "image-right" | "image-left" | "full-image" | "two-column" | "quote" | "quiz" | "closing";
export const LAYOUTS: LayoutName[] = ["title", "section", "bullets", "image-right", "image-left", "full-image", "two-column", "quote", "quiz", "closing"];

export interface SlideSpec {
  layout?: string;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  right?: string[];
  hasImage?: boolean;
  titleSize?: number;
  bodySize?: number;
  theme?: Partial<Theme> | null;
}

export interface Box {
  role: "title" | "subtitle" | "body" | "body2" | "image" | "bar" | "band" | "card" | "quote";
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  text?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  align?: "Left" | "Center" | "Right";
  valign?: "Top" | "Middle" | "Bottom";
  color?: string; // text colour
  fill?: string; // solid fill
  fontName?: string;
}

export interface Plan {
  layout: LayoutName;
  background: string;
  boxes: Box[];
  warnings: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function cleanLines(list: unknown, max = MAX_LINES): { lines: string[]; dropped: number } {
  const all = (Array.isArray(list) ? list : typeof list === "string" ? list.split(/\r?\n/) : [])
    .map((x) => String(x ?? "").replace(/^\s*[•\-–*]\s*/, "").trim())
    .filter(Boolean);
  return { lines: all.slice(0, max), dropped: Math.max(0, all.length - max) };
}

/** Largest size in [min, start] at which the lines fit the box; `fits` false if even `min` overflows. */
export function fitSize(lines: string[], width: number, height: number, start: number, min = MIN_BODY): { size: number; fits: boolean } {
  const text = lines.join("\n");
  for (let s = start; s >= min; s -= 2) {
    if (textHeight(estimateLines(text, s, width), s) <= height) return { size: s, fits: true };
  }
  return { size: min, fits: false };
}

export function planSlide(spec: SlideSpec, W = 960, H = 540): Plan {
  const th = fullTheme(spec.theme);
  const warnings: string[] = [];
  const layoutIn = String(spec.layout ?? "bullets").toLowerCase();
  const layout = (LAYOUTS as string[]).includes(layoutIn) ? (layoutIn as LayoutName) : "bullets";
  if (layout !== layoutIn) warnings.push(`Bố cục "${spec.layout}" không có, dùng "bullets".`);
  const m = Math.round(W * 0.06);
  const titleSize = clamp(Math.round(spec.titleSize ?? 40), MIN_TITLE, 60);
  const bodyStart = clamp(Math.round(spec.bodySize ?? 28), MIN_BODY, 36);
  const boxes: Box[] = [];
  const title = (spec.title ?? "").trim();
  const sub = (spec.subtitle ?? "").trim();
  const left = cleanLines(spec.bullets);
  const right = cleanLines(spec.right);
  if (left.dropped) warnings.push(`Bỏ ${left.dropped} dòng vì mỗi slide tối đa ${MAX_LINES} dòng; hãy tách thành slide khác.`);
  let bg = th.background;
  const titleBox = (top: number, height: number, o: Partial<Box> = {}): Box => ({
    role: "title", name: "Hermes-TieuDe", left: m, top, width: W - 2 * m, height, text: title,
    size: titleSize, bold: true, align: "Left", valign: "Middle", color: th.primary, fontName: th.fontHeading, ...o,
  });
  const ensureTitleFit = (b: Box) => {
    const r = fitSize([b.text ?? ""], b.width, b.height, titleSize, MIN_TITLE);
    b.size = r.size;
    if (!r.fits) warnings.push("Tiêu đề quá dài cho cỡ 36 pt; hãy rút xuống tối đa 8 từ.");
  };
  const bodyBox = (name: string, role: "body" | "body2", lines: string[], l: number, t: number, w: number, h: number): Box => {
    const f = fitSize(lines, w, h, bodyStart);
    if (!f.fits) warnings.push("Nội dung vượt khung ở cỡ 24 pt; hãy rút gọn hoặc tách slide.");
    return { role, name, left: l, top: t, width: w, height: h, text: lines.map((x) => "• " + x).join("\n"), size: f.size, align: "Left", valign: "Top", color: th.text, fontName: th.fontBody };
  };

  switch (layout) {
    case "title": {
      boxes.push({ role: "bar", name: "Hermes-Vach", left: m, top: H * 0.5 - 6, width: 120, height: 8, fill: th.accent });
      const t = titleBox(H * 0.22, H * 0.26, { size: clamp(titleSize + 8, 44, 60), valign: "Bottom" });
      ensureTitleFit(t);
      boxes.push(t);
      if (sub) boxes.push({ role: "subtitle", name: "Hermes-PhuDe", left: m, top: H * 0.54, width: W - 2 * m, height: H * 0.2, text: sub, size: 28, align: "Left", valign: "Top", color: th.muted, fontName: th.fontBody });
      break;
    }
    case "section": {
      bg = th.primary;
      const fg = readableOn(bg, "#FFFFFF");
      boxes.push({ role: "bar", name: "Hermes-Vach", left: m, top: H * 0.38, width: 10, height: H * 0.24, fill: th.accent });
      const t = titleBox(H * 0.33, H * 0.34, { left: m + 30, width: W - 2 * m - 30, size: clamp(titleSize + 8, 44, 60), color: fg });
      ensureTitleFit(t);
      boxes.push(t);
      if (sub) boxes.push({ role: "subtitle", name: "Hermes-PhuDe", left: m + 30, top: H * 0.68, width: W - 2 * m - 30, height: 60, text: sub, size: 28, align: "Left", valign: "Top", color: fg, fontName: th.fontBody });
      break;
    }
    case "closing": {
      const t = titleBox(H * 0.28, H * 0.24, { align: "Center", size: clamp(titleSize + 8, 44, 60) });
      ensureTitleFit(t);
      boxes.push(t);
      boxes.push({ role: "bar", name: "Hermes-Vach", left: W / 2 - 60, top: H * 0.54, width: 120, height: 8, fill: th.accent });
      const text = sub || left.lines.join("\n");
      if (text) boxes.push({ role: "subtitle", name: "Hermes-PhuDe", left: m, top: H * 0.6, width: W - 2 * m, height: H * 0.22, text, size: 28, align: "Center", valign: "Top", color: th.muted, fontName: th.fontBody });
      break;
    }
    case "quote": {
      const q = (title || left.lines[0] || "").trim();
      boxes.push({ role: "bar", name: "Hermes-Vach", left: m, top: H * 0.2, width: 10, height: H * 0.5, fill: th.accent });
      const f = fitSize([q], W - 2 * m - 40, H * 0.5, 40, MIN_BODY);
      boxes.push({ role: "quote", name: "Hermes-TrichDan", left: m + 30, top: H * 0.2, width: W - 2 * m - 30, height: H * 0.5, text: q, size: f.size, italic: true, align: "Left", valign: "Middle", color: th.primary, fontName: th.fontHeading });
      if (!f.fits) warnings.push("Câu trích quá dài; hãy rút gọn.");
      if (sub) boxes.push({ role: "subtitle", name: "Hermes-PhuDe", left: m + 30, top: H * 0.74, width: W - 2 * m - 30, height: 50, text: "— " + sub, size: 24, align: "Left", valign: "Top", color: th.muted, fontName: th.fontBody });
      break;
    }
    case "full-image": {
      boxes.push({ role: "image", name: "Hermes-Anh", left: 0, top: 0, width: W, height: H });
      const bandH = Math.round(H * 0.26);
      const fg = readableOn(th.primary, "#FFFFFF");
      boxes.push({ role: "band", name: "Hermes-Dai", left: 0, top: H - bandH, width: W, height: bandH, fill: th.primary });
      const t = titleBox(H - bandH + 8, bandH - 16, { color: fg });
      ensureTitleFit(t);
      boxes.push(t);
      if (!spec.hasImage) warnings.push("Bố cục ảnh toàn nền cần imageId.");
      break;
    }
    case "bullets": {
      const t = titleBox(m * 0.6, 96);
      ensureTitleFit(t);
      boxes.push(t);
      boxes.push({ role: "bar", name: "Hermes-Vach", left: m, top: m * 0.6 + 100, width: 90, height: 6, fill: th.accent });
      boxes.push(bodyBox("Hermes-NoiDung", "body", left.lines, m, m * 0.6 + 122, W - 2 * m, H - (m * 0.6 + 122) - m * 0.7));
      break;
    }
    case "two-column": {
      const t = titleBox(m * 0.6, 96);
      ensureTitleFit(t);
      boxes.push(t);
      const gap = 30;
      const w = (W - 2 * m - gap) / 2;
      const top = m * 0.6 + 116;
      const h = H - top - m * 0.7;
      boxes.push(bodyBox("Hermes-Cot1", "body", left.lines, m, top, w, h));
      boxes.push(bodyBox("Hermes-Cot2", "body2", right.lines, m + w + gap, top, w, h));
      break;
    }
    case "image-right":
    case "image-left": {
      if (!spec.hasImage) warnings.push("Bố cục có ảnh nhưng chưa có imageId; phần ảnh để trống.");
      const t = titleBox(m * 0.6, 96);
      ensureTitleFit(t);
      boxes.push(t);
      const top = m * 0.6 + 116;
      const h = H - top - m * 0.7;
      const imgW = (W - 2 * m) * 0.42;
      const txtW = W - 2 * m - imgW - 28;
      const imgLeft = layout === "image-right" ? W - m - imgW : m;
      const txtLeft = layout === "image-right" ? m : m + imgW + 28;
      boxes.push(bodyBox("Hermes-NoiDung", "body", left.lines, txtLeft, top, txtW, h));
      boxes.push({ role: "image", name: "Hermes-Anh", left: imgLeft, top, width: imgW, height: h });
      break;
    }
    case "quiz": {
      const t = titleBox(m * 0.6, 150, { size: clamp(titleSize - 4, MIN_TITLE, 60), valign: "Top" });
      ensureTitleFit(t);
      boxes.push(t);
      const opts = left.lines.slice(0, 4);
      const gap = 24;
      const w = (W - 2 * m - gap) / 2;
      const top = m * 0.6 + 170;
      const h = (H - top - m * 0.7 - gap) / 2;
      const letters = ["A", "B", "C", "D"];
      opts.forEach((o, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const f = fitSize([`${letters[i]}. ${o}`], w - 20, h, 28);
        if (!f.fits) warnings.push(`Đáp án ${letters[i]} quá dài.`);
        boxes.push({
          role: "card", name: `Hermes-DapAn${letters[i]}`, left: m + col * (w + gap), top: top + row * (h + gap), width: w, height: h,
          text: `${letters[i]}. ${o}`, size: f.size, align: "Left", valign: "Middle", color: readableOn(th.surface, th.text), fill: th.surface, fontName: th.fontBody,
        });
      });
      break;
    }
  }
  return { layout, background: bg, boxes, warnings };
}

// ------------------------------------------------------------------ lint

export interface LintShape {
  id: string;
  name: string;
  type: string; // Office.js ShapeType: TextBox, GeometricShape, Image, Table, Placeholder ...
  left: number;
  top: number;
  width: number;
  height: number;
  text?: string;
  fontSize?: number | null;
  fontName?: string | null;
  fontColor?: string | null;
  fill?: string | null; // solid fill colour, if any
  alt?: string | null;
  isTitle?: boolean;
}

export interface LintSlide {
  index: number;
  background?: string | null;
  shapes: LintShape[];
}

export interface LintOptions {
  slideWidth?: number;
  slideHeight?: number;
  minTitle?: number;
  minBody?: number;
  maxLines?: number;
  maxFonts?: number;
}

export interface LintIssue {
  slide: number;
  shapeId?: string;
  rule: string;
  severity: "error" | "warn";
  message: string;
  fix?: Record<string, unknown>;
}

const NOTE_NAMES = /^Hermes-(GhiChu|Credit|NguonAnh)/i;
const isImage = (s: LintShape) => /image|picture/i.test(s.type);
const isText = (s: LintShape) => !!s.text && s.text.trim().length > 0 && !/^(image|table)$/i.test(s.type);

export function guessTitle(shapes: LintShape[]): LintShape | undefined {
  const flagged = shapes.find((s) => s.isTitle && isText(s));
  if (flagged) return flagged;
  const named = shapes.find((s) => /(^|-)title|tieude|tiêu đề/i.test(s.name) && isText(s));
  if (named) return named;
  const texts = shapes.filter((s) => isText(s) && !NOTE_NAMES.test(s.name));
  if (!texts.length) return undefined;
  const top = texts.filter((s) => s.top < 160);
  const pool = top.length ? top : texts;
  return pool.reduce((a, b) => ((b.fontSize ?? 0) > (a.fontSize ?? 0) || ((b.fontSize ?? 0) === (a.fontSize ?? 0) && b.top < a.top) ? b : a));
}

function overlapRatio(a: LintShape, b: LintShape): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

export function lintSlides(slides: LintSlide[], opt: LintOptions = {}): { issues: LintIssue[]; summary: Record<string, number>; fonts: string[] } {
  const W = opt.slideWidth ?? 960;
  const H = opt.slideHeight ?? 540;
  const minTitle = opt.minTitle ?? MIN_TITLE;
  const minBody = opt.minBody ?? MIN_BODY;
  const maxLines = opt.maxLines ?? MAX_LINES;
  const issues: LintIssue[] = [];
  const fonts = new Map<string, number>();
  for (const sl of slides) {
    const i = sl.index;
    const bg = sl.background && parseHex(sl.background) ? sl.background : "#FFFFFF";
    const title = guessTitle(sl.shapes);
    const textShapes = sl.shapes.filter((s) => isText(s) && !NOTE_NAMES.test(s.name));
    if (!textShapes.length && !sl.shapes.some(isImage)) {
      issues.push({ slide: i, rule: "empty-slide", severity: "warn", message: `Slide ${i + 1} trống.` });
    }
    if (!title && textShapes.length) {
      issues.push({ slide: i, rule: "no-title", severity: "warn", message: `Slide ${i + 1} chưa có tiêu đề.` });
    }
    for (const s of textShapes) {
      const offSlide = s.left > W + 5 || s.top > H + 5;
      if (offSlide) continue;
      const isT = s === title;
      const size = s.fontSize ?? null;
      if (s.fontName) fonts.set(s.fontName, (fonts.get(s.fontName) ?? 0) + 1);
      if (size !== null) {
        if (isT && size < minTitle) {
          issues.push({ slide: i, shapeId: s.id, rule: "title-small", severity: "error", message: `Slide ${i + 1}: tiêu đề ${size} pt, cần từ ${minTitle} pt.`, fix: { fontSize: minTitle } });
        } else if (!isT && size < minBody) {
          issues.push({ slide: i, shapeId: s.id, rule: "body-small", severity: "error", message: `Slide ${i + 1}: chữ "${s.name}" ${size} pt, cần từ ${minBody} pt.`, fix: { fontSize: minBody } });
        }
      }
      const eff = size ?? (isT ? minTitle : minBody);
      const lines = estimateLines(s.text ?? "", eff, s.width);
      if (!isT && lines > maxLines) {
        issues.push({ slide: i, shapeId: s.id, rule: "too-many-lines", severity: "warn", message: `Slide ${i + 1}: khoảng ${lines} dòng (tối đa ${maxLines}); tách thành slide khác.`, fix: { splitSlide: true } });
      }
      if (textHeight(lines, eff) > s.height * 1.08 + 4) {
        issues.push({ slide: i, shapeId: s.id, rule: "overflow", severity: "error", message: `Slide ${i + 1}: chữ "${s.name}" có thể tràn khung.`, fix: { height: Math.min(Math.round(textHeight(lines, eff)), H - s.top - 10) } });
      }
      const fg = s.fontColor && parseHex(s.fontColor) ? s.fontColor : null;
      const behind = s.fill && parseHex(s.fill) ? s.fill : bg;
      if (fg) {
        const c = contrastRatio(fg, behind);
        if (c < MIN_CONTRAST) {
          issues.push({ slide: i, shapeId: s.id, rule: "low-contrast", severity: "error", message: `Slide ${i + 1}: độ tương phản ${c.toFixed(1)}:1 (cần ≥ ${MIN_CONTRAST}:1).`, fix: { fontColor: readableOn(behind) } });
        }
      }
    }
    for (const s of sl.shapes) {
      if (s.left < -2 || s.top < -2 || (s.left + s.width > W + 2 && s.left < W) || (s.top + s.height > H + 2 && s.top < H)) {
        if (!NOTE_NAMES.test(s.name)) {
          issues.push({ slide: i, shapeId: s.id, rule: "out-of-bounds", severity: "error", message: `Slide ${i + 1}: "${s.name}" nằm ngoài trang chiếu.`, fix: { left: Math.max(0, Math.min(s.left, W - s.width)), top: Math.max(0, Math.min(s.top, H - s.height)) } });
        }
      }
      if (isImage(s) && !(s.alt && s.alt.trim())) {
        issues.push({ slide: i, shapeId: s.id, rule: "missing-alt", severity: "warn", message: `Slide ${i + 1}: ảnh "${s.name}" chưa có văn bản thay thế.`, fix: { altText: true } });
      }
    }
    for (let a = 0; a < textShapes.length; a++) {
      for (let b = a + 1; b < textShapes.length; b++) {
        if (overlapRatio(textShapes[a], textShapes[b]) > 0.15) {
          issues.push({ slide: i, shapeId: textShapes[b].id, rule: "overlap", severity: "warn", message: `Slide ${i + 1}: "${textShapes[a].name}" và "${textShapes[b].name}" chồng lên nhau.` });
        }
      }
    }
  }
  const names = [...fonts.keys()];
  const maxFonts = opt.maxFonts ?? 2;
  if (names.length > maxFonts) {
    issues.push({ slide: -1, rule: "too-many-fonts", severity: "warn", message: `Bộ slide dùng ${names.length} phông (${names.join(", ")}); nên tối đa ${maxFonts}.`, fix: { fontName: [...fonts.entries()].sort((x, y) => y[1] - x[1])[0][0] } });
  }
  const summary: Record<string, number> = {};
  for (const it of issues) summary[it.rule] = (summary[it.rule] ?? 0) + 1;
  return { issues, summary, fonts: names };
}

// ------------------------------------------------------------------ pictures

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where to put a picture of imgW x imgH inside `box` without stretching it.
 * PowerPoint's fill.setImage stretches to the shape, so the shape itself gets the picture's proportions.
 * "cover" stretches only when the proportions are within 12 % of the box (a small, unnoticeable change).
 */
export function fitRect(imgW: number, imgH: number, box: Rect, mode: "contain" | "cover" = "contain"): Rect {
  if (!(imgW > 0) || !(imgH > 0)) return { ...box };
  const ir = imgW / imgH;
  const br = box.width / box.height;
  if (mode === "cover" && Math.abs(ir / br - 1) <= 0.12) return { ...box };
  let w = box.width;
  let h = w / ir;
  if (h > box.height) {
    h = box.height;
    w = h * ir;
  }
  return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, width: w, height: h };
}
