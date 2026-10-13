"""End-to-end flows through the real bridge (WebSocket protocol, skill router, tool execution, approval gate)
with a fake `hermes` program and a fake task pane. NOT covered here: the real Hermes CLI, real Office.js code, real web."""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import hermes_office_bridge as bridge
import office_web as w
from fakes import FakeHermes, FakeTaskpane, tool_block
from test_office_web import Server, png

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def env(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / ".hermes").mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("HERMES_HOME", str(home / ".hermes"))
    monkeypatch.setenv("HERMES_OFFICE_WEB_ALLOW_PRIVATE", "1")  # the picture comes from a local test server
    monkeypatch.delenv("HERMES_OFFICE_AUTOSKILL", raising=False)
    monkeypatch.setattr(bridge, "bundled_skills_dir", lambda: ROOT / "skills")
    rep = bridge.sync_skills()
    assert len(rep["installed"]) >= 24 and not rep["errors"]
    return tmp_path


def run(fake, monkeypatch, host, text, results=None, mode=None, approve=True, skills=None):
    fake.env(monkeypatch)
    with TestClient(bridge.app) as client:
        with client.websocket_connect("/ws") as ws:
            tp = FakeTaskpane(ws, results=results, approve=approve)
            turn = tp.chat(text, host, mode=mode, skills=skills)
    return tp, turn


# ------------------------------------------------------------------------------------------------ PowerPoint


def test_powerpoint_deck_flow_with_picture_by_id(env, monkeypatch):
    img = png(64, 48)
    srv = Server({"/coke.png": (200, {"Content-Type": "image/png"}, img)})
    searched = []

    def fake_search(args):
        searched.append(args)
        return {"ok": True, "kind": "image", "query": args["query"], "untrusted": True, "results": [
            {"title": "Chai Coca-Cola", "imageUrl": srv.url("/coke.png"), "author": "An", "license": "CC BY 4.0", "source": "Wikimedia Commons", "pageUrl": "https://commons.wikimedia.org/x"}]}

    monkeypatch.setitem(w._HANDLERS, "office_web_search", fake_search)
    fake = FakeHermes(env / "fake", [
        tool_block("office_web_search", {"query": "Coca-Cola chai", "kind": "image"}) + "\n" + tool_block("office_design_palette", {"mood": "vibrant", "seed": "#C8102E"}),
        tool_block("office_web_fetch_image", {"url": srv.url("/coke.png"), "title": "Chai Coca-Cola", "author": "An", "license": "CC BY 4.0", "source": "Wikimedia Commons"}),
        "PLACEHOLDER",  # replaced below once we know the imageId
        "Đã tạo xong bộ slide.",
    ])
    results = {
        "office_ppt_build_slide": lambda a: {"ok": True, "slideId": "s1", "warnings": []},
        "office_ppt_get_lint": lambda a: {"ok": True, "issueCount": 0, "issues": []},
    }
    reply_file = fake.dir / "replies.json"
    fake.env(monkeypatch)
    try:
        # The model only learns the imageId from the tool result, so the third scripted reply is filled in
        # from the real id as soon as the fetch result passes by.
        with TestClient(bridge.app) as client, client.websocket_connect("/ws") as ws:
            tp = FakeTaskpane(ws, results=results, approve=True)
            tp.send({"type": "set_mode", "mode": "auto"})
            tp.send({"type": "chat", "id": "t1", "text": "Tạo file trình chiếu Coca-Cola", "host": "powerpoint"})
            image_id = None
            events = []
            while True:
                ev = json.loads(ws.receive_text())
                events.append(ev)
                if ev["type"] == "tool_result" and ev["tool"] == "office_web_fetch_image":
                    image_id = ev["result"]["imageId"]
                    replies = json.loads(reply_file.read_text(encoding="utf-8"))
                    replies[2] = tool_block("office_ppt_build_slide", {"layout": "image-right", "title": "Lịch sử", "bullets": ["1886", "Atlanta"], "imageId": image_id, "imageAlt": "Chai Coca-Cola", "credit": "An, CC BY 4.0"}) + "\n" + tool_block("office_ppt_get_lint", {"scope": "presentation"})
                    reply_file.write_text(json.dumps(replies, ensure_ascii=False), encoding="utf-8")
                if ev["type"] == "rpc_request":
                    tp.rpc.append(ev)
                    fn = results.get(ev["tool"])
                    tp.send({"type": "rpc_result", "id": ev["id"], "result": fn(ev["args"]) if fn else {"ok": True}})
                if ev["type"] == "done":
                    break
    finally:
        srv.close()

    calls = fake.calls
    assert len(calls) == 4
    # 1. the router added the deck skill for this request (and only up to two skills)
    assert "ppt-deck-from-brief" in fake.skills_of(calls[0]) and len(fake.skills_of(calls[0])) <= 2
    assert any(e["type"] == "skills_auto" and "ppt-deck-from-brief" in e["skills"] for e in events)
    # 2. only topic keywords went to the web search
    assert searched and searched[0]["query"] == "Coca-Cola chai"
    # 3. the picture travelled by id: base64 reached the add-in, never the model
    build = next(r for r in tp.rpc if r["tool"] == "office_ppt_build_slide")
    assert "imageId" not in build["args"] and base64.b64decode(build["args"]["base64"]) == img
    assert build["args"]["imageWidth"] == 64 and build["args"]["imageAlt"] == "Chai Coca-Cola"
    assert all("iVBOR" not in c["prompt"] for c in calls)  # PNG base64 prefix
    assert image_id and image_id in calls[2]["prompt"]
    # 4. read-only lint is not a changing tool, build_slide is
    assert build["mutating"] is True
    assert next(r for r in tp.rpc if r["tool"] == "office_ppt_get_lint")["mutating"] is False
    assert events[-1]["type"] == "done"


