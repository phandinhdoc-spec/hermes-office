/**
 * Smart search + colour palette shared by the Word / Excel / PowerPoint search-and-annotate tools (annot_extra.ts).
 * Pure functions, no Office.js (tests: addin/tests/search_logic.test.ts).
 *
 * Query syntax (one string, easy for a model to write):
 *   học sinh giỏi        all three words must appear (mode "all", the default); a word is a "group"
 *   học|hs sinh|em       "|" lists alternatives (synonyms) inside one group: (học OR hs) AND (sinh OR em)
 *   "học sinh" giỏi      quotes keep a phrase together
 *   -lớp                 a word with "-" in front excludes every unit that contains it
 * Matching ignores case and Vietnamese accents (and đ/d), and, when fuzzy is on, forgives one or two typos in
 * words of 5+ letters. mode "any" = at least one group, "phrase" = the whole query is one phrase, "regex" = regular expression.
 */

export type Mode = "all" | "any" | "phrase" | "regex";
export type Kind = "word" | "exact" | "fuzzy" | "regex";

export interface Term {
  raw: string;
  f: string; // folded (no accents, lower case unless matchCase)
  words: number;
}
export interface Query {
  mode: Mode;
  groups: Term[][];
  excludes: Term[];
  regex: RegExp | null;
  fuzzy: boolean;
  matchCase: boolean;
  wholeWord: boolean;
}
export interface Span {
  start: number; // offsets in the ORIGINAL text
  end: number;
  group: number;
  kind: Kind;
  text: string; // the original text covered
}
export interface Scan {
  spans: Span[];
  groups: number[]; // indexes of the groups that matched
  excluded: boolean;
}
export interface Hit {
  score: number;
  spans: Span[];
  groups: number[];
}

const COMBINING = /[̀-ͯ]/;
const WORDCH = /[\p{L}\p{N}_]/u;

/** Accent-insensitive copy of the text plus a map from each folded character back to the original offset. */
export function fold(text: string, keepCase = false): { f: string; map: number[] } {
  let f = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    let b = c === "đ" || c === "Đ" ? (c === "đ" ? "d" : "D") : c.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (!keepCase) b = b.toLowerCase();
    for (let k = 0; k < b.length; k++) {
      f += b[k];
      map.push(i);
    }
  }
  return { f, map };
}

function termOf(raw: string, matchCase: boolean): Term {
  const f = fold(raw.trim(), matchCase).f.replace(/\s+/g, " ");
  return { raw: raw.trim(), f, words: f ? f.split(" ").length : 0 };
}

/** Split on spaces outside quotes; "|" outside quotes separates alternatives. */
function tokens(q: string): { neg: boolean; alts: string[] }[] {
  const out: { neg: boolean; alts: string[] }[] = [];
  let i = 0;
  while (i < q.length) {
    while (i < q.length && /\s/.test(q[i])) i++;
    if (i >= q.length) break;
    let neg = false;
    if (q[i] === "-" && i + 1 < q.length && !/\s/.test(q[i + 1])) {
      neg = true;
      i++;
    }
    const alts: string[] = [];
    let cur = "";
    let inQ = false;
    for (; i < q.length; i++) {
      const c = q[i];
      if (c === '"') {
        inQ = !inQ;
        continue;
      }
      if (!inQ && /\s/.test(c)) break;
      if (!inQ && c === "|") {
        alts.push(cur);
        cur = "";
        continue;
      }
      cur += c;
    }
    alts.push(cur);
    const clean = alts.map((s) => s.trim()).filter(Boolean);
    if (clean.length) out.push({ neg, alts: clean });
  }
  return out;
}

export function parseQuery(
  q: string,
  o: { mode?: string; fuzzy?: boolean; matchCase?: boolean; wholeWord?: boolean } = {},
): Query {
  const text = String(q ?? "").trim();
  if (!text) throw new Error("Thiếu từ khóa tìm kiếm (query)");
  if (text.length > 400) throw new Error("Từ khóa tìm kiếm quá dài (tối đa 400 ký tự)");
  const mode: Mode = o.mode === "any" || o.mode === "phrase" || o.mode === "regex" ? o.mode : "all";
  const matchCase = !!o.matchCase;
  const base = { mode, excludes: [] as Term[], fuzzy: o.fuzzy !== false, matchCase, wholeWord: !!o.wholeWord };
  if (mode === "regex") {
    let re: RegExp;
    try {
      re = new RegExp(text, matchCase ? "gu" : "giu");
    } catch (e) {
      throw new Error("Biểu thức chính quy không hợp lệ: " + (e as Error).message);
    }
    return { ...base, groups: [[{ raw: text, f: text, words: 1 }]], regex: re, fuzzy: false };
  }
  if (mode === "phrase") return { ...base, groups: [[termOf(text, matchCase)]], regex: null };
  const groups: Term[][] = [];
  for (const t of tokens(text)) {
    const terms = t.alts.map((a) => termOf(a, matchCase)).filter((x) => x.f);
    if (!terms.length) continue;
    if (t.neg) base.excludes.push(...terms);
    else groups.push(terms);
  }
  if (!groups.length) throw new Error("Từ khóa chỉ có phần loại trừ (-từ); cần ít nhất một từ để tìm");
  return { ...base, groups, regex: null };
}

