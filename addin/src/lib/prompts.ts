/** Fill-in slots in a prompt are written in square brackets: "Tôi thích ăn [cơm]". */
export const TOKEN_SRC = "\\[[^\\[\\]\\n]{1,80}\\]";

export function findTokens(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const m of text.matchAll(new RegExp(TOKEN_SRC, "g"))) out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] });
  return out;
}