# ------------------------------------------------------------------------------------------------ Word


WORD_REPLIES = [
    tool_block("office_word_get_outline", {"mode": "all"}),
    tool_block("office_word_set_paragraph_text", {"items": [{"index": 1, "text": "Hôm nay trời đẹp."}]}) + "\n" + tool_block("office_word_add_comment", {"quote": "dự án", "text": "Gợi ý: viết hoa tên riêng?"}),
    "Đã soát xong.",
]
WORD_RESULTS = {"office_word_get_outline": lambda a: {"ok": True, "totalParagraphs": 2, "paragraphs": [{"index": 1, "text": "Hom nay troi dep"}]}}


def test_word_proofread_flow_auto_mode(env, monkeypatch):
    fake = FakeHermes(env / "fake", WORD_REPLIES)
    tp, turn = run(fake, monkeypatch, "word", "Soát lỗi chính tả và dấu câu cho văn bản này", WORD_RESULTS, mode="auto")
    assert "word-proofread-vn" in fake.skills_of(fake.calls[0])
    assert [r["tool"] for r in tp.rpc] == ["office_word_get_outline", "office_word_set_paragraph_text", "office_word_add_comment"]
    assert not tp.approvals
    assert turn[-1]["type"] == "done"
    assert "Hom nay troi dep" in fake.calls[1]["prompt"]  # the outline result was fed back to the model


def test_word_flow_approve_mode_asks_only_for_changing_tools(env, monkeypatch):
    fake = FakeHermes(env / "fake", WORD_REPLIES)
    tp, _ = run(fake, monkeypatch, "word", "Soát lỗi chính tả", WORD_RESULTS, mode="approve", approve=True)
    assert len(tp.approvals) == 1
    asked = [c["tool"] for c in tp.approvals[0]["calls"]]
    assert asked == ["office_word_set_paragraph_text", "office_word_add_comment"]  # the outline read needed no approval
    assert [r["tool"] for r in tp.rpc] == ["office_word_get_outline", "office_word_set_paragraph_text", "office_word_add_comment"]