function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

const MAX_SPANS_PER_TERM = 200;

/** Find every occurrence of the query in one text. */
export function scan(text: string, q: Query): Scan {
  const spans: Span[] = [];
  if (!text) return { spans, groups: [], excluded: false };
  if (q.regex) {
    const re = new RegExp(q.regex.source, q.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && spans.length < MAX_SPANS_PER_TERM) {
      if (m[0] === "") {
        re.lastIndex++;
        continue;
      }
      spans.push({ start: m.index, end: m.index + m[0].length, group: 0, kind: "regex", text: m[0] });
    }
    return { spans, groups: spans.length ? [0] : [], excluded: false };
  }
  const { f, map } = fold(text, q.matchCase);
  const back = (fs: number, fe: number): [number, number] => {
    const s = map[fs];
    let e = map[fe - 1] + 1;
    while (e < text.length && COMBINING.test(text[e])) e++;
    return [s, e];
  };
  const isBoundary = (fs: number, fe: number) => !(fs > 0 && WORDCH.test(f[fs - 1])) && !(fe < f.length && WORDCH.test(f[fe]));
  const hitGroups = new Set<number>();
  let words: { s: number; e: number }[] | null = null;

  q.groups.forEach((terms, gi) => {
    for (const t of terms) {
      let from = 0;
      let n = 0;
      for (;;) {
        const at = f.indexOf(t.f, from);
        if (at < 0 || n >= MAX_SPANS_PER_TERM) break;
        from = at + Math.max(1, t.f.length);
        const b = isBoundary(at, at + t.f.length);
        if (q.wholeWord && !b) continue;
        const [s, e] = back(at, at + t.f.length);
        spans.push({ start: s, end: e, group: gi, kind: b ? "word" : "exact", text: text.slice(s, e) });
        hitGroups.add(gi);
        n++;
      }
    }
    if (hitGroups.has(gi) || !q.fuzzy) return;
    // typo tolerance: only when nothing matched exactly, on single words or short phrases of 5+ letters
    for (const t of terms) {
      const len = t.f.length;
      if (len < 5 || t.words > 4 || /^[\d\s.,-]+$/.test(t.f)) continue;
      const limit = len <= 8 ? 1 : 2;
      words ??= Array.from(f.matchAll(/[\p{L}\p{N}]+/gu), (m) => ({ s: m.index!, e: m.index! + m[0].length }));
      for (let i = 0; i + t.words <= words.length; i++) {
        const s = words[i].s;
        const e = words[i + t.words - 1].e;
        const w = f.slice(s, e);
        if (w[0] !== t.f[0]) continue;
        const d = distance(w, t.f, limit);
        if (d >= 1 && d <= limit) {
          const [os, oe] = back(s, e);
          spans.push({ start: os, end: oe, group: gi, kind: "fuzzy", text: text.slice(os, oe) });
          hitGroups.add(gi);
        }
      }
    }
  });

  let excluded = false;
  for (const x of q.excludes) {
    if (f.includes(x.f)) {
      excluded = true;
      break;
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  return { spans, groups: [...hitGroups].sort((a, b) => a - b), excluded };
}

/** Does a set of matched groups satisfy the query's mode? */
export function satisfied(groups: Iterable<number>, q: Query): boolean {
  const n = new Set(groups).size;
  return q.mode === "any" ? n > 0 : n === q.groups.length;
}

const WEIGHT: Record<Kind, number> = { word: 3, regex: 3, exact: 2, fuzzy: 1 };

/** Higher = better. Whole words beat parts of words beat typos; more groups, closer together, shorter units rank higher. */
export function score(scans: Scan[], texts: string[], q: Query): number {
  const best = new Map<number, number>();
  const count = new Map<number, number>();
  const first = new Map<number, number>();
  scans.forEach((s, ti) => {
    for (const sp of s.spans) {
      best.set(sp.group, Math.max(best.get(sp.group) ?? 0, WEIGHT[sp.kind]));
      count.set(sp.group, (count.get(sp.group) ?? 0) + 1);
      if (scans.length === 1 && !first.has(sp.group)) first.set(sp.group, sp.start);
      void ti;
    }
  });
  let total = 0;
  best.forEach((w, g) => (total += w + 0.3 * Math.min((count.get(g) ?? 1) - 1, 5)));
  if (q.groups.length > 1 && best.size === q.groups.length) {
    total += 2;
    const pos = [...first.values()];
    if (pos.length === q.groups.length && Math.max(...pos) - Math.min(...pos) <= 150) total += 1;
  }
  if (texts.length === 1 && texts[0].length <= 80) total += 0.5;
  return Math.round(total * 100) / 100;
}

/** One text → a hit, or null when it does not satisfy the query. */
export function matchText(text: string, q: Query): Hit | null {
  const s = scan(text, q);
  if (s.excluded || !satisfied(s.groups, q)) return null;
  return { score: score([s], [text], q), spans: s.spans, groups: s.groups };
}

/** Several texts that belong together (the cells of a spreadsheet row) → a hit when, together, they satisfy the query. */
export function matchMany(texts: string[], q: Query): { score: number; scans: Scan[] } | null {
  const scans = texts.map((t) => scan(t, q));
  if (scans.some((s) => s.excluded)) return null;
  const all = new Set<number>();
  scans.forEach((s) => s.groups.forEach((g) => all.add(g)));
  if (!satisfied(all, q)) return null;
  return { score: score(scans, texts, q), scans };
}

/** Short quote around the first match, with matches wrapped in « ». */
export function snippet(text: string, spans: Span[], width = 160): string {
  const flat = (s: string) => s.replace(/\s+/g, " ");
  if (!spans.length) return flat(text).slice(0, width);
  const start = Math.max(0, spans[0].start - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);
  let out = "";
  let at = start;
  let lastEnd = start;
  for (const sp of spans) {
    if (sp.start < lastEnd || sp.end > end) continue;
    out += text.slice(at, sp.start) + "«" + text.slice(sp.start, sp.end) + "»";
    at = sp.end;
    lastEnd = sp.end;
  }
  out += text.slice(at, end);
  return (start > 0 ? "…" : "") + flat(out).trim() + (end < text.length ? "…" : "");
}

/** The distinct pieces of the original text that matched (case and accents as in the document), for host-side search. */
export function distinctMatches(spans: Span[], max = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of spans) {
    const t = s.text.trim();
    if (!t || t.length > 255 || t.includes("^") || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- colours

export interface Swatch {
  word: string | null; // Word highlight as #RRGGBB (Word maps it to the nearest highlight it has); null = remove
  fill: string | null; // soft fill for cells / sticky notes
  strong: string | null; // saturated colour for text and outlines
}

const PALETTE: Record<string, Swatch> = {
  yellow: { word: "#FFFF00", fill: "#FFF2A8", strong: "#C79100" },
  green: { word: "#00FF00", fill: "#C6EFCE", strong: "#00803C" },
  blue: { word: "#00FFFF", fill: "#BDE7F7", strong: "#0070C0" },
  pink: { word: "#FF00FF", fill: "#F8CBE6", strong: "#C2185B" },
  red: { word: "#FF0000", fill: "#FFC7CE", strong: "#C00000" },
  orange: { word: "#FFC000", fill: "#FFE0B2", strong: "#D9600B" },
  gray: { word: "#D3D3D3", fill: "#E7E6E6", strong: "#595959" },
};
const ALIAS: Record<string, string> = {
  yellow: "yellow", vang: "yellow", brightgreen: "green", green: "green", lime: "green", "xanh la": "green", luc: "green",
  blue: "blue", turquoise: "blue", cyan: "blue", "xanh duong": "blue", xanh: "blue", pink: "pink", hong: "pink",
  red: "red", do: "red", orange: "orange", cam: "orange", gray: "gray", grey: "gray", xam: "gray",
};

/** "vàng", "Yellow", "#FF8800" → colours for each host; "none" → all null (removes marking). Unknown → throws. */
export function swatch(c: unknown, fallback = "yellow"): Swatch {
  const s = String(c ?? "").trim();
  if (!s) return PALETTE[fallback];
  if (/^(none|clear|xoa|xóa|không)$/i.test(s)) return { word: null, fill: null, strong: null };
  if (/^#[0-9a-f]{6}$/i.test(s)) return { word: s.toUpperCase(), fill: s.toUpperCase(), strong: s.toUpperCase() };
  const key = ALIAS[fold(s).f.replace(/\s+/g, " ")];
  if (!key) throw new Error(`Màu "${s}" chưa hỗ trợ. Dùng: vàng, xanh lá, xanh dương, hồng, đỏ, cam, xám, none hoặc mã #RRGGBB.`);
  return PALETTE[key];
}
