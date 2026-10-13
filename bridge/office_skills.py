"""Office skills: pick the right skill for a request, and copy the bundled skills into ~/.hermes/skills.

Router (D-007): a weak model may not choose a skill from its description, so the bridge adds the best matching
bundled skill(s) to `-s` for that chat turn. At most two, only when installed, never replacing the user's choice.
Disable with HERMES_OFFICE_AUTOSKILL=0.
"""
from __future__ import annotations

import os
import re
import shutil
import unicodedata
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

MARKER_RE = re.compile(r"^\s*origin:\s*[\"']?hermes-office[\"']?\s*$", re.M)
FRONT_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.S)
MAX_AUTO = 2


def fold(text: str) -> str:
    """Lower-case, accent-free text so that "trình chiếu" and "trinh chieu" match the same rule."""
    t = unicodedata.normalize("NFD", text.lower().replace("đ", "d"))
    return re.sub(r"\s+", " ", "".join(c for c in t if unicodedata.category(c) != "Mn")).strip()


# (host, skill, pattern on folded text). Order = priority; the first MAX_AUTO matches win.
RULES: List[Tuple[str, str, str]] = [
    ("powerpoint", "ppt-lint-fix", r"(kiem tra|soat|sua loi|lint).*(slide|trinh chieu|bo slide|deck)|(loi|chu nho|tran khung).*(slide|trinh chieu)"),
    ("powerpoint", "ppt-restyle", r"(lam dep|doi giao dien|doi mau|dep hon|restyle|bang mau|doi phong|chu to hon).*|(slide|trinh chieu).*(dep hon|doi mau)"),
    ("powerpoint", "ppt-speaker-notes", r"(loi thuyet trinh|ghi chu thuyet trinh|speaker notes?|kich ban thuyet trinh|thuyet trinh \d+ phut|loi dan)"),
    ("powerpoint", "ppt-image-sourcing", r"(them|chen|tim|doi|thay).{0,12}anh|anh minh hoa|hinh minh hoa"),
    ("powerpoint", "ppt-doc-to-slides", r"(tu|bien|chuyen).{0,30}(file|tai lieu|van ban|word|pdf|dinh kem).{0,30}(slide|trinh chieu)|(slide|trinh chieu).{0,20}(tu|theo).{0,20}(file|tai lieu|word|pdf|dinh kem)"),
    ("powerpoint", "ppt-quiz-game", r"(tro choi|game|on tap|o chu|cau do|trac nghiem|ai la trieu phu|rung chuong).*(slide|trinh chieu|powerpoint)|(slide|trinh chieu).*(tro choi|game|o chu|trac nghiem)"),
    ("powerpoint", "ppt-lesson-deck", r"(bai giang|giao an dien tu|soan slide|slide bai|trinh chieu bai|bai hoc).*|(slide|trinh chieu).{0,25}lop \d+"),
    ("powerpoint", "ppt-ad-deck", r"(quang cao|gioi thieu san pham|ra mat san pham|pitch|thuong hieu|quang ba)"),
    ("powerpoint", "ppt-deck-from-brief", r"\b(tao|lam(?! dep| lai| ro| nho| to)|soan|dung|viet|thiet ke)\b.{0,20}(file )?(trinh chieu|slide|powerpoint|bai thuyet trinh|deck)|^(trinh chieu|slide|powerpoint) (ve|cho|cua) "),
    ("word", "word-proofread-vn", r"(soat|ra soat|sua|kiem tra).{0,15}(loi|chinh ta|dau|van phong)|chinh ta|proofread|thong nhat thuat ngu"),
    ("word", "word-format-vn-admin", r"(the thuc|hanh chinh|nghi dinh 30|chuan hoa van ban|trinh bay van ban|cong van|le trang)"),
    ("word", "word-summarize-doc", r"tom tat (tai lieu|van ban|ca bai|toan bo|bao cao|file|bai nay)|tom tat.{0,25}(1|mot) trang"),
    ("word", "word-exam-builder", r"(de kiem tra|de thi|ma tran|bai kiem tra|de cuong on tap|thang diem|dap an)"),
    ("word", "word-letter-forms", r"(don xin|don de nghi|bien ban|quyet dinh|giay moi|to trinh|thu moi|giay gioi thieu|giay xac nhan|hop dong)"),
    ("word", "word-translate-keep-format", r"\bdich\b|translate"),
    ("word", "word-structure-fix", r"(muc luc|heading|danh so tieu de|chuan hoa tieu de|tieu de.{0,10}(1|2|3)|cau truc van ban)"),
    ("word", "word-table-from-text", r"(thanh bang|chuyen.{0,25}bang|lap bang tu|bien doan nay thanh bang)"),
    ("word", "word-report-from-brief", r"\b(viet|soan|lam|tao)\b.{0,20}(bao cao|bai thu hoach|tieu luan|bai viet|de an|bai phat bieu|bai tham luan)"),
    ("excel", "excel-formula-doctor", r"(cong thuc|#ref|#div|#n/a|#value|#name|vlookup|xlookup|giai thich ham|sua loi cong thuc)"),
    ("excel", "excel-clean-data", r"(lam sach|bo trung|trung lap|chuan hoa (ngay|so|du lieu|bang)|don dep|khoang trang thua)"),
    ("excel", "excel-grade-sheet", r"(bang diem|xep loai|chia nhom|diem trung binh|xep hang|diem tong ket|so diem)"),
    ("excel", "excel-compare-sheets", r"so sanh.{0,25}(bang|sheet|trang tinh|cot|danh sach)"),
    ("excel", "excel-data-from-doc", r"(lay|trich|chuyen|dua).{0,25}(bang|du lieu).{0,25}(pdf|word|dinh kem|tai lieu)|(pdf|word).{0,25}vao excel"),
    ("excel", "excel-schedule-builder", r"(thoi khoa bieu|lich truc|lich lam viec|phan cong|xep lich|lich thi|lich hoc)"),
    ("excel", "excel-budget-planner", r"(chi tieu|ngan sach|thu chi|budget|quan ly tien|so quy)"),
    ("excel", "excel-dashboard", r"(tong quan|dashboard|bieu do|bao cao nhanh|thong ke|trang tong hop)"),
    ("any", "office-qa-checklist", r"(kiem tra chat luong|ra soat chat luong|qa|checklist|tieu chuan trinh bay)"),
    ("any", "office-quick-actions", r"^(tom tat|viet lai|rut gon|doi giong|giai thich|dich).{0,12}(doan|dong|cau|vung chon|phan (nay|chon)|o nay|noi dung (nay|chon))"),
]
_COMPILED = [(h, s, re.compile(p)) for h, s, p in RULES]
BIG_JOB_RE = re.compile(r"(nhieu buoc|tung buoc|ke hoach|toan bo|ca bo|het cac|tat ca)")


