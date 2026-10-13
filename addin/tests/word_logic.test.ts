import test from "node:test";
import assert from "node:assert/strict";
import { lintParagraphs, headingLevel, builtinStyle } from "../src/office/word_logic.ts";

const P = (index: number, text: string, o: any = {}) => ({ index, text, style: "Normal", fontName: "Times New Roman", fontSize: 13, ...o });

test("headingLevel understands English and Vietnamese style names", () => {
  assert.equal(headingLevel("Heading 2"), 2);
  assert.equal(headingLevel("Tiêu đề 3"), 3);
  assert.equal(headingLevel("Normal"), 0);
  assert.equal(headingLevel("Title"), 10);
});

test("builtinStyle maps names regardless of case", () => {
  assert.equal(builtinStyle("Heading 1"), "Heading1");
  assert.equal(builtinStyle(" list bullet "), "ListBullet");
  assert.equal(builtinStyle("Fancy"), undefined);
});

test("clean document has no issues", () => {
  const r = lintParagraphs([P(0, "Báo cáo", { style: "Heading 1" }), P(1, "Nội dung bình thường, đủ rõ ràng.")]);
  assert.deepEqual(r.issues, []);
});

test("finds spacing, punctuation, blank lines and heading jumps", () => {
  const r = lintParagraphs([
    P(0, "Mở đầu", { style: "Heading 1" }),
    P(1, "Hai  dấu cách và thiếu dấu cách,sau phẩy ."),
    P(2, ""), P(3, ""),
    P(4, "Mục nhỏ", { style: "Heading 3" }),
  ]);
  const rules = r.issues.map((i) => i.rule);
  for (const x of ["double-space", "space-before-punct", "no-space-after-punct", "empty-lines", "heading-skip"]) assert.ok(rules.includes(x), x);
});

test("decimals and times are not flagged as missing spaces", () => {
  const r = lintParagraphs([P(0, "Giá 1,5 triệu lúc 10:30, ok.")]);
  assert.ok(!r.issues.some((i) => i.rule === "no-space-after-punct"));
});

test("typed numbering and fake headings are suggested", () => {
  const r = lintParagraphs([
    P(0, "1. Một việc"), P(1, "2. Việc nữa"), P(2, "- gạch đầu dòng"),
    P(3, "Phần giới thiệu", { bold: true, fontSize: 16 }),
    P(4, "Nội dung dài hơn nhiều để làm nội dung chính của tài liệu."),
  ]);
  assert.equal(r.issues.filter((i) => i.rule === "manual-numbering").length, 3);
  assert.ok(r.issues.some((i) => i.rule === "fake-heading" && i.paragraph === 3));
});

test("mixed fonts are reported with the most common font as the fix", () => {
  const r = lintParagraphs([P(0, "a b"), P(1, "c d"), P(2, "e f", { fontName: "Arial" }), P(3, "g h", { fontName: "Comic Sans MS" })]);
  const f = r.issues.find((i) => i.rule === "mixed-fonts")!;
  assert.equal((f.fix as any).fontName, "Times New Roman");
});

test("long document without headings is flagged", () => {
  const r = lintParagraphs(Array.from({ length: 35 }, (_, i) => P(i, `Đoạn số ${i}.`)));
  assert.ok(r.issues.some((i) => i.rule === "no-headings"));
});
