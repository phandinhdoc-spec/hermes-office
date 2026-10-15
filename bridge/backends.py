"""Lean model backends for Hermes Office: `agy` (Antigravity CLI) and `claude` (Claude Code CLI).

Every turn runs the CLI headless inside a hidden workspace directory (~/.hermes-office/workspace),
streams its NDJSON output, and keeps the CLI-side conversation so only new content is sent.

Rules this module enforces:
  * A model is bound to its backend. A failure is reported; it NEVER switches to another model.
  * The installed CLI is probed (`--version`, `--help`) and the command line is built from the flags
    it really supports. When a call fails because of a version mismatch (unknown/renamed flag,
    unreadable output, stale conversation id) the probe is refreshed and the call is retried with an
    adjusted command, at most twice.
  * API keys are removed from the child environment (the point of this engine is to use the
    subscriptions, not metered API billing); set HERMES_ALLOW_API_KEYS=1 to keep them.
  * Native CLI tools are kept off: Office edits go through the bridge's `office-tool` protocol.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shlex
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

log = logging.getLogger("hermes-office-backends")

BACKENDS = ("agy", "claude")
ENV_BIN = {"agy": "HERMES_AGY_BIN", "claude": "HERMES_CLAUDE_BIN"}
CHECK_EVERY = 600.0  # seconds between cheap "did the CLI change?" checks
MODELS_TTL = 3600.0
IDLE_TIMEOUT = float(os.environ.get("HERMES_BACKEND_IDLE", "300"))  # silence (s) before a call is aborted
AUTO_PREFIX = os.environ.get("HERMES_AUTO_MODEL_PREFIX", "gemini-3.8-flash")
AUTO_EFFORT = os.environ.get("HERMES_AUTO_EFFORT", "medium")
CLAUDE_ALIASES = [("sonnet", "Sonnet"), ("opus", "Opus"), ("haiku", "Haiku")]
SCRUB_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY")
WIN_ARG_LIMIT = 30000  # CreateProcess caps the command line near 32k characters

FLAG_RE = re.compile(r"(?<![\w-])(--[a-z][a-z0-9-]*)")
TOKEN_RE = re.compile(r"(?<![\w-])(-{1,2}[A-Za-z][\w-]*)")
FLAG_ERR_RE = re.compile(
    r"unknown (flag|option|argument)|unrecognized (flag|option|argument)|flag provided but not defined|"
    r"invalid (flag|option)|no such option|unexpected argument|argument missing|requires an argument|"
    r"option .{0,40}(not (supported|recognized)|requires)",
    re.I,
)
SESSION_ERR_RE = re.compile(
    r"(conversation|session)[^\n]{0,60}(not found|does not exist|no longer|invalid|expired|unknown)|"
    r"no (conversation|session) found|could not (resume|find)|no deferred tool marker",
    re.I,
)
MODEL_ERR_RE = re.compile(
    r"(unknown|invalid|unsupported|unavailable)[^\n]{0,40}model|issue with the selected model|"
    r"model[^\n]{0,60}(not found|not available|unknown|invalid|not supported|(does|may) not exist|no access)",
    re.I,
)
AUTH_ERR_RE = re.compile(
    r"not (logged|signed) in|log ?in required|please (run|log|sign)|unauthori[sz]ed|invalid api key|"
    r"authentication|expired (token|session)|\b401\b|\b403\b",
    re.I,
)


# --------------------------------------------------------------------------- errors


class BackendError(RuntimeError):
    """A failed backend call. `kind` drives adaptation; `code` lets the UI localize the message."""

    def __init__(self, message: str, *, kind: str = "other", code: str = "backend_failed", detail: str = "", cmd: Optional[List[str]] = None) -> None:
        super().__init__(message)
        self.kind = kind
        self.code = code
        self.detail = detail or message
        self.cmd = cmd or []


class BackendMissing(BackendError):
    def __init__(self, backend: str) -> None:
        super().__init__(
            f"Không tìm thấy lệnh `{backend}`. Hãy cài đặt và đăng nhập, hoặc đặt biến {ENV_BIN.get(backend, 'HERMES_BIN')} trỏ tới file chạy.",
            kind="missing", code="backend_not_found",
        )


def classify(detail: str) -> str:
    if SESSION_ERR_RE.search(detail):
        return "session"
    if FLAG_ERR_RE.search(detail):
        return "flag"
    if MODEL_ERR_RE.search(detail):
        return "model"
    if AUTH_ERR_RE.search(detail):
        return "auth"
    return "other"


# --------------------------------------------------------------------------- paths / processes


def office_home() -> Path:
    return Path(os.environ.get("HERMES_OFFICE_HOME") or (Path.home() / ".hermes-office"))


def workspace_dir() -> Path:
    """Hidden working directory every backend call runs in (isolated from the user's own projects)."""
    p = office_home() / "workspace"
    p.mkdir(parents=True, exist_ok=True)
    return p


def child_env(base: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    env = dict(base if base is not None else os.environ)
    if os.environ.get("HERMES_ALLOW_API_KEYS", "").lower() not in ("1", "true", "yes"):
        for k in SCRUB_ENV:
            env.pop(k, None)
    return env


async def _run(path: str, *args: str, timeout: float = 20.0, cwd: Optional[Path] = None, env: Optional[Dict[str, str]] = None) -> Tuple[int, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            path, *args, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT, cwd=str(cwd) if cwd else None, env=env,
        )
    except OSError as exc:
        return 127, str(exc)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 124, "timeout"
    return proc.returncode or 0, out.decode("utf-8", "replace")


_bin_cache: Dict[str, str] = {}


async def find_binary(backend: str) -> Optional[str]:
    override = os.environ.get(ENV_BIN[backend])
    if override and Path(override).is_file():
        return override
    cached = _bin_cache.get(backend)
    if cached and Path(cached).is_file():
        return cached
    found = shutil.which(backend)
    if not found:
        home = Path.home()
        dirs = [home / ".local" / "bin", Path("/opt/homebrew/bin"), Path("/usr/local/bin"), home / ".claude" / "local",
                home / ".npm-global" / "bin", home / "bin", home / ".antigravity" / "bin"]
        for d in dirs:
            for ext in ("", ".exe", ".cmd"):
                c = d / (backend + ext)
                if c.is_file() and os.access(c, os.X_OK):
                    found = str(c)
                    break
            if found:
                break
    if not found and os.name == "posix":  # LaunchAgent/systemd start with a minimal PATH: ask a login shell
        shell = os.environ.get("SHELL") or "/bin/zsh"
        rc, out = await _run(shell, "-lc", f"command -v {backend}", timeout=8)
        lines = [l.strip() for l in out.splitlines() if l.strip().startswith("/")]
        if rc == 0 and lines and Path(lines[-1]).is_file():
            found = lines[-1]
    if found:
        _bin_cache[backend] = found
    return found


# --------------------------------------------------------------------------- probing the installed CLI


@dataclass
class Probe:
    backend: str
    path: str
    version: str
    fingerprint: str
    flags: frozenset
    checked: float = 0.0
    denied: set = field(default_factory=set)  # optional flags this install rejected; command builders skip them

    def has(self, flag: str) -> bool:
        return flag in self.flags and flag not in self.denied


_probes: Dict[str, Probe] = {}
_locks: Dict[str, asyncio.Lock] = {}


def _probe_file() -> Path:
    return office_home() / "probe.json"


def _load_disk() -> Dict[str, Any]:
    try:
        d = json.loads(_probe_file().read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_disk(probe: Probe) -> None:
    try:
        data = _load_disk()
        data[probe.backend] = {"path": probe.path, "version": probe.version, "fingerprint": probe.fingerprint,
                               "flags": sorted(probe.flags), "denied": sorted(probe.denied)}
        _probe_file().parent.mkdir(parents=True, exist_ok=True)
        _probe_file().write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        log.warning("cannot persist backend probe")


async def _version(path: str) -> Tuple[str, str]:
    """(human version, fingerprint). Falls back to file size/mtime when the CLI has no --version."""
    rc, out = await _run(path, "--version", timeout=15, env=child_env())
    first = next((l.strip() for l in out.splitlines() if l.strip()), "")
    if rc == 0 and first and len(first) < 120 and not first.lower().startswith(("usage", "error", "unknown", "flag", "invalid")):
        return first, first
    try:
        st = Path(path).resolve().stat()
        return "", f"{st.st_size}:{int(st.st_mtime)}"
    except OSError:
        return "", "unknown"


async def get_probe(backend: str, force: bool = False) -> Probe:
    """Return what the installed CLI supports, refreshing when its version changed (or on `force`)."""
    lock = _locks.setdefault(backend, asyncio.Lock())
    async with lock:
        cur = _probes.get(backend)
        now = time.time()
        if cur and not force and now - cur.checked < CHECK_EVERY:
            return cur
        path = cur.path if cur and Path(cur.path).is_file() else await find_binary(backend)
        if not path:
            raise BackendMissing(backend)
        version, fp = await _version(path)
        same = bool(cur) and cur.path == path and cur.fingerprint == fp
        if cur and same and not force:
            cur.checked = now
            return cur
        disk = _load_disk().get(backend) or {}
        if not force and disk.get("path") == path and disk.get("fingerprint") == fp and disk.get("flags"):
            probe = Probe(backend, path, version, fp, frozenset(disk["flags"]), now, set(disk.get("denied") or []))
        else:
            _, help_text = await _run(path, "--help", timeout=25, env=child_env())
            flags = frozenset(FLAG_RE.findall(help_text))
            denied = set(cur.denied) if cur and same else set(disk.get("denied") or []) if disk.get("fingerprint") == fp else set()
            probe = Probe(backend, path, version, fp, flags, now, denied)
            log.info("probed %s %s: %d flags", backend, version or fp, len(flags))
        _probes[backend] = probe
        _save_disk(probe)
        return probe


# --------------------------------------------------------------------------- models


_models_cache: Dict[str, Tuple[float, str, List[Dict[str, Any]]]] = {}
AGY_MODEL_RE = re.compile(r"^(?P<id>[A-Za-z0-9][\w.\-:/]*)\s{2,}(?P<label>\S.*?)\s*$")


async def agy_models(force: bool = False) -> List[Dict[str, Any]]:
    try:
        probe = await get_probe("agy")
    except BackendMissing:
        return []
    hit = _models_cache.get("agy")
    if hit and not force and time.time() - hit[0] < MODELS_TTL and hit[1] == probe.fingerprint:
        return hit[2]
    rc, out = await _run(probe.path, "models", timeout=45, cwd=workspace_dir(), env=child_env())
    models: List[Dict[str, Any]] = []
    for line in out.splitlines():
        m = AGY_MODEL_RE.match(line.strip())
        if m and rc == 0:
            models.append({"id": m["id"], "provider": "agy", "label": f"{m['label']} (agy)"})
    if not models and hit:
        return hit[2]  # keep the last good list rather than emptying the selector
    _models_cache["agy"] = (time.time(), probe.fingerprint, models)
    return models


async def claude_models() -> List[Dict[str, Any]]:
    if not await find_binary("claude"):
        return []
    env = os.environ.get("HERMES_CLAUDE_MODELS")
    if env:
        return [{"id": a.strip(), "provider": "claude", "label": f"{a.strip()} (Claude)"} for a in env.split(",") if a.strip()]
    return [{"id": a, "provider": "claude", "label": f"{name} (Claude)"} for a, name in CLAUDE_ALIASES]  # aliases track the latest version


async def backend_models(force: bool = False) -> List[Dict[str, Any]]:
    a, c = await asyncio.gather(agy_models(force), claude_models())
    return a + c


def pick_auto(models: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Auto = Gemini 3.8 Flash on agy (prefix + effort configurable); the exact id follows what `agy models` offers."""
    ids = [m for m in models if m.get("provider") == "agy"]
    pref = [m for m in ids if m["id"].startswith(AUTO_PREFIX)]
    for m in pref:
        if m["id"].endswith("-" + AUTO_EFFORT):
            return m
    if pref:
        return pref[0]
    flash = [m for m in ids if re.match(r"^gemini-[\d.]+-flash", m["id"])]
    if flash:
        log.warning("Auto model prefix %s not offered by agy; using %s", AUTO_PREFIX, flash[0]["id"])
        return flash[0]
    return None


async def auto_target() -> Dict[str, Any]:
    models = await agy_models()
    m = pick_auto(models)
    if not m:
        raise BackendError(
            "Chế độ Auto cần `agy` có model Gemini Flash. Cài/đăng nhập agy, hoặc chọn model cụ thể trong danh sách.",
            kind="missing", code="backend_no_auto",
        )
    return m


# --------------------------------------------------------------------------- NDJSON parsers


class AgyParser:
    """agy --output-format stream-json: init / step_update (agent_response text_delta) / result."""

    def __init__(self) -> None:
        self.conv: Optional[str] = None
        self.model: Optional[str] = None
        self.events = 0
        self.streamed = False
        self.final = ""
        self.done = False
        self.error: Optional[str] = None

    def feed(self, obj: Dict[str, Any]) -> str:
        ev = obj.get("event")
        if not ev:
            return ""
        self.events += 1
        if ev == "init":
            init = obj.get("init") or {}
            self.conv = obj.get("conversation_id") or init.get("conversation_id") or self.conv
        elif ev == "step_update":
            su = obj.get("step_update") or {}
            self.conv = su.get("conversation_id") or self.conv
            if su.get("step_type") == "agent_response" and su.get("text_delta"):
                self.streamed = True
                return str(su["text_delta"])
        elif ev == "result":
            r = obj.get("result") or {}
            self.conv = r.get("conversation_id") or self.conv
            self.final = str(r.get("response") or "")
            self.done = True
            if r.get("status") not in (None, "SUCCESS"):
                self.error = str(r.get("error") or r.get("message") or f"agy status {r.get('status')}")
        return ""


class ClaudeParser:
    """claude -p --output-format stream-json --verbose: system/init, assistant, stream_event, result."""

    def __init__(self) -> None:
        self.conv: Optional[str] = None
        self.model: Optional[str] = None
        self.events = 0
        self.partial = False
        self.streamed = False
        self.final = ""
        self.done = False
        self.error: Optional[str] = None

    def feed(self, obj: Dict[str, Any]) -> str:
        t = obj.get("type")
        if not t:
            return ""
        self.events += 1
        self.conv = obj.get("session_id") or self.conv
        if t == "system" and obj.get("subtype") == "init":
            self.model = obj.get("model") or self.model
        elif t == "stream_event":
            ev = obj.get("event") or {}
            delta = ev.get("delta") or {}
            if ev.get("type") == "content_block_delta" and delta.get("type") == "text_delta" and delta.get("text"):
                self.partial = self.streamed = True
                return str(delta["text"])
        elif t == "assistant" and not self.partial:
            blocks = (obj.get("message") or {}).get("content") or []
            text = "".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")
            if text:
                self.streamed = True
                return text
        elif t == "result":
            self.final = str(obj.get("result") or "")
            self.done = True
            if obj.get("is_error") or obj.get("subtype") not in (None, "success"):
                self.error = self.final or str(obj.get("subtype") or "claude error")
        return ""


def make_parser(backend: str):
    return AgyParser() if backend == "agy" else ClaudeParser()


# --------------------------------------------------------------------------- command lines


def build_cmd(p: Probe, model: Optional[str], prompt: str, conv: Optional[str], text_mode: bool) -> Tuple[List[str], Optional[str]]:
    """(argv, stdin text) for one headless turn, using only the flags this CLI install supports."""
    cmd: List[str]
    stdin: Optional[str] = None
    if p.backend == "agy":
        if os.name == "nt" and len(prompt) > WIN_ARG_LIMIT:
            raise BackendError("Lời nhắc quá dài cho dòng lệnh Windows. Hãy bớt skill/lịch sử rồi thử lại.", code="backend_prompt_too_long")
        cmd = [p.path, "-p", prompt]
        if not text_mode:
            cmd += ["--output-format", "stream-json"]
        if model:
            cmd += ["--model", model]
        if conv:
            flag = next((f for f in ("--conversation", "--resume", "--session") if p.has(f)), "--conversation")
            cmd += [flag, conv]
        if p.has("--print-timeout"):
            cmd += ["--print-timeout", os.environ.get("HERMES_AGY_PRINT_TIMEOUT", "900s")]
        if os.environ.get("HERMES_AGY_SANDBOX", "").lower() in ("1", "true", "yes") and p.has("--sandbox"):
            cmd += ["--sandbox"]
        extra = os.environ.get("HERMES_AGY_FLAGS")
    else:
        cmd = [p.path, "-p"]  # prompt goes through stdin: no argv size limit, and it stays out of the process list
        stdin = prompt
        if not text_mode:
            cmd += ["--output-format", "stream-json"]
            if "--verbose" not in p.denied:
                cmd += ["--verbose"]
            if p.has("--include-partial-messages"):
                cmd += ["--include-partial-messages"]
        if model:
            cmd += ["--model", model]
        if conv:
            flag = next((f for f in ("--resume", "-r") if f == "-r" or p.has(f)), "--resume")
            cmd += [flag, conv]
        if p.has("--strict-mcp-config"):  # keep the user's MCP servers/plugins out of this hidden workspace
            cmd += ["--strict-mcp-config"]
        if p.has("--disable-slash-commands"):
            cmd += ["--disable-slash-commands"]
        if p.has("--tools"):
            cmd += ["--tools", ""]  # no native tools: Office edits go through office-tool blocks
        extra = os.environ.get("HERMES_CLAUDE_FLAGS")
    if extra:
        cmd += shlex.split(extra)
    return cmd, stdin


class _ProcFail(Exception):
    def __init__(self, rc: int, tail: str) -> None:
        super().__init__(tail)
        self.rc = rc
        self.tail = tail


async def _exec_lines(cmd: List[str], stdin_text: Optional[str], env: Dict[str, str], cwd: Path):
    """Yield decoded stdout lines; raise _ProcFail on a non-zero exit or on silence."""
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdin=asyncio.subprocess.PIPE if stdin_text is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=str(cwd), env=env, limit=16 * 1024 * 1024,
    )
    err: List[bytes] = []

    async def drain() -> None:
        assert proc.stderr is not None
        while True:
            b = await proc.stderr.read(4096)
            if not b:
                return
            err.append(b)

    drain_task = asyncio.create_task(drain())
    if stdin_text is not None and proc.stdin is not None:
        try:
            proc.stdin.write(stdin_text.encode("utf-8"))
            await proc.stdin.drain()
            proc.stdin.close()
        except (BrokenPipeError, ConnectionResetError):
            pass
    tail_out: List[str] = []
    try:
        assert proc.stdout is not None
        while True:
            try:
                raw = await asyncio.wait_for(proc.stdout.readline(), IDLE_TIMEOUT)
            except asyncio.TimeoutError:
                raise _ProcFail(124, f"no output for {IDLE_TIMEOUT:.0f}s")
            if not raw:
                break
            line = raw.decode("utf-8", "replace")
            tail_out = (tail_out + [line])[-6:]
            yield line
        rc = await proc.wait()
        await drain_task
        if rc != 0:
            msg = (b"".join(err).decode("utf-8", "replace").strip() or "".join(tail_out).strip())[-1500:]
            raise _ProcFail(rc, msg or f"exit code {rc}")
    finally:
        if proc.returncode is None:
            proc.kill()
            try:
                await proc.wait()
            except Exception:  # noqa: BLE001
                pass
        drain_task.cancel()


def _loads(line: str) -> Optional[Dict[str, Any]]:
    s = line.strip()
    if not s.startswith("{"):
        return None
    try:
        obj = json.loads(s)
    except ValueError:
        return None
    return obj if isinstance(obj, dict) else None


@dataclass
class TurnResult:
    text: str
    conv_id: Optional[str]
    model: Optional[str] = None  # model id the CLI reports (e.g. the alias `sonnet` resolved to a full id)
    notes: List[str] = field(default_factory=list)


async def _attempt(p: Probe, model: Optional[str], prompt: str, conv: Optional[str], text_mode: bool,
                   on_chunk: Callable[[str], Awaitable[None]], env: Dict[str, str]) -> TurnResult:
    cmd, stdin = build_cmd(p, model, prompt, conv, text_mode)
    parser = make_parser(p.backend)
    out: List[str] = []
    stray: List[str] = []

    async def emit(t: str) -> None:
        out.append(t)
        await on_chunk(t)

    gen = _exec_lines(cmd, stdin, env, workspace_dir())
    try:
        async for line in gen:
            if text_mode:
                await emit(line)
                continue
            obj = _loads(line)
            if obj is None:
                stray.append(line)
                continue
            t = parser.feed(obj)
            if t:
                await emit(t)
    except _ProcFail as pf:
        raise BackendError(pf.tail, kind=classify(pf.tail), detail=pf.tail, cmd=cmd) from None
    finally:
        await gen.aclose()
    if text_mode:
        return TurnResult("".join(out), conv, None)
    if parser.events == 0:
        raise BackendError("không đọc được đầu ra của CLI", kind="empty", detail="".join(stray)[-800:], cmd=cmd)
    if parser.error:
        raise BackendError(parser.error, kind=classify(parser.error), detail=parser.error, cmd=cmd)
    if not parser.done:
        raise BackendError("CLI kết thúc mà không trả kết quả", kind="empty", detail="".join(stray)[-800:], cmd=cmd)
    if not out and parser.final:
        await emit(parser.final)  # no deltas were streamed: deliver the final text once
    return TurnResult("".join(out), parser.conv or conv, getattr(parser, "model", None))


def _bad_flag(detail: str, cmd: List[str]) -> Optional[str]:
    """The optional flag of `cmd` named in a CLI error message (Go and click/commander styles)."""
    present = {c for c in cmd if c.startswith("-")}
    for line in detail.splitlines():
        if not FLAG_ERR_RE.search(line):
            continue
        for tok in TOKEN_RE.findall(line):
            norm = tok if tok.startswith("--") else "--" + tok.lstrip("-") if len(tok.lstrip("-")) > 1 else tok
            if norm in present and norm not in ("-p", "--model"):
                return norm
    return None


def _friendly(exc: BackendError, backend: str, model: Optional[str], version: str, adapted: bool) -> BackendError:
    v = version or "?"
    if exc.kind == "auth":
        msg = f"`{backend}` chưa đăng nhập hoặc phiên đã hết hạn. Mở terminal, chạy `{backend}` để đăng nhập lại. ({exc.detail[:300]})"
        return BackendError(msg, kind="auth", code="backend_auth", detail=exc.detail)
    if exc.kind == "model":
        msg = f"Model `{model}` không dùng được với {backend} {v}. Hãy chọn model khác trong danh sách. ({exc.detail[:300]})"
        return BackendError(msg, kind="model", code="backend_model", detail=exc.detail)
    if adapted:
        msg = f"{backend} {v} vẫn lỗi sau khi tự điều chỉnh theo phiên bản: {exc.detail[:500]}"
        return BackendError(msg, kind=exc.kind, code="backend_adapt_failed", detail=exc.detail)
    return BackendError(f"{backend} lỗi: {exc.detail[:600]}", kind=exc.kind, code="backend_failed", detail=exc.detail)


async def run_turn(backend: str, model: Optional[str], full_prompt: str, delta_prompt: str, conv: Optional[str],
                   on_chunk: Callable[[str], Awaitable[None]], env: Optional[Dict[str, str]] = None) -> TurnResult:
    """One chat turn. `full_prompt` starts a conversation; `delta_prompt` continues `conv`.

    On a version mismatch the CLI is re-probed and the call retried (max 2 retries), never with another model.
    """
    cenv = child_env(env)
    notes: List[str] = []
    text_mode = False
    cur = conv
    force = False
    last: Optional[BackendError] = None
    version = ""
    for attempt in range(3):
        probe = await get_probe(backend, force=force)
        version = probe.version or probe.fingerprint
        force = False
        prompt = delta_prompt if cur else full_prompt
        try:
            res = await _attempt(probe, model, prompt, cur, text_mode, on_chunk, cenv)
            res.notes = notes
            if notes:
                log.info("%s %s adapted: %s", backend, version, "; ".join(notes))
            return res
        except BackendError as exc:
            last = exc
            if exc.kind == "session" and cur:
                cur = None
                notes.append("conversation id dropped")
                continue
            if exc.kind in ("flag", "empty") and attempt < 2:
                bad = _bad_flag(exc.detail, exc.cmd)
                if bad in ("--output-format", "--verbose") or (not bad and (exc.kind == "empty" or attempt == 1)):
                    text_mode = True
                    notes.append("plain-text output")
                elif bad:
                    probe.denied.add(bad)
                    _save_disk(probe)
                    notes.append(f"dropped {bad}")
                force = True
                continue
            raise _friendly(exc, backend, model, version, adapted=bool(notes)) from None
    assert last is not None
    raise _friendly(last, backend, model, version, adapted=True)


async def update_backend(backend: str) -> str:
    """Explicit, user-triggered `<cli> update`; refreshes the probe afterwards."""
    probe = await get_probe(backend)
    rc, out = await _run(probe.path, "update", timeout=600, cwd=workspace_dir(), env=child_env())
    _models_cache.pop(backend, None)
    await get_probe(backend, force=True)
    if rc != 0:
        raise BackendError(f"`{backend} update` lỗi: {out[-400:]}", code="backend_update_failed")
    return out[-800:]
