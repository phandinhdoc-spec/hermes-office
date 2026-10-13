"""The four places a tool is registered must agree: bridge TOOLS, addin/src/office/*.ts, tools.ts, toolLabels.ts."""
import re
from pathlib import Path

import hermes_office_bridge as bridge
import office_calc
import office_tools_extra
import office_web

SRC = Path(__file__).resolve().parents[2] / "addin" / "src"


def ts_tools(path: Path):
    return set(re.findall(r"^\s*(office_[a-z_]+)\s*:", path.read_text(encoding="utf-8"), re.M))


def extra_ts():
    names = set()
    for f in ("ppt_extra.ts", "word_extra.ts", "excel_extra.ts"):
        names |= ts_tools(SRC / "office" / f)
    return names


def test_every_new_taskpane_tool_is_implemented_exactly_once():
    spec = set(office_tools_extra.EXTRA_TOOLS)
    impl = extra_ts()
    assert spec == impl, {"only_in_bridge": sorted(spec - impl), "only_in_ts": sorted(impl - spec)}
    tools_src = (SRC / "office" / "tools.ts").read_text(encoding="utf-8")
    assert tools_src.index("...extraTools") < tools_src.index("office_word_get_selection"), "extraTools must come first so tools.ts entries win"
    assert ts_tools(SRC / "office" / "extra.ts") == set()  # extra.ts only spreads the tables
    assert ts_tools(SRC / "office" / "compat_extra.ts") == {"office_word_get_page_setup", "office_word_set_page_setup", "office_word_apply_style", "office_excel_design_table", "office_ppt_apply_palette"}


def test_every_bridge_tool_for_the_taskpane_exists_in_tools_ts():
    tools_ts = ts_tools(SRC / "office" / "tools.ts") | extra_ts() | ts_tools(SRC / "office" / "compat_extra.ts")
    taskpane = {n for n, t in bridge.TOOLS.items() if t["host"] != "bridge" and not n.startswith("office_doc_")}
    missing = taskpane - tools_ts
    assert not missing, sorted(missing)


def test_every_tool_has_a_label():
    labels = set(re.findall(r'^\s*\["([a-z_]+)",', (SRC / "lib" / "toolLabels.ts").read_text(encoding="utf-8"), re.M))
    new = set(office_tools_extra.EXTRA_TOOLS) | set(office_web.WEB_TOOLS) | set(office_calc.CALC_TOOLS)
    missing = {n for n in new if n.removeprefix("office_") not in labels}
    assert not missing, sorted(missing)


def test_changing_vs_reading_follows_the_name_rule():
    for name in [*office_tools_extra.EXTRA_TOOLS, *office_web.WEB_TOOLS, *office_calc.CALC_TOOLS]:
        reading = "_get_" in name or "_list_" in name
        host = bridge.TOOLS[name]["host"]
        if host == "bridge":
            assert name not in bridge.MUTATING, f"{name}: bridge-local tools must not need approval"
        else:
            assert (name not in bridge.MUTATING) == reading, name


def test_registered_with_the_agent_prompt_and_tool_list():
    for name in [*office_tools_extra.EXTRA_TOOLS, *office_web.WEB_TOOLS, *office_calc.CALC_TOOLS]:
        assert name in bridge.TOOLS and isinstance(bridge.TOOLS[name]["args"], dict)
