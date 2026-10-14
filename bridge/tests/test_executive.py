"""The executive decides tier, model key, reasoning, rounds and prompt size without calling any model."""
import pytest

import office_executive as ex


def tier(text, host="word", **kw):
    return ex.classify(text, host, **kw).tier


@pytest.mark.parametrize("text", [
    "tô vàng các câu có từ quang hợp",
    "đổi màu chữ này thành đỏ",
    "tìm chữ 'năng lượng' trong bài",
    "viết lại câu này cho gọn",
    "dịch đoạn này sang tiếng Anh",
    "căn giữa tiêu đề",
    "thêm bình luận vào ô B3",
    "giải thích công thức này",
])
def test_small_jobs_are_fast(text):
    assert tier(text) == "fast"


@pytest.mark.parametrize("text", [
    "làm bộ slide 15 trang về quang hợp cho lớp 8",
    "soạn đề kiểm tra 45 phút môn KHTN lớp 7 có ma trận và đáp án",
    "tạo báo cáo tổng hợp điểm của tất cả các lớp",
    "sửa lỗi chính tả toàn bộ tài liệu này",
    "chuyển file Word đính kèm thành bài thuyết trình",
])
def test_big_jobs_are_heavy(text):
    assert tier(text) == "heavy"


def test_signals_that_force_heavy():
    assert tier("làm đẹp", skills=["ppt-deck-from-brief"]) == "heavy"
    assert tier("tóm tắt", big_attachment=True) == "heavy"
    assert tier(" ".join(["từ"] * 80)) == "heavy"


def test_one_weak_word_in_a_short_request_is_not_heavy():
    assert tier("tô vàng chữ báo cáo") == "fast"
    assert tier("in đậm tiêu đề báo cáo") == "fast"


def test_followups_and_default():
    assert tier("còn dòng dưới thì sao", history_turns=2) == "fast"
    assert tier("viết cho mình một đoạn mở bài về ô nhiễm nhựa, khoảng 120 chữ, giọng gần gũi với học sinh lớp 6") == "standard"


def test_forced_tier_wins_and_off_switch(monkeypatch):
    assert ex.classify("tô vàng", "word", forced="heavy").tier == "heavy"
    monkeypatch.setenv("HERMES_OFFICE_TIERING", "0")
    p = ex.classify("tô vàng", "word")
    assert p.tier == "standard" and p.reasoning == ""
    assert ex.select_tools(p, "x", ["office_web_search"]) == ["office_web_search"]


def test_plan_fields_and_rounds():
    f, s, h = (ex.classify(t, "word", max_rounds=14) for t in ("tô vàng chữ này", "viết đoạn mở bài về ô nhiễm nhựa cho lớp 6 thật gần gũi nhé", "làm bộ slide 12 trang về quang hợp"))
    assert (f.model_key, f.reasoning, f.max_rounds) == ("fast", "low", 4)
    assert (s.model_key, s.reasoning, s.max_rounds) == ("core", "medium", 8)
    assert (h.model_key, h.reasoning, h.max_rounds) == ("heavy", "high", 14)
    assert ex.classify("tô vàng", "word", max_rounds=3).max_rounds == 3


def test_escalate_goes_up_and_never_loses_rounds():
    f = ex.classify("tô vàng chữ này", "word")
    s = ex.escalate(f, "lỗi công cụ 2 lần")
    assert s.tier == "standard" and s.model_key == "core" and s.max_rounds >= f.max_rounds
    h = ex.escalate(s, "x")
    assert h.tier == "heavy" and ex.escalate(h, "x") is h


def test_tool_list_is_slimmed_but_never_for_heavy():
    names = ["office_word_get_selection", "office_web_search", "office_design_palette", "office_calc_split_points", "office_style_get_profile", "office_doc_search"]
    fast = ex.classify("tô vàng chữ này", "word")
    assert ex.select_tools(fast, "tô vàng chữ này", names) == ["office_word_get_selection"]
    assert "office_web_search" in ex.select_tools(fast, "tìm ảnh minh họa", names)
    assert "office_doc_search" in ex.select_tools(fast, "tô vàng", names, has_docs=True)
    heavy = ex.classify("làm bộ slide 12 trang", "powerpoint")
    assert ex.select_tools(heavy, "x", names) == names


def test_preamble_slimming():
    pre = "You are Hermes.\n\nMath, physics and chemistry in Word: x\nmore\n\nPowerPoint formatting & batch operations:\ny\n\nWeb and pictures: z\n\nWorking style: w"
    fast = ex.classify("tô vàng chữ này", "word")
    out = ex.slim_preamble(pre, fast, "word", "tô vàng chữ này")
    assert "Math" not in out and "PowerPoint formatting" not in out and "Web and pictures" not in out and "Working style" in out
    assert "Math" in ex.slim_preamble(pre, fast, "word", "viết công thức hóa học")
    assert "PowerPoint formatting" in ex.slim_preamble(pre, fast, "powerpoint", "tô vàng")
    heavy = ex.classify("làm bộ slide 12 trang", "word")
    assert ex.slim_preamble(pre, heavy, "word", "x") == pre
