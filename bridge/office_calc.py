"""Small exact calculators the Office skills call instead of doing arithmetic "in the head".

Both tools are pure functions (no network, no document access):
  * office_calc_split_points: share a total score among questions in exact multiples of a step (0.25, 0.125 ...)
  * office_calc_balanced_groups: split students into groups whose average scores are as even as possible
"""
from __future__ import annotations

import time
from fractions import Fraction
from typing import Any, Dict, List

MAX_ITEMS = 500


class CalcError(ValueError):
    """Bad input; the message is shown to the model and the user."""


def _frac(value: Any, what: str) -> Fraction:
    try:
        if isinstance(value, bool):
            raise ValueError
        return Fraction(str(value).strip().replace(",", "."))
    except (ValueError, ZeroDivisionError):
        raise CalcError(f"{what} không phải là số: {value!r}") from None


def _num(f: Fraction) -> float:
    return round(float(f), 6)


def split_points(args: Dict[str, Any]) -> Dict[str, Any]:
    weights = args.get("weights")
    if not isinstance(weights, list) or not weights or len(weights) > MAX_ITEMS:
        raise CalcError(f"weights phải là danh sách 1-{MAX_ITEMS} số dương")
    w = [_frac(x, "trọng số") for x in weights]
    if any(x <= 0 for x in w):
        raise CalcError("mọi trọng số phải lớn hơn 0")
    total = _frac(args.get("total", 10), "tổng điểm")
    step = _frac(args.get("step", "0.25"), "bước điểm")
    if total <= 0 or step <= 0:
        raise CalcError("tổng điểm và bước điểm phải lớn hơn 0")
    units_f = total / step
    if units_f.denominator != 1:
        raise CalcError(f"tổng {total} không chia hết cho bước {step}")
    units = int(units_f)
    n = len(w)
    if units < n:
        raise CalcError(f"không đủ điểm: {n} câu cần ít nhất {_num(step * n)} điểm với bước {_num(step)}")
    base = [1] * n  # every question gets at least one step
    extra = units - n
    sw = sum(w)
    raw = [extra * x / sw for x in w]
    alloc = [int(r) for r in raw]  # floor of a non-negative Fraction
    left = extra - sum(alloc)
    # largest remainder first; on a tie the heavier question, then the earlier one, gets the extra step
    order = sorted(range(n), key=lambda i: (-(raw[i] - alloc[i]), -w[i], i))
    for i in order[:left]:
        alloc[i] += 1
    pts = [(base[i] + alloc[i]) * step for i in range(n)]
    assert sum(pts) == total
    return {"ok": True, "points": [_num(p) for p in pts], "total": _num(sum(pts)), "step": _num(step), "count": n,
            "note": "Mỗi điểm là bội của bước; tổng đúng bằng tổng điểm yêu cầu."}


def _mean(group: List[int], scores: List[Fraction]) -> Fraction:
    return sum((scores[i] for i in group), Fraction(0)) / len(group) if group else Fraction(0)


def _spread_cost(sums: List[float], counts: List[int]) -> float:
    """Sum of squared distances of the group means from their own average."""
    means = [s / c for s, c in zip(sums, counts)]
    avg = sum(means) / len(means)
    return sum((m - avg) ** 2 for m in means)


GROUPS_MAX_ITEMS = 300
SEARCH_SECONDS = 3.0


def balanced_groups(args: Dict[str, Any]) -> Dict[str, Any]:
    items = args.get("items")
    if not isinstance(items, list) or len(items) < 2 or len(items) > GROUPS_MAX_ITEMS:
        raise CalcError(f"items phải là danh sách 2-{GROUPS_MAX_ITEMS} học sinh dạng {{name, score}}")
    names: List[str] = []
    scores: List[Fraction] = []
    for k, it in enumerate(items):
        if not isinstance(it, dict) or "score" not in it:
            raise CalcError(f"mục {k + 1} cần có name và score")
        names.append(str(it.get("name", f"#{k + 1}")))
        scores.append(_frac(it["score"], f"điểm của {names[-1]}"))
    try:
        g = int(args.get("groups", 0))
    except (TypeError, ValueError):
        g = 0
    if g < 2 or g > len(items):
        raise CalcError(f"số nhóm phải từ 2 đến {len(items)}")
    order = sorted(range(len(items)), key=lambda i: (-scores[i], names[i], i))
    groups: List[List[int]] = [[] for _ in range(g)]
    for pos, i in enumerate(order):  # snake draft: 1..g, g..1, 1..g ...
        lap, col = divmod(pos, g)
        groups[col if lap % 2 == 0 else g - 1 - col].append(i)
    fs = [float(x) for x in scores]
    sums = [sum(fs[i] for i in grp) for grp in groups]
    counts = [len(grp) for grp in groups]
    cost = _spread_cost(sums, counts)
    deadline = time.monotonic() + SEARCH_SECONDS
    while time.monotonic() < deadline:  # best single swap between two groups, until none improves
        best = None
        for a in range(g):
            for b in range(a + 1, g):
                for x, ix in enumerate(groups[a]):
                    for y, iy in enumerate(groups[b]):
                        d = fs[iy] - fs[ix]
                        if d == 0:
                            continue
                        sums[a] += d
                        sums[b] -= d
                        c = _spread_cost(sums, counts)
                        sums[a] -= d
                        sums[b] += d
                        if c < cost - 1e-12 and (best is None or c < best[0]):
                            best = (c, a, b, x, y)
        if best is None:
            break
        cost, a, b, x, y = best
        ix, iy = groups[a][x], groups[b][y]
        groups[a][x], groups[b][y] = iy, ix
        d = fs[iy] - fs[ix]
        sums[a] += d
        sums[b] -= d
    out = []
    for k, grp in enumerate(groups, 1):
        grp = sorted(grp, key=lambda i: (-scores[i], names[i]))
        out.append({"group": k, "count": len(grp), "mean": round(float(_mean(grp, scores)), 3),
                    "members": [{"name": names[i], "score": _num(scores[i])} for i in grp]})
    means = [x["mean"] for x in out]
    return {"ok": True, "groups": out, "sizes": [x["count"] for x in out], "spread": round(max(means) - min(means), 3),
            "note": "Sĩ số các nhóm chênh nhau tối đa 1; điểm trung bình các nhóm được cân bằng."}


CALC_TOOLS: Dict[str, Dict[str, Any]] = {
    "office_calc_split_points": {"host": "bridge", "args": {
        "weights": "number[] relative weight of each question (e.g. difficulty); all > 0",
        "total": "total score (default 10)", "step": "smallest unit, e.g. 0.25 or 0.125 (default 0.25); total must be a multiple"}},
    "office_calc_balanced_groups": {"host": "bridge", "args": {
        "items": "[{\"name\": string, \"score\": number}] (2-300 students)", "groups": "number of groups (2..students)"}},
}

_HANDLERS = {"office_calc_split_points": split_points, "office_calc_balanced_groups": balanced_groups}


def run_calc_tool(tool: str, args: Dict[str, Any]) -> Dict[str, Any]:
    return _HANDLERS[tool](args or {})
