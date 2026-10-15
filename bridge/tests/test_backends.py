"""Offline tests for backends.py using fake CLIs. Run: python3 -m unittest discover -s bridge/tests"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import backends as b  # noqa: E402


class Base(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.log = Path(self.tmp.name) / "calls.jsonl"
        os.environ.update({
            "HERMES_OFFICE_HOME": self.tmp.name,
            "HERMES_AGY_BIN": str(HERE / "fake_agy.py"),
            "HERMES_CLAUDE_BIN": str(HERE / "fake_claude.py"),
            "FAKE_LOG": str(self.log),
        })
        for k in ("FAKE_MODE", "HERMES_AGY_FLAGS", "HERMES_ALLOW_API_KEYS"):
            os.environ.pop(k, None)
        b._probes.clear(); b._bin_cache.clear(); b._models_cache.clear(); b._locks.clear()

    def tearDown(self):
        self.tmp.cleanup()

    def calls(self):
        if not self.log.exists():
            return []
        rows = [json.loads(l) for l in self.log.read_text().splitlines()]
        return [r for r in rows if r["argv"][:1] not in (["--help"], ["--version"], ["models"])]

    async def turn(self, backend, model="m", conv=None, full="FULL", delta="DELTA"):
        chunks = []

        async def on_chunk(t):
            chunks.append(t)

        res = await b.run_turn(backend, model, full, delta, conv, on_chunk)
        return res, chunks


class AgyTests(Base):
    async def test_stream_and_hidden_workspace(self):
        res, chunks = await self.turn("agy", "gemini-3.8-flash-medium")
        self.assertEqual(res.text, "Chào\n")
        self.assertEqual(chunks, ["Chào", "\n"])  # streamed once, not duplicated by result.response
        self.assertEqual(res.conv_id, "cd48b78d-8c62-4d33-be59-76d0b7fcf132")
        argv = self.calls()[0]["argv"]
        self.assertEqual(argv[:3], ["-p", "FULL", "--output-format"])
        self.assertIn("gemini-3.8-flash-medium", argv)
        self.assertTrue(self.calls()[0]["cwd"].endswith(".hermes-office/workspace") or "workspace" in self.calls()[0]["cwd"])
        self.assertNotIn("--dangerously-skip-permissions", argv)

    async def test_resume_uses_delta_prompt(self):
        res, _ = await self.turn("agy", conv="abc")
        argv = self.calls()[0]["argv"]
        self.assertEqual(argv[1], "DELTA")
        self.assertEqual(argv[argv.index("--conversation") + 1], "abc")

    async def test_bad_conversation_retries_with_full_prompt(self):
        os.environ["FAKE_MODE"] = "badconv"
        res, _ = await self.turn("agy", conv="gone")
        calls = self.calls()
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]["argv"][1], "FULL")
        self.assertNotIn("--conversation", calls[1]["argv"])
        self.assertIn("conversation id dropped", res.notes)

    async def test_rejected_flag_is_dropped_and_remembered(self):
        os.environ["FAKE_MODE"] = "noptimeout"
        res, _ = await self.turn("agy")
        self.assertEqual(res.text, "Chào\n")
        self.assertIn("--print-timeout", b._probes["agy"].denied)
        self.assertNotIn("--print-timeout", self.calls()[-1]["argv"])
        saved = json.loads((Path(self.tmp.name) / "probe.json").read_text())
        self.assertIn("--print-timeout", saved["agy"]["denied"])

    async def test_unreadable_output_falls_back_to_text(self):
        os.environ["FAKE_MODE"] = "plain"
        res, _ = await self.turn("agy")
        self.assertIn("Chào (text)", res.text)
        self.assertIn("plain-text output", res.notes)

    async def test_model_error_never_switches_model(self):
        os.environ["FAKE_MODE"] = "badmodel"
        with self.assertRaises(b.BackendError) as cm:
            await self.turn("agy", "nope")
        self.assertEqual(cm.exception.code, "backend_model")
        self.assertEqual(len(self.calls()), 1)  # no retry, no other model tried

    async def test_native_tool_denied_is_reported_not_retried(self):
        os.environ["FAKE_MODE"] = "denied"
        with self.assertRaises(b.BackendError) as cm:
            await self.turn("agy", "gemini-3.8-flash-medium")
        self.assertEqual(cm.exception.code, "backend_tool_denied")
        self.assertIn("RunCommand", str(cm.exception))
        self.assertEqual(len(self.calls()), 1)  # no pointless retry in plain-text mode

    async def test_auth_error(self):
        os.environ["FAKE_MODE"] = "auth"
        with self.assertRaises(b.BackendError) as cm:
            await self.turn("agy")
        self.assertEqual(cm.exception.code, "backend_auth")

    async def test_api_keys_are_scrubbed(self):
        os.environ["GEMINI_API_KEY"] = "secret"
        try:
            await self.turn("agy")
            self.assertFalse(self.calls()[0]["has_key"])
        finally:
            del os.environ["GEMINI_API_KEY"]

    async def test_models_and_auto(self):
        models = await b.agy_models()
        self.assertEqual(len(models), 6)
        self.assertEqual(models[1], {"id": "gemini-3.8-flash-medium", "provider": "agy", "label": "Gemini 3.8 Flash (Medium) (agy)"})
        self.assertEqual((await b.auto_target())["id"], "gemini-3.8-flash-medium")
        self.assertEqual(b.pick_auto([m for m in models if "medium" not in m["id"]])["id"], "gemini-3.8-flash-high")
        self.assertIsNone(b.pick_auto([{"id": "claude-sonnet-4-6", "provider": "agy", "label": "x"}]))


class ClaudeTests(Base):
    async def test_prompt_via_stdin_and_lean_flags(self):
        res, chunks = await self.turn("claude", "sonnet")
        self.assertEqual(res.text, "Xin chào!")
        self.assertEqual(res.model, "claude-sonnet-5-5")
        call = self.calls()[0]
        self.assertEqual(call["stdin"], "FULL")
        for flag in ("--verbose", "--strict-mcp-config", "--disable-slash-commands", "--tools"):
            self.assertIn(flag, call["argv"])
        self.assertEqual(call["argv"][call["argv"].index("--tools") + 1], "")
        self.assertNotIn("FULL", call["argv"])  # document text never lands in the process list

    async def test_partial_messages_not_duplicated(self):
        res, chunks = await self.turn("claude", "sonnet")
        self.assertEqual("".join(chunks), "Xin chào!")
        self.assertEqual(chunks, ["Xin ", "chào!"])

    async def test_resume_flag_and_delta(self):
        await self.turn("claude", "sonnet", conv="sess-1")
        call = self.calls()[0]
        self.assertEqual(call["stdin"], "DELTA")
        self.assertEqual(call["argv"][call["argv"].index("--resume") + 1], "sess-1")

    async def test_unsupported_tools_flag_adapts(self):
        os.environ["FAKE_MODE"] = "notools"
        res, _ = await self.turn("claude", "sonnet")
        self.assertEqual(res.text, "Xin chào!")
        self.assertIn("--tools", b._probes["claude"].denied)
        self.assertNotIn("--tools", self.calls()[-1]["argv"])

    async def test_bad_model_and_auth(self):
        os.environ["FAKE_MODE"] = "badmodel"
        with self.assertRaises(b.BackendError) as cm:
            await self.turn("claude", "ghost")
        self.assertEqual(cm.exception.code, "backend_model")
        self.assertEqual(len(self.calls()), 1)
        os.environ["FAKE_MODE"] = "auth"
        with self.assertRaises(b.BackendError) as cm:
            await self.turn("claude", "sonnet")
        self.assertEqual(cm.exception.code, "backend_auth")

    async def test_version_change_triggers_reprobe(self):
        await b.get_probe("claude")
        self.assertEqual(b._probes["claude"].version, "2.1.300 (Claude Code)")
        b._probes["claude"].fingerprint = "old"
        b._probes["claude"].checked = 0
        p = await b.get_probe("claude")
        self.assertEqual(p.fingerprint, "2.1.300 (Claude Code)")

    async def test_missing_binary(self):
        async def nothing(_backend):
            return None

        orig = b.find_binary
        b.find_binary = nothing
        try:
            with self.assertRaises(b.BackendMissing):
                await b.get_probe("claude")
        finally:
            b.find_binary = orig


if __name__ == "__main__":
    unittest.main()