def test_word_flow_rejected_changes_do_not_reach_the_document(env, monkeypatch):
    fake = FakeHermes(env / "fake", WORD_REPLIES)
    tp, turn = run(fake, monkeypatch, "word", "Soát lỗi chính tả", WORD_RESULTS, mode="approve", approve=False)
    assert [r["tool"] for r in tp.rpc] == ["office_word_get_outline"]
    assert any(e["type"] == "tool_result" and not e["ok"] and "rejected" in str(e["result"]) for e in turn)


def test_word_flow_read_only_mode_allows_reading_but_blocks_new_changing_tools(env, monkeypatch):
    fake = FakeHermes(env / "fake", WORD_REPLIES)
    tp, turn = run(fake, monkeypatch, "word", "Soát lỗi chính tả", WORD_RESULTS, mode="readonly")
    assert [r["tool"] for r in tp.rpc] == ["office_word_get_outline"]
    denied = [e for e in turn if e["type"] == "tool_result" and not e["ok"]]
    assert len(denied) == 2 and all("read-only" in e["result"] for e in denied)


# ------------------------------------------------------------------------------------------------ Excel


def test_excel_clean_flow_and_local_calc_tool(env, monkeypatch):
    fake = FakeHermes(env / "fake", [
        tool_block("office_excel_get_lint", {"address": "A1:F50"}),
        tool_block("office_excel_clean_range", {"address": "A1:F50", "trim": True, "textToNumber": True}) + "\n" + tool_block("office_excel_remove_duplicates", {"address": "A1:F50", "hasHeaders": True}),
        tool_block("office_calc_balanced_groups", {"items": [{"name": f"HS{i}", "score": 3 + (i * 7) % 7} for i in range(12)], "groups": 3}),
        "Đã làm sạch bảng và chia nhóm.",
    ])
    results = {
        "office_excel_get_lint": lambda a: {"ok": True, "issueCount": 2, "issues": [{"rule": "text-numbers"}, {"rule": "duplicate-rows"}]},
        "office_excel_clean_range": lambda a: {"ok": True, "cellsChanged": 7},
        "office_excel_remove_duplicates": lambda a: {"ok": True, "removed": 2},
    }
    tp, turn = run(fake, monkeypatch, "excel", "Làm sạch bảng này giúp tôi", results, mode="approve")
    assert "excel-clean-data" in fake.skills_of(fake.calls[0])
    assert [r["tool"] for r in tp.rpc] == ["office_excel_get_lint", "office_excel_clean_range", "office_excel_remove_duplicates"]
    assert len(tp.approvals) == 1 and [c["tool"] for c in tp.approvals[0]["calls"]] == ["office_excel_clean_range", "office_excel_remove_duplicates"]
    calc = next(e for e in turn if e["type"] == "tool_result" and e["tool"] == "office_calc_balanced_groups")
    assert calc["ok"] and calc["result"]["sizes"] == [4, 4, 4]  # bridge-local: no rpc_request, no approval needed
    assert "office_calc_balanced_groups" not in [r["tool"] for r in tp.rpc]


def test_user_chosen_skills_are_kept_and_the_router_can_be_switched_off(env, monkeypatch):
    fake = FakeHermes(env / "fake", ["Xong."])
    run(fake, monkeypatch, "excel", "Làm sạch bảng này", skills=["office-user-style"])
    assert fake.skills_of(fake.calls[0])[0] == "office-user-style" and "excel-clean-data" in fake.skills_of(fake.calls[0])
    fake2 = FakeHermes(env / "fake2", ["Xong."])
    monkeypatch.setenv("HERMES_OFFICE_AUTOSKILL", "0")
    run(fake2, monkeypatch, "excel", "Làm sạch bảng này")
    assert fake2.skills_of(fake2.calls[0]) == []
