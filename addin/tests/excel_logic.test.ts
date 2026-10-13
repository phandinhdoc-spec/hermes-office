import test from "node:test";
import assert from "node:assert/strict";
import { colLetter, colIndex, parseCell, parseNumberText, cleanGrid, lintGrid, diffGrids } from "../src/office/excel_logic.ts";

test("column letters round trip", () => {
  assert.equal(colLetter(0), "A"); assert.equal(colLetter(25), "Z"); assert.equal(colLetter(26), "AA"); assert.equal(colLetter(701), "ZZ");
  assert.equal(colIndex("AA"), 26);
  assert.deepEqual(parseCell("$C$12"), { row: 11, col: 2 });
  assert.throws(() => parseCell("12C"));
});

test("number text: Vietnamese and English layouts, ambiguity left alone", () => {
  assert.deepEqual(parseNumberText("1.234,5"), { value: 1234.5 });
  assert.deepEqual(parseNumberText("1,234.5"), { value: 1234.5 });
  assert.deepEqual(parseNumberText("12,5"), { value: 12.5 });
  assert.deepEqual(parseNumberText("1 234 567"), { value: 1234567 });
  assert.deepEqual(parseNumberText("1.234.567"), { value: 1234567 });
  assert.deepEqual(parseNumberText("-7"), { value: -7 });
  assert.deepEqual(parseNumberText("12.5"), { value: 12.5 });
  assert.deepEqual(parseNumberText("1.234"), { ambiguous: true });
  assert.deepEqual(parseNumberText("1,234"), { ambiguous: true });
  assert.equal(parseNumberText("abc"), null);
  assert.equal(parseNumberText(""), null);
  assert.equal(parseNumberText("12abc"), null);
});

test("cleanGrid trims, collapses, converts, skips formulas and reports ambiguity", () => {
  const values = [["  Nguyễn   Văn A ", "1.234,5", "1.234"], ["x\ny", "=A1", " 7 "]];
  const formulas = [["  Nguyễn   Văn A ", "1.234,5", "1.234"], ["x\ny", "=A1", " 7 "]];
  const r = cleanGrid(values, formulas, { removeLineBreaks: true }, { row: 1, col: 0 });
  const m = new Map(r.changes.map((c) => [`${c.row},${c.col}`, c.value]));
  assert.equal(m.get("0,0"), "Nguyễn Văn A");
  assert.equal(m.get("0,1"), 1234.5);
  assert.equal(m.has("0,2"), false);
  assert.deepEqual(r.ambiguous, ["C2"]);
  assert.equal(m.get("1,0"), "x y");
  assert.equal(m.has("1,1"), false);
  assert.equal(m.get("1,2"), 7);
});

test("cleanGrid leaves already clean cells and numbers alone", () => {
  const r = cleanGrid([["ok", 5, true, null]], null, {});
  assert.equal(r.changes.length, 0);
});

test("lintGrid: headers, text numbers, mixed, errors, duplicates, blank rows, formats", () => {
  const v = [
    ["Tên", "", "Điểm", "Tên"],
    ["An", "x", 8, "a"],
    ["Bình", "y", "9", "b"],
    ["Bình", "y", "9", "b"],
    [null, null, null, null],
    ["Chi", "z", "#DIV/0!", " c "],
    ["Dũng", "w", "tốt", "d"],
  ];
  const f = [["", "", "", ""], ["", "", "", ""], ["", "", "", ""], ["", "", "", ""], ["", "", "", ""], ["", "", "=A1/0", ""], ["", "", "", ""]];
  const nf = v.map((r, i) => r.map((_, c) => (c === 2 && i === 1 ? "0.0" : "General")));
  const r = lintGrid(v, f, nf);
  const rules = new Set(r.issues.map((i) => i.rule));
  for (const x of ["header-empty", "header-duplicate", "text-numbers", "error-value", "duplicate-rows", "blank-rows", "mixed-types"]) assert.ok(rules.has(x), x);
  assert.equal(r.issues.find((i) => i.rule === "error-value")!.address, "C6");
});

test("lintGrid: a clean table has no issues, origin shifts addresses", () => {
  assert.deepEqual(lintGrid([["A", "B"], [1, "x"], [2, "y"]], null, null).issues, []);
  const bad = lintGrid([["A", ""], [1, "x"]], null, null, { row: 4, col: 2 });
  assert.equal(bad.issues[0].address, "D5");
});

test("diffGrids by position and by key", () => {
  const a = [["id", "v"], ["1", 5], ["2", 6], ["3", 7]];
  const b = [["id", "v"], ["1", 5], ["2", 9], ["4", 1]];
  const pos = diffGrids(a, b);
  assert.equal(pos.counts.changed, 3);
  const key = diffGrids(a, b, 0);
  assert.deepEqual(key.counts, { changed: 1, "only-in-A": 1, "only-in-B": 1 });
  assert.equal(key.items.find((i) => i.kind === "changed")!.key, "2");
  assert.equal(diffGrids(a, b, 0, 1).items.length, 1);
  assert.equal(diffGrids(a, b, 0, 1).total, 3);
  assert.equal(diffGrids(a, a).total, 0);
  assert.equal(diffGrids([["a"]], [["a"], ["b"]]).counts["only-in-B"], 1);
});
