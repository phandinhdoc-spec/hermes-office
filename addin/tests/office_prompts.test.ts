import test from "node:test";
import assert from "node:assert/strict";
import { OFFICE_PROMPTS, officePromptsFor, skillGroup } from "../src/lib/officePrompts.ts";
import { findTokens } from "../src/lib/prompts.ts";

test("6 to 10 built-in Office prompts, each with at least one [slot] in both languages", () => {
  assert.ok(OFFICE_PROMPTS.length >= 6 && OFFICE_PROMPTS.length <= 10);
  for (const p of OFFICE_PROMPTS) {
    assert.ok(findTokens(p.vi.prompt).length >= 1, p.id + " vi");
    assert.ok(findTokens(p.en.prompt).length >= 1, p.id + " en");
  }
  assert.equal(new Set(OFFICE_PROMPTS.map((p) => p.id)).size, OFFICE_PROMPTS.length);
});

test("each app shows its own prompts only", () => {
  for (const host of ["powerpoint", "word", "excel"] as const) {
    const list = officePromptsFor(host, "vi");
    assert.ok(list.length >= 2, host);
    assert.ok(list.every((x) => x.id.startsWith("office-")));
  }
  assert.equal(officePromptsFor("unknown", "vi").length, 0);
});

test("skills of the open app come first, then other Office skills, then the rest", () => {
  const names = ["my-skill", "word-proofread-vn", "office-plan-first", "ppt-restyle", "excel-clean-data"];
  const sorted = [...names].sort((a, b) => skillGroup(a, "word") - skillGroup(b, "word"));
  assert.equal(sorted[0], "word-proofread-vn");
  assert.equal(sorted[sorted.length - 1], "my-skill");
  assert.equal(skillGroup("ppt-restyle", "powerpoint"), 0);
  assert.equal(skillGroup("ppt-restyle", "excel"), 1);
  assert.equal(skillGroup("ppt-restyle", "unknown"), 1);
});
