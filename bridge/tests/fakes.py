"""Test doubles for the end-to-end flows: a fake `hermes` program and a fake Office task pane.

* FakeHermes writes an executable script (HERMES_BIN) that prints scripted replies, one per call,
  and logs the arguments and prompt of every call. It stands in for the real Hermes CLI, which is not available here.
* FakeTaskpane drives the bridge over the real /ws protocol (starlette TestClient) like the add-in does: it answers
  rpc_request frames with canned results and records everything. It does NOT run any Office.js code.
"""
from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

SCRIPT = '''#!{python}
import json, os, sys
argv = sys.argv[1:]
if argv[:1] == ["--version"]:
    print("hermes fake 0.0.1")
    sys.exit(0)
d = os.environ["FAKE_HERMES_DIR"]
prompt = ""
if "--query-file" in argv:
    with open(argv[argv.index("--query-file") + 1], encoding="utf-8") as f:
        prompt = f.read()
with open(os.path.join(d, "replies.json"), encoding="utf-8") as f:
    replies = json.load(f)
n_path = os.path.join(d, "n")
n = int(open(n_path).read()) if os.path.exists(n_path) else 0
open(n_path, "w").write(str(n + 1))
with open(os.path.join(d, "calls.jsonl"), "a", encoding="utf-8") as f:
    f.write(json.dumps({{"argv": argv, "prompt": prompt}}, ensure_ascii=False) + "\\n")
sys.stdout.reconfigure(encoding="utf-8")
print(replies[min(n, len(replies) - 1)])
'''


def tool_block(tool: str, args: Optional[Dict[str, Any]] = None) -> str:
    return "```office-tool\n" + json.dumps({"tool": tool, "args": args or {}}, ensure_ascii=False) + "\n```"


class FakeHermes:
    def __init__(self, directory: Path, replies: List[str]) -> None:
        self.dir = directory
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "replies.json").write_text(json.dumps(replies, ensure_ascii=False), encoding="utf-8")
        self.path = directory / "hermes"
        self.path.write_text(SCRIPT.format(python=sys.executable), encoding="utf-8")
        self.path.chmod(self.path.stat().st_mode | stat.S_IXUSR)

    def env(self, monkeypatch) -> None:
        monkeypatch.setenv("HERMES_BIN", str(self.path))
        monkeypatch.setenv("FAKE_HERMES_DIR", str(self.dir))

    @property
    def calls(self) -> List[Dict[str, Any]]:
        f = self.dir / "calls.jsonl"
        return [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines()] if f.exists() else []

    @staticmethod
    def skills_of(call: Dict[str, Any]) -> List[str]:
        argv = call["argv"]
        return argv[argv.index("-s") + 1].split(",") if "-s" in argv else []


class FakeTaskpane:
    """One chat turn at a time over a starlette TestClient websocket."""

    def __init__(self, ws, results: Optional[Dict[str, Callable[[Dict[str, Any]], Any]]] = None, approve: bool = True) -> None:
        self.ws = ws
        self.results = results or {}
        self.approve = approve
        self.events: List[Dict[str, Any]] = []
        self.rpc: List[Dict[str, Any]] = []  # rpc_request frames exactly as the add-in would receive them
        self.approvals: List[Dict[str, Any]] = []
        first = json.loads(ws.receive_text())
        assert first["type"] == "status"
        self.status = first

    def send(self, msg: Dict[str, Any]) -> None:
        self.ws.send_text(json.dumps(msg, ensure_ascii=False))

    def chat(self, text: str, host: str, mode: Optional[str] = None, skills: Optional[List[str]] = None, timeout_events: int = 400) -> List[Dict[str, Any]]:
        if mode:
            self.send({"type": "set_mode", "mode": mode})
        if skills is not None:
            self.send({"type": "set_skills", "skills": skills})
        self.send({"type": "chat", "id": "t1", "text": text, "host": host})
        turn: List[Dict[str, Any]] = []
        for _ in range(timeout_events):
            ev = json.loads(self.ws.receive_text())
            self.events.append(ev)
            turn.append(ev)
            if ev["type"] == "rpc_request":
                self.rpc.append(ev)
                fn = self.results.get(ev["tool"])
                self.send({"type": "rpc_result", "id": ev["id"], "result": fn(ev["args"]) if fn else {"ok": True}})
            elif ev["type"] == "approval_request":
                self.approvals.append(ev)
                self.send({"type": "approval_response", "rid": ev["rid"], "ok": self.approve})
            elif ev["type"] == "done":
                return turn
        raise AssertionError("chat did not finish: " + json.dumps(turn[-3:], ensure_ascii=False)[:600])

    @staticmethod
    def tool_results(turn: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [e for e in turn if e["type"] == "tool_result"]