# A specialist already covers the generic deck builder; a deck builder already covers the small PowerPoint skills.
SPECIALISTS = {"ppt-ad-deck", "ppt-lesson-deck", "ppt-doc-to-slides", "ppt-quiz-game"}
CREATORS = SPECIALISTS | {"ppt-deck-from-brief"}
SUBORDINATES = {"ppt-image-sourcing", "ppt-speaker-notes", "ppt-restyle", "ppt-lint-fix"}


def route_skills(text: str, host: str, is_installed: Callable[[str], bool], already: Optional[List[str]] = None) -> List[str]:
    """Skill names to add for this turn (never more than MAX_AUTO, never ones already active, only installed ones)."""
    if os.environ.get("HERMES_OFFICE_AUTOSKILL", "1") in ("0", "false", "off"):
        return []
    t = fold(text or "")
    if not t:
        return []
    have = set(already or [])
    found: List[str] = []
    for h, skill, rx in _COMPILED:
        if h in ("any", host) and skill not in found and rx.search(t):
            found.append(skill)
    if set(found) & SPECIALISTS:
        found = [x for x in found if x != "ppt-deck-from-brief"]
    if set(found) & CREATORS:
        found = [x for x in found if x not in SUBORDINATES]
    found = [x for x in found if x not in have and is_installed(x)][:MAX_AUTO]
    if not found and len(t) > 160 and BIG_JOB_RE.search(t) and "office-plan-first" not in have and is_installed("office-plan-first"):
        found.append("office-plan-first")
    return found


# --------------------------------------------------------------------------- install bundled skills


def _front(text: str) -> str:
    m = FRONT_RE.match(text)
    return m.group(1) if m else ""


def is_bundled(text: str) -> bool:
    return bool(MARKER_RE.search(_front(text)))


def sync_bundled_skills(src: Path, dst: Path, dry_run: bool = False) -> Dict[str, Any]:
    """Copy skills/<name>/ marked `origin: hermes-office` into <dst>/<name>/.

    Never overwrites a skill that lacks the mark (the user's own); keeps SKILL.md.bak when it upgrades one.
    """
    report: Dict[str, Any] = {"installed": [], "updated": [], "unchanged": [], "skipped": [], "errors": []}
    if not src.is_dir():
        report["errors"].append(f"không thấy thư mục skill: {src}")
        return report
    for d in sorted(p for p in src.iterdir() if p.is_dir()):
        skill_file = d / "SKILL.md"
        if not skill_file.is_file():
            continue
        try:
            text = skill_file.read_text(encoding="utf-8")
            if not is_bundled(text):
                report["skipped"].append(d.name)  # e.g. office-user-style: installed by other means
                continue
            target = dst / d.name / "SKILL.md"
            if target.is_file():
                old = target.read_text(encoding="utf-8")
                if old == text:
                    report["unchanged"].append(d.name)
                    continue
                if not is_bundled(old):
                    report["skipped"].append(f"{d.name} (bản của bạn, không ghi đè)")
                    continue
                if not dry_run:
                    shutil.copy2(target, target.with_suffix(".md.bak"))
                report["updated"].append(d.name)
            else:
                report["installed"].append(d.name)
            if not dry_run:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text, encoding="utf-8")
                for extra in d.rglob("*"):
                    if extra.is_file() and extra != skill_file:
                        out = target.parent / extra.relative_to(d)
                        out.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(extra, out)
        except OSError as exc:
            report["errors"].append(f"{d.name}: {exc}")
    return report
