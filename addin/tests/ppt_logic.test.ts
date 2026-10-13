import test from "node:test";
import assert from "node:assert/strict";
import { contrastRatio, readableOn, fullTheme, planSlide, lintSlides, estimateLines, cleanLines, LAYOUTS, MIN_TITLE, MIN_BODY } from "../src/office/ppt_logic.ts";

test("contrast: black on white is 21, white on white is 1", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#FFFFFF")), 21);
  assert.equal(contrastRatio("#FFFFFF", "#FFFFFF"), 1);
  assert.equal(contrastRatio("nonsense", "#FFFFFF"), 1);
});

test("readableOn keeps a good colour and replaces a bad one", () => {
  assert.equal(readableOn("#FFFFFF", "#1F2937"), "#1F2937");
  assert.ok(contrastRatio(readableOn("#FFFFFF", "#EEEEEE"), "#FFFFFF") >= 4.5);
  assert.ok(contrastRatio(readableOn("#0B1F4B", "#222222"), "#0B1F4B") >= 4.5);
});

test("fullTheme fills gaps and repairs unreadable text colour", () => {
  const t = fullTheme({ background: "#111111", text: "#222222", primary: "zzz" });
  assert.ok(contrastRatio(t.text, t.background) >= 4.5);
  assert.equal(t.primary, "#1D4ED8");
});

test("cleanLines strips bullets, caps at 6 and counts dropped", () => {
  const r = cleanLines(["• a", "- b", "c", "d", "e", "f", "g", " "]);
  assert.deepEqual(r.lines, ["a", "b", "c", "d", "e", "f"]);
  assert.equal(r.dropped, 1);
});

test("every layout respects the size floors and keeps boxes on the slide", () => {
  for (const layout of LAYOUTS) {
    const p = planSlide({ layout, title: "Lịch sử Coca-Cola", subtitle: "Từ 1886", bullets: ["Ra đời năm 1886", "Pemberton", "Hơn 200 quốc gia", "Thương hiệu biểu tượng"], right: ["x", "y"], hasImage: true });
    assert.equal(p.layout, layout);
    for (const b of p.boxes) {
      assert.ok(b.left >= 0 && b.top >= 0 && b.left + b.width <= 960.5 && b.top + b.height <= 540.5, `${layout}/${b.name} inside`);
      if (b.role === "title") assert.ok((b.size ?? 0) >= MIN_TITLE, `${layout} title size`);
      if (b.role === "body" || b.role === "body2") assert.ok((b.size ?? 0) >= MIN_BODY, `${layout} body size`);
      if (b.color && b.fill == null) {
        const bg = layout === "section" ? p.background : layout === "full-image" ? "#1D4ED8" : p.background;
        if (b.role !== "title" || layout === "section") assert.ok(contrastRatio(b.color, bg) >= 4.5 || layout === "full-image", `${layout}/${b.name} contrast`);
      }
    }
  }
});

test("unknown layout falls back with a warning; too many bullets are cut with a warning", () => {
  const p = planSlide({ layout: "wow", title: "T", bullets: Array.from({ length: 9 }, (_, i) => `ý ${i}`) });
  assert.equal(p.layout, "bullets");
  assert.ok(p.warnings.length >= 2);
  assert.equal(p.boxes.find((b) => b.role === "body")!.text!.split("\n").length, 6);
});

test("long text is reported instead of silently shrunk below 24 pt", () => {
  const long = Array.from({ length: 6 }, () => "Một câu rất dài ".repeat(8));
  const p = planSlide({ layout: "bullets", title: "T", bullets: long });
  assert.equal(p.boxes.find((b) => b.role === "body")!.size, 24);
  assert.ok(p.warnings.some((w) => /vượt khung/.test(w)));
});

test("estimateLines counts paragraphs and wraps", () => {
  assert.equal(estimateLines("a\nb\nc", 24, 600), 3);
  assert.ok(estimateLines("x".repeat(200), 24, 300) > 8);
});

