"""The bridge's "executive": decides, before any model runs, how big a request is and how to run it.

Pure functions (tests: bridge/tests/test_executive.py). No model call, no I/O: a decision costs well under a millisecond.

  fast      one small action (colour, find, replace, reformat, rewrite a sentence): small/fast model, low reasoning,
            slim prompt, a few rounds. If it stumbles it is promoted to `standard` by `escalate`.
  standard  normal editing or writing: core model, medium reasoning.
  heavy     decks, reports, exams, batch work, long or attached-document jobs: strongest model, high reasoning.

What the user chose by hand always wins: a model picked in the UI is never replaced, a reasoning level picked in the UI
is never replaced; only the prompt size and the number of rounds still follow the tier.
Set HERMES_OFFICE_TIERING=0 to turn the whole thing off (everything runs as `standard` with the old behaviour).
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, replace
from typing import Dict, Iterable, List, Optional, Sequence

from office_skills import fold

TIERS = ("fast", "standard", "heavy")
MODEL_KEY = {"fast": "fast", "standard": "core", "heavy": "heavy"}
REASONING = {"fast": "low", "standard": "medium", "heavy": "high"}
FAST_ROUNDS = 4
STANDARD_ROUNDS = 8


def enabled() -> bool:
    return os.environ.get("HERMES_OFFICE_TIERING", "1").lower() not in ("0", "false", "off")


@dataclass(frozen=True)
class Plan:
    tier: str
    model_key: str  # "fast" | "core" | "heavy"
    reasoning: str
    max_rounds: int
    why: str


def _plan(tier: str, why: str, max_rounds: int) -> Plan:
    rounds = {"fast": min(FAST_ROUNDS, max_rounds), "standard": min(STANDARD_ROUNDS, max_rounds), "heavy": max_rounds}[tier]
    return Plan(tier, MODEL_KEY[tier], REASONING[tier], rounds, why)


# Skills whose job is big by nature (see office_skills.RULES).
HEAVY_SKILLS = {
    "ppt-deck-from-brief", "ppt-lesson-deck", "ppt-ad-deck", "ppt-doc-to-slides", "ppt-quiz-game", "ppt-restyle", "ppt-lint-fix",
    "word-report-from-brief", "word-exam-builder", "word-summarize-doc", "word-translate-keep-format", "word-structure-fix",
    "excel-dashboard", "excel-budget-planner", "excel-schedule-builder", "excel-data-from-doc", "excel-grade-sheet", "office-plan-first",
}

# Scope words: the job covers a whole document / deck / sheet, or converts one thing into another.
_SCOPE = [
    r"\b(toan bo|tat ca|het cac|hang loat|ca (bai|file|tai lieu|bo|sach)|moi (cau|slide|trang|o|dong|cot|muc))\b",
    r"\b(chuyen|bien|doi|dua)\b.{0,30}\b(thanh|sang|vao)\b.{0,25}\b(bai thuyet trinh|slide|bo slide|powerpoint|bao cao|word|excel|bang tinh|de thi)\b",
    r"\b(nhieu buoc|tung buoc|ke hoach)\b",
]
# Kind words: the thing being made is big by nature. One alone in a short request is not enough.
_KIND = [
    r"\b(bao cao|de thi|de kiem tra|giao an|bai giang|de cuong|sang kien|thuyet minh|phan tich|so sanh|nghien cuu|tong hop|ma tran)\b",
    r"\b(tao|lam|soan|thiet ke|viet|xay dung|lap)\b.{0,30}\b(bo slide|bai thuyet trinh|powerpoint|bai giang|bao cao|de thi|dashboard|trang tong hop|bang diem|thoi khoa bieu|bai viet|tieu luan)\b",
]
_BIG_COUNT = re.compile(r"\b(\d{1,3})\s*(slide|trang|cau|bai|y|muc|phan|chuong|dong|cot|hoc sinh|lop)\b")
# Mechanical verbs: one tool call even when applied to "all": never heavy because of a scope word.
_MECH = re.compile(
    r"\b(to (mau|vang|do|xanh|sang|hong|cam)|danh dau|highlight|doi mau|in dam|in nghieng|gach chan|can (le|giua|trai|phai|deu)|co chu|"
    r"doi (font|phong|co chu)|xoa|thay|tim|dem|binh luan|ghi chu|chu thich|dinh dang)\b"
)
_FAST = re.compile(
    _MECH.pattern[:-3] + r"|doi (ten|chu)|sua (loi|chinh ta|cau|doan|chu|dau)|viet lai|rut gon|dich|tom tat (doan|cau|dong|o|vung)|"
    r"chen (dong|cot|bang|cong thuc|chu)|giai thich|la gi|nghia la)\b"
)


def classify(
    text: str,
    host: str,
    *,
    context: str = "",
    attachments: int = 0,
    big_attachment: bool = False,
    history_turns: int = 0,
    skills: Iterable[str] = (),
    forced: Optional[str] = None,
    max_rounds: int = 14,
) -> Plan:
    """Tier for one request. `forced` ('fast'|'standard'|'heavy') is the user's own choice and always wins."""
    if forced in TIERS:
        return _plan(forced, "do bạn chọn", max_rounds)
    if not enabled():
        return Plan("standard", "core", "", max_rounds, "tắt phân loại")
    t = fold(text or "")
    words = len(t.split())
    mech = bool(_MECH.search(t))
    big: List[str] = []
    skill_set = set(skills) & HEAVY_SKILLS
    if skill_set:
        big.append("kỹ năng lớn: " + ", ".join(sorted(skill_set)))
    if big_attachment:
        big.append("tài liệu đính kèm lớn")
    if words > 60:
        big.append("yêu cầu dài")
    scope = [m.group(0)[:30] for rx in _SCOPE if (m := re.search(rx, t))]
    if scope and not mech:
        big.append("phạm vi lớn: '" + scope[0] + "'")
    kinds = [m.group(0)[:30] for rx in _KIND if (m := re.search(rx, t))]
    counts = [f"{m.group(1)} {m.group(2)}" for m in _BIG_COUNT.finditer(t) if int(m.group(1)) >= 6]
    weak = kinds + counts
    if len(weak) >= 2 or (weak and words > 14):
        big.append("việc lớn: " + ", ".join(weak[:2]))
    if big:
        return _plan("heavy", "; ".join(big[:3]), max_rounds)
    if words <= 28 and _FAST.search(t) and attachments == 0:
        return _plan("fast", "việc nhỏ, một thao tác", max_rounds)
    if history_turns > 0 and words <= 8 and attachments == 0:
        return _plan("fast", "câu nói tiếp ngắn", max_rounds)
    return _plan("standard", "việc vừa", max_rounds)


