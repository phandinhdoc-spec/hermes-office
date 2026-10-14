import test from "node:test";
import assert from "node:assert/strict";
import { fold, parseQuery, scan, matchText, matchMany, snippet, distinctMatches, swatch } from "../src/office/search_logic.ts";

test("fold: accents, đ, case, offsets map back", () => {
  assert.equal(fold("Đường Nguyễn Huệ").f, "duong nguyen hue");
  const { f, map } = fold("Việt");
  assert.equal(f, "viet");
  assert.deepEqual(map, [0, 1, 2, 3]);
  // decomposed input (e + combining marks) gives the same folded text and the span covers the marks
  const nfd = "Việt Nam".normalize("NFD");
  assert.equal(fold(nfd).f, "viet nam");
  const h = matchText(nfd, parseQuery("viet"))!;
  assert.equal(h.spans[0].text, nfd.slice(0, nfd.indexOf(" ")));
});

test("accent- and case-insensitive match returns the original text", () => {
  const h = matchText("Học sinh giỏi cấp thành phố", parseQuery("hoc sinh gioi"))!;
  assert.ok(h);
  assert.deepEqual(h.spans.map((s) => s.text), ["Học", "sinh", "giỏi"]);
  assert.equal(matchText("Học sinh khá", parseQuery("hoc sinh gioi")), null);
});

test("mode any / phrase / alternatives / exclusion", () => {
  assert.ok(matchText("lớp 9A", parseQuery("giỏi lớp", { mode: "any" })));
  assert.equal(matchText("sinh học", parseQuery("học sinh", { mode: "phrase" })), null);
  assert.ok(matchText("em học sinh giỏi", parseQuery('"học sinh"', { mode: "all" })));
  assert.ok(matchText("HS giỏi", parseQuery("học|hs giỏi")));
  assert.equal(matchText("HS giỏi lớp 9", parseQuery("giỏi -lớp")), null);
  assert.ok(matchText("HS giỏi", parseQuery("giỏi -lớp")));
  assert.throws(() => parseQuery("-lớp"));
  assert.throws(() => parseQuery("   "));
});

test("whole word option and ranking: whole words beat parts and typos", () => {
  const q = parseQuery("sinh");
  const word = matchText("học sinh giỏi", q)!;
  const part = matchText("sinh viên", parseQuery("sinh", { wholeWord: true }));
  assert.ok(part); // "sinh" is a whole word there too
  assert.equal(matchText("sinhvien", parseQuery("sinh", { wholeWord: true })), null);
  const inside = matchText("vi sinh vật", q)!;
  const exactPart = matchText("sinhhoat", q)!;
  assert.ok(word.score > exactPart.score || inside.score >= exactPart.score);
  const typo = matchText("hoc sinh gioi", parseQuery("gioj", { fuzzy: true }));
  assert.equal(typo, null, "4-letter words are never fuzzy");
});

test("fuzzy: one typo in a 5+ letter word, off when fuzzy=false", () => {
  const f = matchText("Kết quả thí ngiệm", parseQuery("nghiệm", { fuzzy: true }))!;
  assert.equal(f.spans[0].kind, "fuzzy");
  assert.equal(f.spans[0].text, "ngiệm");
  const h = matchText("Bảng điểm học kỳ", parseQuery('"hoc ki"', { fuzzy: true }));
  assert.ok(h); // "hoc ki" vs "hoc ky": 2-word phrase, 1 edit
  assert.equal(h!.spans[0].kind, "fuzzy");
  assert.equal(matchText("Bảng điểm học kỳ", parseQuery('"hoc ki"', { fuzzy: false })), null);
  const d = matchText("Chương trình giáo dục phổ thông", parseQuery("giao duc pho thong"))!;
  assert.equal(d.spans[0].kind, "word");
});

test("regex mode", () => {
  const h = matchText("Lớp 9A1, lớp 9A2", parseQuery("9A\\d", { mode: "regex" }))!;
  assert.deepEqual(h.spans.map((s) => s.text), ["9A1", "9A2"]);
  assert.throws(() => parseQuery("(", { mode: "regex" }), /không hợp lệ/);
});

test("rows: groups may be satisfied by different cells; exclusion in any cell rejects", () => {
  const q = parseQuery("nguyễn 9a");
  const r = matchMany(["Nguyễn Văn An", "9A1", "8,5"], q)!;
  assert.ok(r);
  assert.equal(r.scans[0].spans.length, 1);
  assert.equal(matchMany(["Nguyễn Văn An", "8A1"], q), null);
  assert.equal(matchMany(["Nguyễn Văn An", "9A1", "nghỉ"], parseQuery("nguyễn 9a -nghỉ")), null);
});

test("snippet and distinctMatches", () => {
  const t = "a".repeat(200) + " Học sinh giỏi " + "b".repeat(200);
  const h = matchText(t, parseQuery("học sinh"))!;
  const s = snippet(t, h.spans, 100);
  assert.ok(s.includes("«Học»") && s.startsWith("…") && s.endsWith("…"));
  assert.deepEqual(distinctMatches(h.spans), ["Học", "sinh"]);
  assert.deepEqual(distinctMatches([{ start: 0, end: 3, group: 0, kind: "regex", text: "a^p" }]), []);
});

test("colours", () => {
  assert.equal(swatch("vàng").word, "#FFFF00");
  assert.equal(swatch("Xanh lá").word, "#00FF00");
  assert.equal(swatch("#ff8800").fill, "#FF8800");
  assert.deepEqual(swatch("none"), { word: null, fill: null, strong: null });
  assert.equal(swatch(undefined, "pink").word, "#FF00FF");
  assert.throws(() => swatch("tím"));
});