const good = (over: any = {}) => ({
  index: 0, background: "#FFFFFF",
  shapes: [
    { id: "t", name: "Hermes-TieuDe", type: "TextBox", left: 58, top: 30, width: 844, height: 90, text: "Tiêu đề", fontSize: 40, fontName: "Calibri", fontColor: "#1D4ED8" },
    { id: "b", name: "Hermes-NoiDung", type: "TextBox", left: 58, top: 150, width: 844, height: 300, text: "• một\n• hai", fontSize: 28, fontName: "Calibri", fontColor: "#1F2937" },
  ],
  ...over,
});

test("lint: a clean slide has no issues", () => {
  assert.deepEqual(lintSlides([good()]).issues, []);
});

test("lint: finds small text, contrast, overflow, bounds, alt, fonts", () => {
  const s = good();
  s.shapes[0].fontSize = 20;
  s.shapes[1].fontSize = 16;
  s.shapes[1].fontColor = "#DDDDDD";
  s.shapes.push({ id: "i", name: "Pic", type: "Image", left: 900, top: 400, width: 200, height: 200, alt: "" } as any);
  s.shapes.push({ id: "c", name: "Khac", type: "TextBox", left: 58, top: 470, width: 300, height: 30, text: "x", fontSize: 24, fontName: "Comic Sans MS", fontColor: "#000000" } as any);
  s.shapes.push({ id: "d", name: "Khac2", type: "TextBox", left: 460, top: 470, width: 300, height: 30, text: "y", fontSize: 24, fontName: "Arial", fontColor: "#000000" } as any);
  const r = lintSlides([s]);
  const rules = new Set(r.issues.map((x) => x.rule));
  for (const rule of ["title-small", "body-small", "low-contrast", "out-of-bounds", "missing-alt", "too-many-fonts"]) assert.ok(rules.has(rule), rule);
  const fix = r.issues.find((x) => x.rule === "low-contrast")!.fix as any;
  assert.ok(contrastRatio(fix.fontColor, "#FFFFFF") >= 4.5);
});

test("lint: too many lines and overflow", () => {
  const s = good();
  s.shapes[1].text = Array.from({ length: 9 }, (_, i) => `dòng ${i}`).join("\n");
  s.shapes[1].height = 120;
  const rules = lintSlides([s]).issues.map((x) => x.rule);
  assert.ok(rules.includes("too-many-lines") && rules.includes("overflow"));
});

test("lint: off-slide note box is ignored, empty slide and missing title are flagged", () => {
  const s = good();
  s.shapes.push({ id: "n", name: "Hermes-GhiChu", type: "TextBox", left: 0, top: 600, width: 400, height: 100, text: "ghi chú dài ".repeat(30), fontSize: 12 } as any);
  assert.deepEqual(lintSlides([s]).issues, []);
  const e = lintSlides([{ index: 1, shapes: [] }]);
  assert.equal(e.issues[0].rule, "empty-slide");
});

test("lint: custom thresholds", () => {
  const s = good();
  assert.ok(lintSlides([s], { minBody: 32 }).issues.some((x) => x.rule === "body-small"));
});

import { fitRect } from "../src/office/ppt_logic.ts";

test("fitRect keeps proportions, centres, and stretches only a little for cover", () => {
  const box = { left: 100, top: 100, width: 400, height: 300 };
  const wide = fitRect(2000, 1000, box);
  assert.equal(wide.width, 400);
  assert.equal(wide.height, 200);
  assert.equal(wide.top, 150);
  const tall = fitRect(1000, 2000, box);
  assert.equal(tall.height, 300);
  assert.equal(tall.width, 150);
  assert.equal(tall.left, 225);
  assert.deepEqual(fitRect(4000, 3100, box, "cover"), box);
  assert.notDeepEqual(fitRect(2000, 1000, box, "cover"), box);
  assert.deepEqual(fitRect(0, 0, box), box);
});
