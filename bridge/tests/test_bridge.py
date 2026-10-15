"""End-to-end test of the bridge WebSocket with the fake CLIs (lean engine, pinned models, ⚡ mode, learning)."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
TMP = tempfile.TemporaryDirectory()
import hermes_office_bridge as hb  # noqa: E402
import backends  # noqa: E402
import learner  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

TOOL1 = '```office-tool\n{"tool": "office_word_get_selection", "args": {}}\n```'
TOOL2 = '```office-tool\n{"tool": "office_word_apply_format", "args": {"bold": true}}\n```'


ENV = {
    "HERMES_HOME": str(Path(TMP.name) / "hermes"),
    "HERMES_OFFICE_HOME": str(Path(TMP.name) / "office"),
    "HERMES_AGY_BIN": str(HERE / "fake_agy.py"),
    "HERMES_CLAUDE_BIN": str(HERE / "fake_claude.py"),
    "FAKE_LOG": str(Path(TMP.name) / "calls.jsonl"),
    "HERMES_CLEANUP_GRACE": "0",
    "HERMES_LEARN": "0",  # keep the background worker out of the way; learning is enqueued directly below
}


class Bridge(unittest.TestCase):
    def setUp(self):
        os.environ.update(ENV)  # per test: the other test modules also edit the process environment
        skill = Path(os.environ["HERMES_HOME"]) / "skills" / "office-user-style"
        skill.mkdir(parents=True, exist_ok=True)
        (skill / "SKILL.md").write_text("---\nname: office-user-style\ndescription: x\n---\n\nSKILL-BODY-MARKER\n", encoding="utf-8")
        for f in (Path(TMP.name) / "calls.jsonl", Path(TMP.name) / "replies.json.idx", hb.selection_path(), learner._queue_path()):
            f.unlink(missing_ok=True)
        backends._probes.clear(); backends._bin_cache.clear(); backends._models_cache.clear(); backends._locks.clear()
        os.environ.pop("FAKE_MODE", None)
        os.environ.pop("FAKE_REPLIES", None)
        learner._last_activity = 0.0

    def tearDown(self):
        os.environ.pop("HERMES_LEARN", None)

    def calls(self):
        f = Path(TMP.name) / "calls.jsonl"
        rows = [json.loads(l) for l in f.read_text().splitlines()] if f.exists() else []
        return [r for r in rows if r["argv"][:1] not in (["--help"], ["--version"], ["models"])]

    def chat(self, ws, text, answer_rpc=True, approve=True):
        ws.send_json({"type": "chat", "id": "c1", "host": "word", "text": text, "context": "selection: hello"})
        deltas, rpcs = [], []
        self.approvals = []
        while True:
            m = ws.receive_json()
            if m["type"] == "approval_request":
                self.approvals.append(m["tool"])
                ws.send_json({"type": "approval_result", "id": m["id"], "allow": approve})
            elif m["type"] == "rpc_request":
                rpcs.append(m["tool"])
                ws.send_json({"type": "rpc_result", "id": m["id"], "result": {"ok": True}})
            elif m["type"] == "delta":
                deltas.append(m["text"])
            elif m["type"] in ("done", "error"):
                return "".join(deltas), rpcs, m

    def frame(self, ws, kind, **kw):
        ws.send_json({"type": kind, **kw})
        while True:
            m = ws.receive_json()
            if m["type"] == "models":
                return m

    def test_lean_default_auto_is_gemini_flash(self):
        with TestClient(hb.app).websocket_connect("/ws") as ws:
            ws.receive_json()  # status
            m = self.frame(ws, "list_models")
            self.assertFalse(m["agent_mode"])
            self.assertEqual(m["current"], {"model": "gemini-3.8-flash-medium", "provider": "agy"})
            provs = {x["provider"] for x in m["models"]}
            self.assertEqual(provs, {"agy", "claude"})  # both backends offered side by side
            text, _, done = self.chat(ws, "chào")
            self.assertEqual(done["type"], "done")
            self.assertEqual(text, "Chào\n")
            argv = self.calls()[0]["argv"]
            self.assertEqual(argv[argv.index("--model") + 1], "gemini-3.8-flash-medium")
            self.assertIn("SKILL-BODY-MARKER", argv[1])  # default office skill preloaded in the first prompt
            self.assertIn("Runtime:", argv[1])

    def test_pinned_claude_model_tool_loop_and_resume(self):
        replies = Path(TMP.name) / "replies.json"
        replies.write_text(json.dumps([TOOL1, TOOL2, "Xong rồi."]), encoding="utf-8")
        os.environ["FAKE_REPLIES"] = str(replies)
        with TestClient(hb.app).websocket_connect("/ws") as ws:
            ws.receive_json()
            m = self.frame(ws, "set_model", model="sonnet", provider="claude")
            self.assertEqual(m["selected"], {"model": "sonnet", "provider": "claude"})
            text, rpcs, done = self.chat(ws, "In đậm phần chọn")
            self.assertEqual(done["type"], "done")
            self.assertEqual(rpcs, ["office_word_get_selection", "office_word_apply_format"])
            calls = self.calls()
            self.assertEqual(len(calls), 3)
            self.assertTrue(all(c["argv"][c["argv"].index("--model") + 1] == "sonnet" for c in calls))  # never changed
            self.assertIn("SKILL-BODY-MARKER", calls[0]["stdin"])  # full prompt first
            self.assertIn("--resume", calls[1]["argv"])  # then only new content
            self.assertNotIn("SKILL-BODY-MARKER", calls[1]["stdin"])
            self.assertIn('"tool": "office_word_get_selection"', calls[1]["stdin"])  # tool result delivered as delta
        # the finished multi-step task was queued for the background learner (names only)
        os.environ["HERMES_LEARN"] = "1"
        # (the chat above ran with learning disabled; enqueue the same trace explicitly)
        trace = [{"tool": "office_word_get_selection", "ok": True, "arg_keys": []}, {"tool": "office_word_apply_format", "ok": True, "arg_keys": ["bold"]}]
        self.assertTrue(learner.enqueue("claude", "sonnet", "word", "In đậm phần chọn", trace))
        os.environ["HERMES_LEARN"] = "0"

    def test_selection_survives_reconnect_and_mode_switch(self):
        with TestClient(hb.app).websocket_connect("/ws") as ws:
            ws.receive_json()
            self.frame(ws, "set_model", model="claude-sonnet-4-6", provider="agy")
        with TestClient(hb.app).websocket_connect("/ws") as ws2:
            ws2.receive_json()
            m = self.frame(ws2, "list_models")
            self.assertEqual(m["selected"], {"model": "claude-sonnet-4-6", "provider": "agy"})
            m = self.frame(ws2, "set_agent_mode", on=True)
            self.assertTrue(m["agent_mode"])
            self.assertEqual(m["selected"], {"model": None, "provider": None})  # Hermes mode keeps its own selection
            m = self.frame(ws2, "set_agent_mode", on=False)
            self.assertEqual(m["selected"], {"model": "claude-sonnet-4-6", "provider": "agy"})

    def test_inline_uses_selected_model_and_no_history(self):
        with TestClient(hb.app).websocket_connect("/ws") as ws:
            ws.receive_json()
            self.frame(ws, "set_model", model="gemini-3.8-flash-high", provider="agy")
            ws.send_json({"type": "inline", "id": "i1", "host": "word", "text": "ngắn gọn", "target": "Xin chào các bạn"})
            out = ""
            while True:
                m = ws.receive_json()
                if m["type"] == "delta":
                    out += m["text"]
                elif m["type"] == "done":
                    break
            self.assertEqual(out, "Chào\n")
            argv = self.calls()[0]["argv"]
            self.assertEqual(argv[argv.index("--model") + 1], "gemini-3.8-flash-high")
            self.assertNotIn("--conversation", argv)

    def test_backend_failure_is_reported_not_rerouted(self):
        os.environ["FAKE_MODE"] = "auth"
        with TestClient(hb.app).websocket_connect("/ws") as ws:
            ws.receive_json()
            self.frame(ws, "set_model", model="gemini-3.8-flash-low", provider="agy")
            _, _, m = self.chat(ws, "hi")
            self.assertEqual(m["type"], "error")
            self.assertEqual(m["code"], "backend_auth")
            self.assertEqual(len(self.calls()), 1)

    def test_invalid_backend_for_lean_model_rejected(self):
        with TestClient(hb.app).websocket_connect("/ws") as ws:
            ws.receive_json()
            ws.send_json({"type": "set_model", "model": "claude-3-5-sonnet", "provider": "custom:x"})
            m = ws.receive_json()
            self.assertEqual(m["code"], "invalid_model")

    def _tool_replies(self):
        replies = Path(TMP.name) / "replies.json"
        replies.write_text(json.dumps([TOOL1, TOOL2, "Xong."]), encoding="utf-8")
        os.environ["FAKE_REPLIES"] = str(replies)
        Path(str(replies) + ".idx").unlink(missing_ok=True)

    def test_consent_read_only_blocks_writes(self):
        self._tool_replies()
        with TestClient(hb.app).websocket_connect("/ws") as ws:
            ws.receive_json()
            self.frame(ws, "set_model", model="sonnet", provider="claude")
            ws.send_json({"type": "set_consent", "level": "read"})
            self.assertEqual(ws.receive_json(), {"type": "consent", "level": "read"})
            _, rpcs, done = self.chat(ws, "đậm")
            self.assertEqual(done["type"], "done")
            self.assertEqual(rpcs, ["office_word_get_selection"])  # reading is fine, formatting never reached Office
            self.assertEqual(self.approvals, [])

    def test_consent_ask_needs_approval(self):
        self._tool_replies()
        with TestClient(hb.app).websocket_connect("/ws") as ws:
            ws.receive_json()
            self.frame(ws, "set_model", model="sonnet", provider="claude")
            ws.send_json({"type": "set_consent", "level": "ask"})
            ws.receive_json()
            _, rpcs, _ = self.chat(ws, "đậm", approve=False)
            self.assertEqual(self.approvals, ["office_word_apply_format"])
            self.assertEqual(rpcs, ["office_word_get_selection"])  # declined: not executed
            self._tool_replies()
            _, rpcs, _ = self.chat(ws, "đậm", approve=True)
            self.assertEqual(rpcs, ["office_word_get_selection", "office_word_apply_format"])

    def test_consent_full_runs_yolo_and_persists(self):
        self._tool_replies()
        with TestClient(hb.app).websocket_connect("/ws") as ws:
            ws.receive_json()
            ws.send_json({"type": "set_consent", "level": "full"})
            ws.receive_json()
            self.chat(ws, "chào")  # default auto = agy
            self.assertIn("--dangerously-skip-permissions", self.calls()[0]["argv"])
            self.frame(ws, "set_model", model="sonnet", provider="claude")
            _, rpcs, _ = self.chat(ws, "đậm")
            self.assertEqual(self.approvals, [])
            self.assertEqual(len(rpcs), 2)
        with TestClient(hb.app).websocket_connect("/ws") as ws:  # reopening Office keeps the answer
            ws.receive_json()
            self.assertEqual(self.frame(ws, "list_models")["consent"], "full")

    def test_session_folder_removed_after_close(self):
        ws_root = Path(os.environ["HERMES_OFFICE_HOME"]) / "workspace"
        with TestClient(hb.app).websocket_connect("/ws") as ws:
            ws.receive_json()
            self.chat(ws, "chào")
            self.assertTrue([d for d in ws_root.iterdir() if d.is_dir()])
        import time
        for _ in range(50):
            if not [d for d in ws_root.iterdir() if d.is_dir()]:
                break
            time.sleep(0.1)
        self.assertEqual([d for d in ws_root.iterdir() if d.is_dir()], [])


if __name__ == "__main__":
    unittest.main()