def escalate(plan: Plan, why: str, max_rounds: int = 14) -> Plan:
    """One tier up (fast → standard → heavy). The reason is kept for the log."""
    nxt = {"fast": "standard", "standard": "heavy"}.get(plan.tier)
    if not nxt:
        return plan
    p = _plan(nxt, why, max_rounds)
    return replace(p, max_rounds=max(p.max_rounds, plan.max_rounds))


# ---------------------------------------------------------------------------------------------- slimmer prompts

# tool families that cost prompt space and are rarely needed: shown only when the request or attachments call for them
_OPTIONAL: Dict[str, str] = {
    "office_web_": r"\b(anh|hinh|tim tren (mang|web)|web|internet|nguon|minh hoa|wikipedia|tra cuu)\b",
    "office_design_": r"\b(mau|phong|giao dien|dep|thiet ke|palette|bang mau|theme|lam moi)\b",
    "office_calc_": r"\b(chia diem|chia nhom|diem|nhom|xep hang|thang diem)\b",
    "office_style_": r"\b(thoi quen|phong cach|style|ghi nho|nho giup)\b",
}


def select_tools(plan: Plan, text: str, names: Sequence[str], has_docs: bool = False) -> List[str]:
    """Tool names to list in the prompt. Heavy lists everything; the others drop only the optional families."""
    if plan.tier == "heavy" or not enabled():
        return list(names)
    t = fold(text or "")
    out: List[str] = []
    for n in names:
        if n.startswith("office_doc_"):
            if has_docs:
                out.append(n)
            continue
        fam = next((p for p in _OPTIONAL if n.startswith(p)), None)
        if fam and not re.search(_OPTIONAL[fam], t):
            continue
        out.append(n)
    return out


_MATH = re.compile(r"\b(cong thuc|phuong trinh|latex|hoa hoc|vat ly|toan|ham so|dao ham|tich phan|mol|phan ung)\b|\$")
_WEB = _OPTIONAL["office_web_"]


def slim_preamble(preamble: str, plan: Plan, host: str, text: str) -> str:
    """Drop the long reference paragraphs (maths, PowerPoint batch rules, web rules) that this request cannot use."""
    if plan.tier == "heavy" or not enabled():
        return preamble
    t = fold(text or "")
    out = []
    for para in preamble.split("\n\n"):
        if para.startswith("Math, physics and chemistry") and not (host == "word" and _MATH.search(t)):
            continue
        if para.startswith("PowerPoint formatting") and host != "powerpoint":
            continue
        if para.startswith("Web and pictures:") and not re.search(_WEB, t):
            continue
        out.append(para)
    return "\n\n".join(out)
