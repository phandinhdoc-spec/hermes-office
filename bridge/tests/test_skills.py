"""Static checks of the bundled Office skills: format, tool names, argument names, router and installer."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SKILLS = ROOT / "skills"
sys.path.insert(0, str(ROOT / "bridge"))

import hermes_office_bridge as bridge  # noqa: E402
import office_skills  # noqa: E402

try:
    import yaml
except ImportError:  # the check below falls back to a small parser
    yaml = None

SECTIONS = ["## Dùng khi", "## Câu hỏi (nhiều nhất một)", "## Các bước (tự chạy, không chờ xác nhận từng bước)", "## Tiêu chí chất lượng",
            "## Tự kiểm tra trước khi báo xong", "## Báo cáo cuối (tối đa 5 dòng)", "## Nguyên tắc chung"]


def front(text: str) -> dict:
    m = office_skills.FRONT_RE.match(text)
    assert m, "thiếu frontmatter"
    if yaml:
        return yaml.safe_load(m.group(1))
    d: dict = {}
    for line in m.group(1).splitlines():
        if re.match(r"^[a-z]+:", line):
            k, _, v = line.partition(":")
            d[k] = v.strip().strip('"')
    return d


def bundled():
    out = []
    for d in sorted(p for p in SKILLS.iterdir() if p.is_dir()):
        text = (d / "SKILL.md").read_text(encoding="utf-8")
        if office_skills.is_bundled(text):
            out.append((d.name, text))
    return out


def top_level_keys(src: str):
    """Keys of the first JSON-like object at the start of src (which begins with '{'); None if braces do not balance."""
    depth, i, keys, in_str, esc, start = 0, 0, [], False, False, None
    while i < len(src):
        ch = src[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
                if depth == 1 and start is not None and src[i + 1:i + 2] == ":":
                    keys.append(src[start:i])
        else:
            if ch == '"':
                in_str, start = True, i + 1
            elif ch in "{[":
                depth += 1
            elif ch in "}]":
                depth -= 1
                if depth == 0:
                    return keys
        i += 1
    return None


def test_counts():
    names = [n for n, _ in bundled()]
    assert len(names) >= 24
    by_host = {"powerpoint": 0, "word": 0, "excel": 0}
    for n, t in bundled():
        tags = front(t)["metadata"]["hermes"]["tags"]
        for h in by_host:
            if h in tags and len(tags) == 2:
                by_host[h] += 1
    assert all(v >= 8 for v in by_host.values()), by_host


@pytest.mark.parametrize("name,text", bundled(), ids=[n for n, _ in bundled()])
def test_skill_format(name, text):
    fm = front(text)
    assert fm["name"] == name
    desc = fm["description"]
    assert desc.startswith("Dùng khi") and 20 < len(desc) <= 230, desc
    assert fm["metadata"]["hermes"]["origin"] == "hermes-office"
    pos = [text.find(s) for s in SECTIONS]
    assert all(p >= 0 for p in pos), dict(zip(SECTIONS, pos))
    assert pos == sorted(pos), "các mục sai thứ tự"
    steps = text.split(SECTIONS[2])[1].split("\n## ")[0]
    assert len(re.findall(r"^\d+\. ", steps, re.M)) >= 3
    report = text.split(SECTIONS[5])[1].split("\n## ")[0]
    lines = [x for x in report.strip().splitlines() if x.strip()]
    assert 1 <= len(lines) <= 5, f"báo cáo cuối {len(lines)} dòng"
    question = text.split(SECTIONS[1])[1].split("\n## ")[0].strip()
    assert question and question.count("?") <= 2


@pytest.mark.parametrize("name,text", bundled(), ids=[n for n, _ in bundled()])
def test_tools_and_args_exist(name, text):
    known = set(bridge.TOOLS)
    for tool in set(re.findall(r"office_[a-z_]+", text)):
        assert tool in known, f"{name}: công cụ không có: {tool}"
    for m in re.finditer(r"`(office_[a-z_]+)`\s*(\{)", text):
        tool, at = m.group(1), m.start(2)
        keys = top_level_keys(text[at:at + 1500])
        if keys is None:
            continue
        allowed = set(bridge.TOOLS[tool]["args"])
        bad = [k for k in keys if k not in allowed]
        assert not bad, f"{name}: {tool} không có đối số {bad} (có: {sorted(allowed)})"


@pytest.mark.parametrize("name,text", bundled(), ids=[n for n, _ in bundled()])
def test_skill_references_exist(name, text):
    for ref in re.findall(r"skill `([a-z0-9-]+)`", text):
        assert (SKILLS / ref / "SKILL.md").is_file(), f"{name}: skill không có: {ref}"


@pytest.mark.parametrize("name,text", bundled(), ids=[n for n, _ in bundled()])
def test_no_dangerous_whole_replace(name, text):
    for m in re.finditer(r"office_word_set_range[^\n]{0,80}whole", text):
        ctx = text[max(0, m.start() - 120): m.start()]
        assert "Không dùng" in ctx or "không dùng" in ctx, f"{name}: dùng set_range whole mà không cảnh báo"


def test_router_targets_exist_and_sync(tmp_path):
    names = {n for n, _ in bundled()}
    for host, skill, _ in office_skills.RULES:
        assert skill in names, skill
    rep = office_skills.sync_bundled_skills(SKILLS, tmp_path)
    assert len(rep["installed"]) == len(names) and not rep["errors"]
    assert "office-user-style" in rep["skipped"]
    again = office_skills.sync_bundled_skills(SKILLS, tmp_path)
    assert len(again["unchanged"]) == len(names) and not again["installed"] and not again["updated"]
