"""hermes-office-bridge: local daemon between the Office taskpane and the Hermes CLI.

Protocol (JSON text frames over /ws):

client -> bridge
  {"type": "status"}
  {"type": "chat", "id": str, "text": str, "host": "word|excel|powerpoint", "context": str?}
  {"type": "cancel", "id": str}
  {"type": "list_models"} | {"type": "set_model", "model": str, "provider": str?}
  {"type": "list_skills"} | {"type": "set_skills", "skills": [str]} | {"type": "get_skill", "name": str}
  {"type": "restore_history", "messages": [{"role": "user|assistant", "content": str}]}  (only if history is empty)
  {"type": "list_tools"}                       (Office tools + Hermes toolsets)
  {"type": "run_tool", "id": str, "tool": str, "args": {...}}      (run an Office tool directly)
  {"type": "run_toolset", "id": str, "toolset": str, "text": str}  (one-shot Hermes run limited to a toolset)
  {"type": "inline", "id": str, "text": str, "target": str, "host": str}  (rewrite `target`, no tools)
  {"type": "rpc_result", "id": str, "result": any} | {"type": "rpc_result", "id": str, "error": str}
  {"type": "auth_status"}                      (hermes/agy installed + Google account logged in?)
  {"type": "auth_google"} | {"type": "auth_cancel"} | {"type": "auth_logout"}   (Google OAuth via Antigravity)
  {"type": "setup_install", "target": "hermes|agy|plugin"}                     (stream installer progress; "plugin" = hermes plugins enable <HERMES_AGY_PLUGIN>)

bridge -> client
  {"type": "status", "hermes": {...}, "tools": [...]}
  {"type": "delta", "id": str, "text": str}
  {"type": "tool_call", "id": str, "tool": str, "args": {...}}      (informational)
  {"type": "tool_result", "id": str, "tool": str, "ok": bool, "result": any}
  {"type": "done", "id": str}
  {"type": "error", "id": str?, "message": str, "code": str?}
  {"type": "models", "models": [...], "current": {...}} | {"type": "skills", "skills": [...], "active": [str]}
  {"type": "tools_info", "office": [...], "hermes": [...]}
  {"type": "rpc_request", "id": str, "tool": str, "args": {...}}    (client must answer with rpc_result)
  {"type": "auth_status", **auth_info}                              (broadcast to every session when it changes)
  {"type": "auth_progress", "stage": str, "line": str?, "url": str?}   (login / setup progress)
  {"type": "plugin_progress", "stage": "plugin", "line": str, "ok": bool?, "needs": "hermes|agy"?}   (plugin enable progress)

The agent triggers Office edits by emitting fenced blocks in its reply:

    ```office-tool
    {"tool": "office_word_insert_text", "args": {"text": "hello"}}
    ```

The bridge executes them through the taskpane (RPC), feeds the results back to Hermes and
continues until the agent answers without tool blocks (or MAX_TOOL_ROUNDS is hit).
"""
from __future__ import annotations

import argparse
import asyncio
import codecs
import colorsys
import json
import logging
import os
import re
import shutil
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

log = logging.getLogger("hermes-office-bridge")

DEFAULT_PORT = 8765
RPC_TIMEOUT = 60.0
MAX_TOOL_ROUNDS = 6
# Model routing. The core model handles chat/tool use; the fast model handles inline edits.
# Set HERMES_CORE_MODEL="" / HERMES_FAST_MODEL="" to fall back to Hermes' configured default.
# The ids are passed to `hermes -m`; they must exist for your configured provider, so override
# them (and the *_PROVIDER vars) if your provider names them differently.
CORE_MODEL = os.environ.get("HERMES_CORE_MODEL", "claude-3-5-sonnet") or None
CORE_PROVIDER = os.environ.get("HERMES_CORE_PROVIDER") or None
FAST_MODEL = os.environ.get("HERMES_FAST_MODEL", "gemini-3.8-flash") or None
FAST_PROVIDER = os.environ.get("HERMES_FAST_PROVIDER") or None
# Official installers used by the in-extension setup flow (override with env vars; empty = unsupported).
HERMES_INSTALL_URL = os.environ.get(
    "HERMES_INSTALL_URL", "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh"
)
AGY_INSTALL_URL = os.environ.get("AGY_INSTALL_URL", "")
AUTH_PROVIDER = os.environ.get("HERMES_AUTH_PROVIDER", "antigravity")  # Google sign-in provider id in Hermes
# Hermes plugin that serves Gemini through the signed-in Antigravity (agy) account. Enabled automatically with
# `hermes plugins enable <name>` once agy is installed; HERMES_AGY_PLUGIN="" turns the whole feature off.
PLUGIN_NAME = os.environ.get("HERMES_AGY_PLUGIN", "antigravity-subscription-directsdk")
PLUGIN_MARKER = Path.home() / ".hermes-office" / "plugin-enabled"  # records that Hermes Office enabled PLUGIN_NAME
CERT_DIR = Path.home() / ".hermes-office" / "certs"
DIST_DIR = Path(os.environ.get("HERMES_OFFICE_DIST") or Path(__file__).resolve().parent.parent / "addin" / "dist")

TOOLS: Dict[str, Dict[str, Any]] = {
    "office_word_get_selection": {"host": "word", "args": {}},
    "office_word_get_full_text": {"host": "word", "args": {}},
    "office_word_replace_selection": {"host": "word", "args": {"text": "string"}},
    "office_word_set_range": {"host": "word", "args": {"text": "string", "which": "whole|selection (default whole)"}},
    "office_word_insert_text": {"host": "word", "args": {"text": "string", "location": "Start|End (optional)"}},
    "office_word_insert_equation": {"host": "word", "args": {"latex": "LaTeX without $ delimiters, e.g. \\frac{a}{b} or \\ce{2H2 + O2 -> 2H2O}", "location": "Start|End|Replace (optional, default End; Replace = current selection)"}},
    "office_word_insert_table": {"host": "word", "args": {"values": "string[][]"}},
    "office_excel_get_active_sheet": {"host": "excel", "args": {}},
    "office_excel_get_range": {"host": "excel", "args": {"address": "A1:C10 (optional, default selection)"}},
    "office_excel_set_range_values": {"host": "excel", "args": {"address": "A1:B2", "values": "any[][]"}},
    "office_excel_set_formula": {"host": "excel", "args": {"address": "A1", "formula": "=SUM(B1:B9)"}},
    "office_word_get_styles": {"host": "word", "args": {"which": "selection|document (default selection)"}},
    "office_word_apply_format": {"host": "word", "args": {"which": "selection|document (default selection)", "fontName": "string", "fontSize": "number", "bold": "bool", "italic": "bool", "color": "#RRGGBB", "alignment": "Left|Centered|Right|Justified", "lineSpacing": "points", "spaceBefore": "points", "spaceAfter": "points", "firstLineIndent": "points", "leftIndent": "points (all optional)"}},
    "office_excel_get_format": {"host": "excel", "args": {"address": "A1:C1 (optional, default selection)"}},
    "office_word_get_page_setup": {"host": "word", "args": {}},
    "office_word_set_page_setup": {"host": "word", "args": {"topMargin": "points", "bottomMargin": "points", "leftMargin": "points", "rightMargin": "points", "orientation": "Portrait|Landscape", "paperSize": "e.g. A4, Letter, Legal, A5, Executive", "headerDistance": "points", "footerDistance": "points", "verticalAlignment": "Top|Center|Justify|Bottom (all optional)"}},
    "office_word_apply_style": {"host": "word", "args": {"style": "e.g. Heading 1, Title, Subtitle, Quote, Intense Quote, Normal, No Spacing, Caption, Table Grid; or a custom/localized style name", "which": "selection|document (default selection)"}},
    "office_excel_set_format": {"host": "excel", "args": {"address": "A1:C1 (optional)", "fontName": "string", "fontSize": "number", "bold": "bool", "italic": "bool", "fontColor": "#RRGGBB", "fillColor": "#RRGGBB", "numberFormat": "e.g. #,##0.00", "horizontalAlignment": "Left|Center|Right", "verticalAlignment": "Top|Center|Bottom", "wrapText": "bool", "columnWidth": "number (all optional)"}},
    "office_excel_create_table": {"host": "excel", "args": {"address": "string (optional, e.g. A1:E20)", "name": "string (optional)", "hasHeaders": "bool (optional, default true)"}},
    "office_excel_list_tables": {"host": "excel", "args": {}},
    "office_excel_add_table_column": {"host": "excel", "args": {"tableName": "string", "columnName": "string", "formula": "string (optional, e.g. =[@[Price]]*[@[Qty]])"}},
    "office_excel_insert_chart": {"host": "excel", "args": {"dataAddress": "string (e.g. A1:D10)", "chartType": "ColumnClustered|Line|Pie|BarClustered (default ColumnClustered)", "title": "string (optional)", "targetCell": "string (optional, e.g. F2)"}},
    "office_excel_conditional_format": {"host": "excel", "args": {"address": "string (optional)", "ruleType": "colorScale|preset|cellValue", "criteria": "string (optional, e.g. duplicateValues or number threshold)", "fillColor": "#RRGGBB (optional)", "fontColor": "#RRGGBB (optional)"}},
    "office_excel_design_table": {"host": "excel", "args": {"address": "A1:E20 (optional, default selection; first row is treated as the header)", "header": "bool (default true)", "headerFill": "#RRGGBB (default #1F4E78)", "headerFontColor": "#RRGGBB (default #FFFFFF)", "banded": "bool (default true)", "bandFill": "#RRGGBB (default #F2F6FA)", "borders": "bool (default true)", "borderColor": "#RRGGBB (default #BFBFBF)", "autoFit": "bool (default true)"}},
    "office_excel_sort_filter": {"host": "excel", "args": {"address": "string (optional)", "sortColumn": "number (0-indexed)", "ascending": "bool (default true)", "filterColumn": "number (0-indexed, optional)", "filterCriteria": "string (optional)"}},
    "office_excel_list_sheets": {"host": "excel", "args": {}},
    "office_excel_add_sheet": {"host": "excel", "args": {"name": "string (optional)"}},
    "office_ppt_get_theme": {"host": "powerpoint", "args": {"slideIndex": "number (optional, default selected slide)"}},
    "office_ppt_format_shape": {"host": "powerpoint", "args": {"slideIndex": "number", "shapeId": "string", "fontName": "string", "fontSize": "number", "bold": "bool", "italic": "bool", "fontColor": "#RRGGBB", "fillColor": "#RRGGBB (optional)"}},
    "office_ppt_apply_format": {"host": "powerpoint", "args": {"scope": "selection|slide|presentation (default presentation)", "slideIndex": "number (optional)", "fontName": "string", "fontSize": "number", "bold": "bool", "italic": "bool", "fontColor": "#RRGGBB", "fillColor": "#RRGGBB (all optional)"}},
    "office_ppt_apply_palette": {"host": "powerpoint", "args": {"scope": "selection|slide|presentation (default presentation)", "slideIndex": "number (optional, used with scope=slide)", "titleColor": "#RRGGBB (biggest text of each slide)", "bodyColor": "#RRGGBB (remaining text)", "accentColor": "#RRGGBB (shapes without text)", "backgroundColor": "#RRGGBB (slide background, all optional)"}},
    "office_ppt_generate_slide": {"host": "powerpoint", "args": {"title": "string", "subtitle": "string (optional)", "bullets": "string[] (optional)", "layoutId": "string (optional)"}},
    "office_ppt_get_slides": {"host": "powerpoint", "args": {}},
    "office_ppt_add_slide": {"host": "powerpoint", "args": {"layoutId": "string (optional)"}},
    "office_ppt_insert_text_box": {
        "host": "powerpoint",
        "args": {"text": "string", "left": "number", "top": "number", "width": "number", "height": "number"},
    },
}

# Bridge-local tools (run in the bridge, not the taskpane); available in every host.
LOCAL_TOOLS: Dict[str, Dict[str, Any]] = {
    "office_style_get_profile": {"host": "bridge", "args": {}},
    "office_style_save_profile": {"host": "bridge", "args": {"profile": "object, deep-merged into the saved profile, e.g. {\"word\": {\"font\": {\"name\": \"Times New Roman\", \"size\": 13}}}"}},
    "office_design_palette": {
        "host": "bridge",
        "args": {
            "seed": "#RRGGBB anchor color (optional; when given it drives the hue)",
            "mood": "balanced|vibrant|pastel|muted|warm|cool|mono|high-contrast (default balanced)",
            "dark": "bool (default false, dark surface palette)",
        },
    },
    "office_design_font_pair": {
        "host": "bridge",
        "args": {
            "vibe": "modern|classic|editorial|technical|friendly (optional, default all)",
            "platform": "any|mac|windows (default any: fonts that ship with Office everywhere)",
        },
    },
}
TOOLS.update(LOCAL_TOOLS)

TOOL_BLOCK_RE = re.compile(r"```office-tool\s*\n(.*?)\n\s*```", re.DOTALL)


# --------------------------------------------------------------------------- hermes CLI


class HermesNotFound(RuntimeError):
    """Raised when the Hermes CLI is missing; the UI localizes it via the `hermes_not_found` code."""

    code = "hermes_not_found"


def error_frame(cid: Optional[str], exc: BaseException) -> Dict[str, Any]:
    frame: Dict[str, Any] = {"type": "error", "message": str(exc) or type(exc).__name__}
    if cid:
        frame["id"] = cid
    code = getattr(exc, "code", None)
    if code:
        frame["code"] = code
    return frame


def find_hermes() -> Optional[str]:
    candidates = [os.environ.get("HERMES_BIN"), shutil.which("hermes")]
    candidates.append(str(Path.home() / ".hermes" / "hermes-agent" / ".hermes" / "bin" / "hermes"))
    candidates.append(str(Path.home() / ".local" / "bin" / "hermes"))
    for c in candidates:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


async def hermes_status() -> Dict[str, Any]:
    path = find_hermes()
    if not path:
        return {"installed": False, "path": None, "version": None}
    version = None
    try:
        proc = await asyncio.create_subprocess_exec(
            path, "--version", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        version = out.decode(errors="replace").strip().splitlines()[0] if out.strip() else None
    except Exception as exc:  # noqa: BLE001
        log.warning("hermes --version failed: %s", exc)
    return {"installed": True, "path": path, "version": version}


def find_agy() -> Optional[str]:
    for c in (os.environ.get("AGY_BIN"), shutil.which("agy"), str(Path.home() / ".local" / "bin" / "agy")):
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


PLUGIN_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")  # no leading "-": cannot become a CLI flag


def plugin_enabled() -> bool:
    """True once Hermes Office has run `hermes plugins enable PLUGIN_NAME` successfully."""
    try:
        return bool(PLUGIN_NAME) and PLUGIN_MARKER.read_text(encoding="utf-8").strip() == PLUGIN_NAME
    except OSError:
        return False


def fast_provider() -> Optional[str]:
    """Provider for fast (inline) edits: HERMES_FAST_PROVIDER wins; else the Antigravity plugin once it is enabled."""
    return FAST_PROVIDER or (PLUGIN_NAME if plugin_enabled() else None)


# --------------------------------------------------------------------------- google auth / setup

URL_RE = re.compile(r"https?://[^\s\"'<>]+")
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
URL_ALLOWED = re.compile(r"^https://([\w-]+\.)*(google\.com|googleapis\.com|antigravity\.google|nousresearch\.com)(/|$)")


def google_account() -> Optional[str]:
    """Email of the signed-in Google account, read from Hermes' auth store (never the tokens)."""
    try:
        data = json.loads((hermes_home() / "auth.json").read_text(encoding="utf-8"))
        prov = (data.get("providers") or {}).get(AUTH_PROVIDER) or {}
        email = prov.get("email")
        return email if isinstance(email, str) else None
    except (OSError, ValueError):
        return None


async def auth_info() -> Dict[str, Any]:
    hermes = await hermes_status()
    logged_in = False
    if hermes["installed"]:
        try:
            out = await run_cli("auth", "status", AUTH_PROVIDER, timeout=15)
            logged_in = bool(re.search(r"logged in", out, re.I)) and not re.search(r"not logged in|logged out", out, re.I)
        except Exception as exc:  # noqa: BLE001
            log.warning("auth status failed: %s", exc)
    return {
        "hermes": hermes,
        "agy": {"installed": bool(find_agy()), "path": find_agy()},
        "logged_in": logged_in,
        "account": google_account() if logged_in else None,
        "provider": AUTH_PROVIDER,
        "models": {"core": CORE_MODEL, "fast": FAST_MODEL},
        "login_running": login_task is not None and not login_task.done(),
        "install_running": install_task is not None and not install_task.done(),
        "plugin": {"name": PLUGIN_NAME or None, "enabled": plugin_enabled()},
    }


async def broadcast(msg: Dict[str, Any]) -> None:
    for s in list(sessions.values()):
        try:
            await s.send(msg)
        except Exception:  # noqa: BLE001
            pass


async def stream_process(
    cmd: List[str], stage: str, env: Optional[Dict[str, str]] = None, shell_script: Optional[bytes] = None,
    event: str = "auth_progress",
) -> int:
    """Run `cmd`, broadcasting each output line as `event` (auth_progress by default) and any URL found in it."""
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdin=asyncio.subprocess.PIPE if shell_script is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env={**os.environ, "NO_COLOR": "1", **(env or {})},
    )
    if shell_script is not None and proc.stdin:
        proc.stdin.write(shell_script)
        await proc.stdin.drain()
        proc.stdin.close()
    try:
        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = ANSI_RE.sub("", raw.decode(errors="replace")).strip()
            if not line:
                continue
            frame: Dict[str, Any] = {"type": event, "stage": stage, "line": line[:400]}
            m = URL_RE.search(line)
            if m and URL_ALLOWED.match(m.group(0)):
                frame["url"] = m.group(0)
            await broadcast(frame)
        return await proc.wait()
    except asyncio.CancelledError:
        if proc.returncode is None:
            proc.kill()
        raise


login_task: "Optional[asyncio.Task[None]]" = None
install_task: "Optional[asyncio.Task[None]]" = None


async def _login() -> None:
    try:
        await broadcast({"type": "auth_progress", "stage": "login", "line": "start"})
        rc = await asyncio.wait_for(
            stream_process([find_hermes() or "hermes", "auth", "add", AUTH_PROVIDER, "--type", "oauth"], "login"), timeout=300
        )
        await broadcast({"type": "auth_progress", "stage": "login", "line": "exit", "ok": rc == 0})
        if rc == 0 and PLUGIN_NAME and find_agy() and not plugin_enabled():
            await _enable_plugin()  # signed in and agy present: switch the Antigravity plugin on without asking again
    except asyncio.TimeoutError:
        await broadcast({"type": "auth_progress", "stage": "login", "line": "exit", "ok": False, "timeout": True})
    except asyncio.CancelledError:
        await broadcast({"type": "auth_progress", "stage": "login", "line": "exit", "ok": False, "cancelled": True})
    except Exception as exc:  # noqa: BLE001
        log.exception("login failed")
        await broadcast({"type": "auth_progress", "stage": "login", "line": "exit", "ok": False, "error": str(exc)})
    finally:
        await broadcast({"type": "auth_status", **await auth_info()})


async def _install(target: str) -> None:
    url = HERMES_INSTALL_URL if target == "hermes" else AGY_INSTALL_URL
    try:
        if not url or not url.startswith("https://"):
            await broadcast({"type": "auth_progress", "stage": target, "line": "exit", "ok": False, "manual": True})
            return
        if sys.platform == "win32":
            await broadcast({"type": "auth_progress", "stage": target, "line": "exit", "ok": False, "manual": True})
            return
        import urllib.request

        def fetch() -> bytes:
            with urllib.request.urlopen(url, timeout=60) as r:  # noqa: S310 (https only, checked above)
                return r.read(2_000_000)

        script = await asyncio.get_running_loop().run_in_executor(None, fetch)
        await broadcast({"type": "auth_progress", "stage": target, "line": f"downloaded installer ({len(script)} bytes)"})
        rc = await stream_process(["bash", "-s"], target, shell_script=script)
        await broadcast({"type": "auth_progress", "stage": target, "line": "exit", "ok": rc == 0})
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("install failed")
        await broadcast({"type": "auth_progress", "stage": target, "line": "exit", "ok": False, "error": str(exc)})
    finally:
        await broadcast({"type": "auth_status", **await auth_info()})


async def _enable_plugin() -> None:
    """`hermes plugins enable <PLUGIN_NAME>`; progress goes out as plugin_progress (never mixes with the login dialog).

    Order follows the plugin's own setup: agy CLI installed (and signed in) first, then enable. Safe to repeat.
    """
    event = "plugin_progress"

    async def done(ok: bool, **extra: Any) -> None:
        await broadcast({"type": event, "stage": "plugin", "line": "exit", "ok": ok, "plugin": PLUGIN_NAME, **extra})

    try:
        if not PLUGIN_NAME or not PLUGIN_NAME_RE.match(PLUGIN_NAME):
            await done(False, error="plugin name is empty or invalid")
        elif not find_hermes():
            await done(False, needs="hermes")
        elif not find_agy():
            await done(False, needs="agy")  # step 1 of the plugin setup: install the agy CLI (and sign in)
        else:
            await broadcast({"type": event, "stage": "plugin", "line": "start", "plugin": PLUGIN_NAME})
            rc = await asyncio.wait_for(
                stream_process([find_hermes() or "hermes", "plugins", "enable", PLUGIN_NAME], "plugin", event=event), timeout=120
            )
            if rc == 0:
                PLUGIN_MARKER.parent.mkdir(parents=True, exist_ok=True)
                PLUGIN_MARKER.write_text(PLUGIN_NAME, encoding="utf-8")
            await done(rc == 0)
    except asyncio.TimeoutError:
        await done(False, timeout=True)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("plugin enable failed")
        await done(False, error=str(exc))
    finally:
        await broadcast({"type": "auth_status", **await auth_info()})


def utf8_env(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Environment forcing UTF-8 in child processes (LaunchAgent/systemd/Task start with no LANG)."""
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    if "UTF" not in (env.get("LC_ALL") or env.get("LANG") or "").upper():
        env["LANG"] = "en_US.UTF-8"
        env["LC_ALL"] = "en_US.UTF-8"
    if extra:
        env.update(extra)
    return env


SYSTEM_PREAMBLE = """You are Hermes, embedded in Microsoft {app} through an Office add-in.
You can read and edit the open document by emitting tool blocks. A tool block is a fenced code
block with the language `office-tool` containing one JSON object: {{"tool": NAME, "args": {{...}}}}.
Emit as many blocks as you need; they run in order and you will receive the results, then you
continue. When you are done, reply with plain text and no tool blocks.

Math, physics and chemistry in Word: write formulas as standard LaTeX, inline as $...$ or \(...\)
and display as $$...$$ or \[...\]. Word converts them automatically into native Word Equation
objects (OMML), both in text you pass to office_word_* tools and in text inserted from the chat.
Chemistry uses mhchem: $\ce{{CaCO3 -> CaO + CO2 ^}}$, $\ce{{H2SO4}}$, $\ce{{Fe^3+}}$; units with $\pu{{9.8 m/s^2}}.
Physics: $F = m a$, $E = \frac{{1}}{{2}} m v^2$, $\vec{{F}}$, $\Delta t$. Do not write formulas as plain
text or unicode approximations, and do not put LaTeX in code fences. For one standalone formula
you may call office_word_insert_equation.

PowerPoint formatting & batch operations:
To change fonts/colors in PowerPoint across shapes, use `office_ppt_apply_format` with scope='presentation'
(all slides), scope='slide' (current or slideIndex), or scope='selection'. Do NOT call office_ppt_format_shape
repeatedly in a loop. Note: Office.js does not support PowerPoint animations or slide transitions;
if the user asks for animations/transitions, politely inform them that Office Add-in APIs do not support it.

Available tools:
{tools}
"""


REASONING_LEVELS = ("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra")  # `hermes chat --reasoning`
RULES_MAX = 8000


def build_prompt(host: str, history: List[Dict[str, str]], context: Optional[str], rules: str = "") -> str:
    app = {"word": "Word", "excel": "Excel", "powerpoint": "PowerPoint"}.get(host, "Office")
    tools = "\n".join(
        f"- {name}({json.dumps(spec['args'])})" for name, spec in TOOLS.items() if spec["host"] in (host, "bridge") or host not in ("word", "excel", "powerpoint")
    )
    parts = [SYSTEM_PREAMBLE.format(app=app, tools=tools), style_prompt_section(host)]
    if rules.strip():
        parts.append("User rules (always follow these, they override defaults):\n" + rules.strip()[:RULES_MAX] + "\n")
    if context:
        parts.append(f"Current Office context:\n{context}\n")
    parts.append("Conversation:")
    for m in history:
        parts.append(f"[{m['role']}]\n{m['content']}")
    parts.append("[assistant]")
    return "\n\n".join(parts)


async def run_hermes(
    prompt: str,
    on_chunk,
    model: Optional[str] = None,
    provider: Optional[str] = None,
    skills: Optional[List[str]] = None,
    toolsets: Optional[str] = None,
    reasoning: Optional[str] = None,
) -> str:
    """Run `hermes chat` one-shot with the prompt from a file; stream stdout to on_chunk."""
    path = find_hermes()
    if not path:
        raise HermesNotFound("Hermes CLI not found. Install it or set HERMES_BIN.")
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write(prompt)
        qfile = f.name
    cmd = [path, "chat", "--query-file", qfile, "-Q", "--oneshot"]
    if model:
        cmd += ["-m", model]
    if provider:
        cmd += ["--provider", provider]
    if skills:
        cmd += ["-s", ",".join(skills)]
    if toolsets:
        cmd += ["-t", toolsets]
    if reasoning in REASONING_LEVELS:
        cmd += ["--reasoning", reasoning]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=utf8_env(),
    )
    chunks: List[str] = []
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")  # multi-byte chars (Vietnamese) can straddle reads
    try:
        assert proc.stdout is not None
        while True:
            data = await proc.stdout.read(1024)
            if not data:
                break
            text = decoder.decode(data)
            if not text:
                continue
            chunks.append(text)
            await on_chunk(text)
        tail = decoder.decode(b"", final=True)
        if tail:
            chunks.append(tail)
            await on_chunk(tail)
        rc = await proc.wait()
        if rc != 0:
            err = (await proc.stderr.read()).decode(errors="replace").strip() if proc.stderr else ""
            raise RuntimeError(f"hermes exited with {rc}: {err[-800:]}")
    except asyncio.CancelledError:
        if proc.returncode is None:
            proc.kill()
        raise
    finally:
        try:
            os.unlink(qfile)
        except OSError:
            pass
    return "".join(chunks)


# --------------------------------------------------------------------------- models / skills / toolsets

NAME_RE = re.compile(r"^[A-Za-z0-9][^\r\n]{0,200}$")  # no leading "-" so values cannot become CLI flags (exec, no shell)


def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def load_config() -> Dict[str, Any]:
    try:
        import yaml  # type: ignore

        with open(hermes_home() / "config.yaml", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception as exc:  # noqa: BLE001
        log.warning("could not read hermes config: %s", exc)
        return {}


def list_models() -> Dict[str, Any]:
    """Models from config.yaml: the default model plus every custom provider's models."""
    cfg = load_config()
    mc = cfg.get("model") or {}
    if isinstance(mc, str):
        mc = {"default": mc}
    configured = {"model": mc.get("default") or mc.get("model"), "provider": mc.get("provider")}
    # Auto routing: chat uses the core model; fall back to Hermes' own default if unset.
    current = {"model": CORE_MODEL, "provider": CORE_PROVIDER} if CORE_MODEL else configured
    models: List[Dict[str, Any]] = []
    seen = set()

    def add(mid: Optional[str], provider: Optional[str], label: str, role: Optional[str] = None) -> None:
        if mid and (mid, provider) not in seen:
            seen.add((mid, provider))
            entry: Dict[str, Any] = {"id": mid, "provider": provider, "label": label}
            if role:
                entry["role"] = role  # the UI shows localized names/descriptions for roles
            models.append(entry)

    add(CORE_MODEL, CORE_PROVIDER, f"{CORE_MODEL} (core)", "core")
    add(FAST_MODEL, fast_provider(), f"{FAST_MODEL} (fast)", "fast")
    add(configured["model"], configured["provider"], f"{configured['model']} (configured)")
    for cp in cfg.get("custom_providers") or []:
        name = cp.get("name") or "custom"
        provider = f"custom:{name}"
        ms = cp.get("models") or {}
        ids = list(ms) if isinstance(ms, (dict, list)) else []
        add(cp.get("model"), provider, f"{cp.get('model')} · {name}")
        for mid in ids:
            add(str(mid), provider, f"{mid} · {name}")
    return {"models": models, "current": current}


async def run_cli(*args: str, timeout: float = 30) -> str:
    path = find_hermes()
    if not path:
        raise HermesNotFound("Hermes CLI not found")
    env = utf8_env({"COLUMNS": "400", "NO_COLOR": "1"})
    proc = await asyncio.create_subprocess_exec(
        path, *args, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT, env=env,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(f"hermes {' '.join(args)} timed out")
    return out.decode(errors="replace")


SKILL_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")
FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
SKILL_FILE_MAX_BYTES = 200_000

# Vietnamese short descriptions for common skills (the SKILL.md frontmatter is usually English).
SKILL_VI: Dict[str, str] = {
    "office-user-style": "Học thói quen định dạng của bạn và áp dụng nhất quán trong Word, Excel, PowerPoint.",
    "python-engineering": "Phát triển Python: khám phá mã tiết kiệm, kiểm thử có mục tiêu, nâng cấp khi cần.",
    "document-research": "Nghiên cứu có trích dẫn trên nhiều tài liệu cục bộ, kiểu NotebookLM.",
    "competition-report-typst-adaptation": "Chuyển thể báo cáo Typst sang một cuộc thi khác, giữ nguyên nội dung sản phẩm.",
    "thien-nhan-device": "Xây dựng và gỡ lỗi thiết bị Pi hỗ trợ thị giác Thiên Nhãn cho người khiếm thị.",
    "code-review": "Rà soát mã nguồn: tìm lỗi, rủi ro và đề xuất cải thiện.",
    "humanizer": "Viết lại văn bản máy tạo cho tự nhiên, giống giọng người viết.",
    "rewrite": "Viết lại văn bản rõ ràng, gọn gàng hơn mà giữ nguyên ý.",
    "re-write": "Viết lại văn bản rõ ràng, gọn gàng hơn mà giữ nguyên ý.",
    "handoff": "Tóm tắt tiến độ để bàn giao cuộc trò chuyện cho phiên làm việc khác.",
    "claude-handoff": "Tóm tắt tiến độ để bàn giao cho một phiên Claude khác.",
    "grill-me": "Được chất vấn từng bước để làm rõ kế hoạch hoặc thiết kế của bạn.",
    "grilling": "Chất vấn từng bước để làm rõ kế hoạch hoặc thiết kế.",
    "grill-with-docs": "Chất vấn kế hoạch dựa trên tài liệu dự án và cập nhật tài liệu khi chốt quyết định.",
    "implement": "Triển khai tính năng theo từng bước nhỏ, có kiểm thử.",
    "implement-spec": "Triển khai tính năng theo đặc tả đã thống nhất.",
    "prototype": "Dựng nhanh bản mẫu để thử nghiệm ý tưởng trước khi làm thật.",
    "retro": "Tổng kết, rút kinh nghiệm sau một đợt công việc.",
    "diagnosing-bugs": "Chẩn đoán lỗi có hệ thống: tái hiện, thu hẹp phạm vi, tìm nguyên nhân gốc.",
    "resolving-merge-conflicts": "Giải quyết xung đột khi merge một cách an toàn.",
    "improve-codebase-architecture": "Đề xuất cải thiện kiến trúc mã nguồn để dễ bảo trì, dễ kiểm thử.",
    "codebase-design": "Thiết kế cấu trúc mã nguồn rõ ràng, dễ mở rộng.",
    "codebase-memory": "Ghi nhớ cấu trúc và quy ước của mã nguồn qua các phiên làm việc.",
    "domain-modeling": "Mô hình hóa miền nghiệp vụ và thống nhất thuật ngữ chung.",
    "setup-pre-commit": "Cài đặt pre-commit hook để kiểm tra mã trước khi commit.",
    "git-guardrails-claude-code": "Đặt rào chắn an toàn cho các thao tác git nguy hiểm.",
    "loop-me": "Lặp lại một tác vụ theo chu kỳ cho đến khi hoàn thành.",
    "scaffold-exercises": "Dựng khung bài tập và tài liệu thực hành.",
    "migrate-to-shoehorn": "Chuyển các mock kiểm thử sang thư viện shoehorn.",
    "defuddle": "Trích nội dung sạch từ trang web, loại bỏ phần thừa.",
    "enumlist": "Liệt kê và đánh số các mục một cách có hệ thống.",
    "bao-cao-nckh": "Viết báo cáo nghiên cứu khoa học kỹ thuật.",
    "bang-diem-chia-nhom": "Lập bảng điểm và chia nhóm học sinh.",
}


def skill_dirs() -> List[Path]:
    dirs = [hermes_home() / "skills"]
    for extra in (os.environ.get("HERMES_SKILLS_DIRS") or "").split(os.pathsep):
        if extra.strip():
            dirs.append(Path(extra.strip()).expanduser())
    return [d for d in dirs if d.is_dir()]


def parse_frontmatter(text: str) -> "tuple[Dict[str, Any], str]":
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    raw, body = m.group(1), text[m.end():]
    meta: Dict[str, Any] = {}
    try:
        import yaml  # type: ignore

        loaded = yaml.safe_load(raw)
        if isinstance(loaded, dict):
            meta = loaded
    except Exception:  # noqa: BLE001
        for line in raw.splitlines():
            k, sep, v = line.partition(":")
            if sep and k.strip() and not line.startswith((" ", "\t")):
                meta[k.strip()] = v.strip().strip("\"'")
    return meta, body


def create_skill(name: str, description: str, body: str) -> Path:
    """Write ~/.hermes/skills/<name>/SKILL.md; refuses to overwrite so a typo cannot clobber an existing skill."""
    if not SKILL_NAME_RE.match(name) or name.lower() in ("con", "nul", "aux", "prn"):
        raise ValueError("invalid skill name (use letters, digits, '-', '_', '.')")
    if find_skill_file(name):
        raise ValueError(f"skill '{name}' already exists")
    desc = " ".join(description.split())[:300]
    if not desc or not body.strip():
        raise ValueError("description and instructions are required")
    path = hermes_home() / "skills" / name / "SKILL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    text = f"---\nname: {name}\ndescription: {json.dumps(desc, ensure_ascii=False)}\n---\n\n{body.strip()[:20000]}\n"
    path.write_text(text, encoding="utf-8")
    return path


def find_skill_file(name: str) -> Optional[Path]:
    """Locate <skills>/[category/]<name>/SKILL.md; the name is validated so it cannot escape the skill dirs."""
    if not SKILL_NAME_RE.match(name):
        return None
    for base in skill_dirs():
        direct = base / name / "SKILL.md"
        if direct.is_file():
            return direct
        for cand in base.glob(f"**/{name}/SKILL.md"):
            if cand.is_file():
                return cand
    return None


def _read_skill(path: Path) -> str:
    with open(path, "rb") as f:
        return f.read(SKILL_FILE_MAX_BYTES).decode("utf-8", errors="replace")


USAGE_HEAD_RE = re.compile(r"usage|how to use|when to use|quick ?start|workflow|steps?|procedure|cách (dùng|sử dụng)|sử dụng|khi nào|quy trình|bước", re.I)


def split_sections(body: str) -> "tuple[str, List[Dict[str, str]]]":
    """Split markdown into (intro, [{title, text}]) on level 1-3 headings, ignoring fenced code."""
    intro: List[str] = []
    sections: List[Dict[str, Any]] = []
    in_code = False
    for line in body.splitlines():
        if line.lstrip().startswith("```"):
            in_code = not in_code
        m = None if in_code else re.match(r"^(#{1,3})\s+(.*\S)\s*$", line)
        if m:
            sections.append({"title": m.group(2), "lines": []})
        elif sections:
            sections[-1]["lines"].append(line)
        else:
            intro.append(line)
    return "\n".join(intro).strip(), [{"title": s["title"], "text": "\n".join(s["lines"]).strip()} for s in sections]


def skill_description(meta: Dict[str, Any], body: str) -> str:
    d = meta.get("description")
    if isinstance(d, str) and d.strip():
        return " ".join(d.split())
    for line in body.splitlines():
        line = line.strip()
        if line and not line.startswith(("#", "```", "---")):
            return line[:240]
    return ""


def skill_detail(name: str) -> Optional[Dict[str, Any]]:
    path = find_skill_file(name)
    if not path:
        return None
    content = _read_skill(path)
    meta, body = parse_frontmatter(content)
    intro, sections = split_sections(body)
    usage = [s for s in sections if USAGE_HEAD_RE.search(s["title"]) and s["text"]]
    rest = [s for s in sections if s not in usage]
    desc = skill_description(meta, body)
    md = lambda secs: "\n\n".join(f"### {s['title']}\n\n{s['text']}".rstrip() for s in secs)  # noqa: E731
    base = next((d for d in skill_dirs() if d in path.parents), None)
    rel = path.parent.relative_to(base) if base else Path(path.parent.name)
    md_meta = meta.get("metadata")
    hermes_meta = (md_meta.get("hermes") if isinstance(md_meta, dict) else None) or {}
    hermes_meta = hermes_meta if isinstance(hermes_meta, dict) else {}
    tags = hermes_meta.get("tags")
    return {
        "name": name,
        "category": rel.parts[0] if len(rel.parts) > 1 else str(hermes_meta.get("category") or ""),
        "path": str(path),
        "description": desc,
        "description_en": desc,
        "description_vi": SKILL_VI.get(name) or desc,  # falls back to the original text when no translation exists
        "translated": name in SKILL_VI,
        "tags": tags if isinstance(tags, list) else [],
        "version": str(meta.get("version") or ""),
        "purpose": intro[:1500] or desc,
        "explanation": md(rest)[:12000],
        "usage": md(usage)[:8000],
        "content": content,
        "body": body.strip(),
    }


def skill_descriptions() -> Dict[str, Dict[str, str]]:
    """name -> {en, vi} short descriptions for every SKILL.md found (first 4 KB of each is enough)."""
    out: Dict[str, Dict[str, str]] = {}
    for base in skill_dirs():
        for f in base.glob("**/SKILL.md"):
            try:
                with open(f, "rb") as fh:
                    head = fh.read(4096).decode("utf-8", errors="replace")
                meta, body = parse_frontmatter(head)
            except OSError:
                continue
            nm = str(meta.get("name") or f.parent.name)
            en = skill_description(meta, body)
            out.setdefault(nm, {"en": en, "vi": SKILL_VI.get(nm) or en})
    return out


async def list_skills() -> List[Dict[str, Any]]:
    skills = await _list_skills_raw()
    try:
        descs = await asyncio.get_running_loop().run_in_executor(None, skill_descriptions)
    except Exception as exc:  # noqa: BLE001
        log.warning("skill descriptions failed: %s", exc)
        descs = {}
    for s in skills:
        d = descs.get(s["name"]) or {}
        en = d.get("en", "")
        s["description_en"] = en
        s["description_vi"] = SKILL_VI.get(s["name"]) or d.get("vi") or en
    return skills


async def _list_skills_raw() -> List[Dict[str, Any]]:
    """Parse the `hermes skills list` table (no --json in the CLI)."""
    out = await run_cli("skills", "list")
    skills: List[Dict[str, Any]] = []
    for line in out.splitlines():
        if not line.startswith("│"):
            continue
        cells = [c.strip() for c in line.strip().strip("│").split("│")]
        if len(cells) < 5:
            continue
        name, category, source, trust, status = cells[:5]
        if name:
            skills.append({"name": name, "category": category, "source": source, "trust": trust,
                           "enabled": status.lower().startswith("enabled")})
        elif skills and status:  # wrapped status note belongs to the previous row
            skills[-1]["note"] = (skills[-1].get("note", "") + " " + status).strip()
    return skills


async def list_toolsets() -> List[Dict[str, Any]]:
    out = await run_cli("tools", "list")
    sets = []
    for m in re.finditer(r"^\s*[✓✗]\s+(enabled|disabled)\s+(\S+)\s+(.*)$", out, re.MULTILINE):
        sets.append({"name": m.group(2), "enabled": m.group(1) == "enabled", "label": m.group(3).strip()})
    return sets


async def tools_info() -> Dict[str, Any]:
    try:
        hermes = await list_toolsets()
    except Exception as exc:  # noqa: BLE001
        log.warning("toolset listing failed: %s", exc)
        hermes = []
    office = [{"name": n, **spec} for n, spec in TOOLS.items()]
    return {"office": office, "hermes": hermes}


# --------------------------------------------------------------------------- user style profile

STYLE_PROFILE_MAX_BYTES = 32_000


def style_profile_path() -> Path:
    return hermes_home() / "office_user_style.json"


def load_style_profile() -> Dict[str, Any]:
    try:
        data = json.loads(style_profile_path().read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _deep_merge(base: Dict[str, Any], new: Dict[str, Any]) -> Dict[str, Any]:
    for k, v in new.items():
        if v is None:
            base.pop(k, None)  # null removes a key
        elif isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v
    return base


def save_style_profile(update: Dict[str, Any], replace: bool = False) -> Dict[str, Any]:
    if not isinstance(update, dict):
        raise ValueError("profile must be a JSON object")
    profile = {} if replace else load_style_profile()
    _deep_merge(profile, update)
    profile["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    raw = json.dumps(profile, ensure_ascii=False, indent=2)
    if len(raw.encode("utf-8")) > STYLE_PROFILE_MAX_BYTES:
        raise ValueError("style profile too large; keep only the most representative conventions")
    path = style_profile_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(raw, encoding="utf-8")
    os.replace(tmp, path)
    return profile


STYLE_INSTRUCTIONS = """User style learning (skill: office-user-style):
- The saved style profile below holds this user's formatting habits per app (font, size, spacing, alignment,
  table/header fills, number formats, formula patterns, slide palette). When creating or editing content, match it
  unless the user asks otherwise; if you deviate, say why in one line.
- When the document is unfamiliar or the profile is empty for this app, inspect it first with the get_styles /
  get_format / get_theme tool, then propose the style you detected and offer to apply it.
- When the user states a preference ("always use ...") or repeatedly corrects formatting, record it with
  office_style_save_profile (partial object, merged; null deletes a key). Never store document content, only style.
- Prefer office_*_apply_format / set_format / format_shape to restyle; keep proposals short and ask before restyling
  existing content wholesale."""


def style_prompt_section(host: str) -> str:
    profile = load_style_profile()
    if profile:
        shown = {k: v for k, v in profile.items() if k in (host, "common", "updated_at")} if host in ("word", "excel", "powerpoint") else profile
        body = json.dumps(shown, ensure_ascii=False, indent=2) if shown else "{}"
    else:
        body = "(empty: no habits learned yet)"
    return f"{STYLE_INSTRUCTIONS}\n\nSaved style profile ({style_profile_path()}):\n{body}\n"


# --------------------------------------------------------------------------- designer tools

MOODS: Dict[str, Dict[str, float]] = {
    "balanced": {"hue": 215.0, "sat": 0.55, "accentShift": 35.0, "accentSat": 0.65, "textL": 0.14},
    "vibrant": {"hue": 268.0, "sat": 0.80, "accentShift": 55.0, "accentSat": 0.90, "textL": 0.12},
    "pastel": {"hue": 200.0, "sat": 0.45, "accentShift": 40.0, "accentSat": 0.55, "textL": 0.24},
    "muted": {"hue": 212.0, "sat": 0.22, "accentShift": 30.0, "accentSat": 0.30, "textL": 0.18},
    "warm": {"hue": 28.0, "sat": 0.65, "accentShift": 30.0, "accentSat": 0.75, "textL": 0.16},
    "cool": {"hue": 205.0, "sat": 0.60, "accentShift": -40.0, "accentSat": 0.70, "textL": 0.13},
    "mono": {"hue": 220.0, "sat": 0.06, "accentShift": 0.0, "accentSat": 0.10, "textL": 0.12},
    "high-contrast": {"hue": 0.0, "sat": 0.90, "accentShift": 180.0, "accentSat": 0.90, "textL": 0.06},
}

PALETTE_ROLES = {
    "primary": "headings, links, key numbers, header fills",
    "accent": "callouts, chart series, highlights",
    "background": "page or slide background",
    "surface": "table bands, cards, alternating rows",
    "text": "body copy",
    "muted": "captions and secondary labels",
    "border": "table grid and dividers",
}

_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$")


def hex_to_hsl(color: str) -> tuple[float, float, float]:
    m = _HEX_RE.match(str(color).strip())
    if not m:
        raise ValueError(f"expected a #RRGGBB color, got {color!r}")
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    hi, lo = max(r, g, b), min(r, g, b)
    lightness = (hi + lo) / 2
    if hi == lo:
        return 0.0, 0.0, lightness
    d = hi - lo
    sat = d / (2 - hi - lo) if lightness > 0.5 else d / (hi + lo)
    if hi == r:
        hue = ((g - b) / d) % 6
    elif hi == g:
        hue = (b - r) / d + 2
    else:
        hue = (r - g) / d + 4
    return hue * 60, sat, lightness


def hsl_to_hex(hue: float, sat: float, lightness: float) -> str:
    r, g, b = colorsys.hls_to_rgb((hue % 360) / 360, min(max(lightness, 0.0), 1.0), min(max(sat, 0.0), 1.0))
    return "#{:02X}{:02X}{:02X}".format(*(round(c * 255) for c in (r, g, b)))


def _luminance(color: str) -> float:
    r, g, b = (int(color[i : i + 2], 16) / 255 for i in (1, 3, 5))

    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(fg: str, bg: str) -> Dict[str, Any]:
    """WCAG contrast of `fg` over `bg`; aa needs 4.5, aaa needs 7.0, large text needs 3.0."""
    la, lb = _luminance(fg), _luminance(bg)
    ratio = round((max(la, lb) + 0.05) / (min(la, lb) + 0.05), 2)
    return {"ratio": ratio, "aa": ratio >= 4.5, "aaa": ratio >= 7.0, "aaLarge": ratio >= 3.0}


def build_palette(seed: Optional[str], mood: str, dark: bool) -> Dict[str, Any]:
    key = str(mood or "balanced").strip().lower()
    if key not in MOODS:
        raise ValueError(f"unknown mood {mood!r}; use one of {', '.join(MOODS)}")
    m = MOODS[key]
    hue, sat = m["hue"], m["sat"]
    if seed:
        hue, seed_sat, _ = hex_to_hsl(seed)
        sat = max(sat, min(seed_sat, 0.9))
    colors = {
        "primary": hsl_to_hex(hue, sat, 0.58 if dark else 0.42),
        "accent": hsl_to_hex(hue + m["accentShift"], m["accentSat"], 0.62 if dark else 0.50),
        "background": hsl_to_hex(hue, min(sat, 0.10), 0.09 if dark else 0.98),
        "surface": hsl_to_hex(hue, min(sat, 0.08), 0.15 if dark else 0.94),
        "text": hsl_to_hex(hue, min(sat, 0.25), 0.94 if dark else m["textL"]),
        "muted": hsl_to_hex(hue, min(sat, 0.15), 0.68 if dark else 0.45),
        "border": hsl_to_hex(hue, min(sat, 0.18), 0.30 if dark else 0.82),
    }
    return {
        "mood": key,
        "dark": dark,
        "seed": seed or None,
        "colors": colors,
        "roles": PALETTE_ROLES,
        "contrast": {
            "textOnBackground": contrast(colors["text"], colors["background"]),
            "textOnSurface": contrast(colors["text"], colors["surface"]),
            "whiteOnPrimary": contrast("#FFFFFF", colors["primary"]),
        },
    }


FONT_PAIRS: List[Dict[str, str]] = [
    {"vibe": "modern", "platform": "any", "heading": "Calibri", "body": "Corbel",
     "note": "Humanist sans on both levels; light and screen-friendly for reports and decks."},
    {"vibe": "modern", "platform": "any", "heading": "Arial Black", "body": "Arial",
     "note": "Punchy poster contrast; use Arial Black only for short headings."},
    {"vibe": "modern", "platform": "windows", "heading": "Segoe UI", "body": "Verdana",
     "note": "Clean UI feel; Verdana keeps body copy readable at small sizes."},
    {"vibe": "classic", "platform": "any", "heading": "Cambria", "body": "Calibri",
     "note": "Serif over sans: the default Office pairing, safe for formal documents."},
    {"vibe": "classic", "platform": "any", "heading": "Palatino Linotype", "body": "Constantia",
     "note": "Book-style serif pairing with generous x-height; good for long reading."},
    {"vibe": "editorial", "platform": "any", "heading": "Georgia", "body": "Verdana",
     "note": "Editorial serif heading with a wide, screen-legible body."},
    {"vibe": "editorial", "platform": "any", "heading": "Garamond", "body": "Calibri",
     "note": "Traditional typeface heading, modern body; set Garamond a few points larger."},
    {"vibe": "technical", "platform": "any", "heading": "Rockwell", "body": "Corbel",
     "note": "Slab-serif heading reads engineered; pair with a neutral body."},
    {"vibe": "technical", "platform": "any", "heading": "Tahoma", "body": "Verdana",
     "note": "Compact neutral sans for specs, tables and data-dense pages."},
    {"vibe": "technical", "platform": "windows", "heading": "Consolas", "body": "Segoe UI",
     "note": "Monospace heading for code or spec documents."},
    {"vibe": "friendly", "platform": "any", "heading": "Trebuchet MS", "body": "Verdana",
     "note": "Slightly informal heading with a very legible body."},
    {"vibe": "friendly", "platform": "any", "heading": "Century Gothic", "body": "Trebuchet MS",
     "note": "Geometric, open heading; keep body size up because Century Gothic runs small."},
    {"vibe": "friendly", "platform": "mac", "heading": "Avenir Next", "body": "Georgia",
     "note": "macOS-only geometric sans heading over a warm serif body."},
    {"vibe": "editorial", "platform": "mac", "heading": "Helvetica Neue", "body": "Georgia",
     "note": "macOS-only neutral grotesque heading over an editorial serif body."},
]

VIBES = sorted({p["vibe"] for p in FONT_PAIRS})
PLATFORMS = ("any", "mac", "windows")


def font_pairs(vibe: Optional[str], platform: str) -> Dict[str, Any]:
    plat = str(platform or "any").strip().lower()
    if plat not in PLATFORMS:
        raise ValueError(f"unknown platform {platform!r}; use one of {', '.join(PLATFORMS)}")
    wanted = str(vibe or "").strip().lower()
    if wanted and wanted not in VIBES:
        raise ValueError(f"unknown vibe {vibe!r}; use one of {', '.join(VIBES)}")
    found = [
        p
        for p in FONT_PAIRS
        if (not wanted or p["vibe"] == wanted)
        and (p["platform"] == "any" or (plat != "any" and p["platform"] == plat))
    ]
    if not found:
        raise ValueError(f"no font pair for vibe={vibe!r} platform={platform!r}")
    return {
        "vibe": wanted or "any",
        "platform": plat,
        "pairs": found,
        "applyWith": "office_word_apply_format / office_excel_set_format / office_ppt_apply_format",
    }


# --------------------------------------------------------------------------- sessions / RPC


def route_model(sess: "Session", fast: bool = False) -> Dict[str, Optional[str]]:
    """An explicit UI selection wins; otherwise core for chat and fast for interactive inline edits."""
    if sess.model:
        return {"model": sess.model, "provider": sess.provider}
    if fast and FAST_MODEL:
        return {"model": FAST_MODEL, "provider": fast_provider()}
    return {"model": CORE_MODEL, "provider": CORE_PROVIDER}


class Session:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.id = uuid.uuid4().hex[:8]
        self.history: List[Dict[str, str]] = []
        self.pending: Dict[str, "asyncio.Future[Any]"] = {}
        self.tasks: Dict[str, "asyncio.Task[None]"] = {}
        self.send_lock = asyncio.Lock()
        self.model: Optional[str] = None
        self.provider: Optional[str] = None
        self.skills: List[str] = []
        self.reasoning: Optional[str] = None  # None = Hermes default (agent.reasoning_effort)
        self.rules: str = ""

    async def send(self, msg: Dict[str, Any]) -> None:
        async with self.send_lock:
            await self.ws.send_text(json.dumps(msg, ensure_ascii=False))

    async def rpc(self, tool: str, args: Dict[str, Any]) -> Any:
        if tool not in TOOLS:
            raise ValueError(f"unknown tool: {tool}")
        if tool == "office_style_get_profile":
            return load_style_profile()
        if tool == "office_style_save_profile":
            return save_style_profile(args.get("profile") or {})
        if tool == "office_design_palette":
            return build_palette(args.get("seed"), str(args.get("mood") or "balanced"), bool(args.get("dark")))
        if tool == "office_design_font_pair":
            return font_pairs(args.get("vibe"), str(args.get("platform") or "any"))
        rid = uuid.uuid4().hex
        fut: "asyncio.Future[Any]" = asyncio.get_running_loop().create_future()
        self.pending[rid] = fut
        try:
            await self.send({"type": "rpc_request", "id": rid, "tool": tool, "args": args})
            return await asyncio.wait_for(fut, timeout=RPC_TIMEOUT)
        finally:
            self.pending.pop(rid, None)

    def resolve(self, msg: Dict[str, Any]) -> None:
        fut = self.pending.get(msg.get("id", ""))
        if not fut or fut.done():
            return
        if msg.get("error"):
            fut.set_exception(RuntimeError(str(msg["error"])))
        else:
            fut.set_result(msg.get("result"))

    def close(self) -> None:
        for t in self.tasks.values():
            t.cancel()
        for f in self.pending.values():
            if not f.done():
                f.cancel()


sessions: Dict[str, Session] = {}


async def handle_chat(sess: Session, msg: Dict[str, Any]) -> None:
    cid = msg.get("id") or uuid.uuid4().hex
    host = msg.get("host", "")
    sess.history.append({"role": "user", "content": str(msg.get("text", ""))})
    context = msg.get("context")
    try:
        for _ in range(MAX_TOOL_ROUNDS):
            async def on_chunk(t: str) -> None:
                await sess.send({"type": "delta", "id": cid, "text": t})

            reply = await run_hermes(
                build_prompt(host, sess.history, context, sess.rules), on_chunk,
                skills=sess.skills, reasoning=sess.reasoning, **route_model(sess),
            )
            sess.history.append({"role": "assistant", "content": reply})
            blocks = TOOL_BLOCK_RE.findall(reply)
            if not blocks:
                break
            results = []
            for raw in blocks:
                try:
                    call = json.loads(raw)
                    tool, args = call["tool"], call.get("args") or {}
                except (ValueError, KeyError, TypeError) as exc:
                    results.append({"error": f"invalid tool block: {exc}"})
                    continue
                await sess.send({"type": "tool_call", "id": cid, "tool": tool, "args": args})
                try:
                    res = await sess.rpc(tool, args)
                    results.append({"tool": tool, "result": res})
                    await sess.send({"type": "tool_result", "id": cid, "tool": tool, "ok": True, "result": res})
                except Exception as exc:  # noqa: BLE001
                    results.append({"tool": tool, "error": str(exc)})
                    await sess.send({"type": "tool_result", "id": cid, "tool": tool, "ok": False, "result": str(exc)})
            sess.history.append({"role": "tool", "content": json.dumps(results, ensure_ascii=False)})
            await sess.send({"type": "delta", "id": cid, "text": "\n"})
        await sess.send({"type": "done", "id": cid})
    except asyncio.CancelledError:
        await sess.send({"type": "done", "id": cid, "cancelled": True})
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("chat failed")
        await sess.send(error_frame(cid, exc))
        await sess.send({"type": "done", "id": cid})
    finally:
        sess.tasks.pop(cid, None)


INLINE_PREAMBLE = """You are an inline editor inside Microsoft {app}. Apply the instruction to the TARGET text.
Reply with ONLY the new text that should replace TARGET: no explanations, no code fences, no quotes,
and do not use any tools. Keep the same language and formatting conventions unless told otherwise.
For Excel cells, keep tab-separated columns and newline-separated rows.
In Word, write math/physics/chemistry as LaTeX ($...$ inline, $$...$$ display, \\ce{{...}} for chemistry
inside $...$); they are converted into native Word Equations when applied."""


async def handle_inline(sess: Session, msg: Dict[str, Any]) -> None:
    cid = msg.get("id") or uuid.uuid4().hex
    app = {"word": "Word", "excel": "Excel", "powerpoint": "PowerPoint"}.get(msg.get("host", ""), "Office")
    prompt = (
        INLINE_PREAMBLE.format(app=app)
        + f"\n\nUser style profile (match these habits where they apply to plain text): {json.dumps(load_style_profile().get(msg.get('host', ''), {}), ensure_ascii=False)}"
        + f"\n\nINSTRUCTION:\n{msg.get('text', '')}\n\nTARGET:\n{msg.get('target', '')}\n\nREPLACEMENT:"
    )

    async def on_chunk(t: str) -> None:
        await sess.send({"type": "delta", "id": cid, "text": t})

    try:
        await run_hermes(prompt, on_chunk, skills=sess.skills, **route_model(sess, fast=True))
        await sess.send({"type": "done", "id": cid})
    except asyncio.CancelledError:
        await sess.send({"type": "done", "id": cid, "cancelled": True})
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("inline edit failed")
        await sess.send(error_frame(cid, exc))
        await sess.send({"type": "done", "id": cid})
    finally:
        sess.tasks.pop(cid, None)


async def handle_run_tool(sess: Session, msg: Dict[str, Any]) -> None:
    cid, tool = msg.get("id") or uuid.uuid4().hex, str(msg.get("tool", ""))
    try:
        res = await sess.rpc(tool, msg.get("args") or {})
        await sess.send({"type": "tool_result", "id": cid, "tool": tool, "ok": True, "result": res, "direct": True})
    except Exception as exc:  # noqa: BLE001
        await sess.send({"type": "tool_result", "id": cid, "tool": tool, "ok": False, "result": str(exc) or type(exc).__name__, "direct": True})
    finally:
        sess.tasks.pop(cid, None)


async def handle_run_toolset(sess: Session, msg: Dict[str, Any]) -> None:
    cid = msg.get("id") or uuid.uuid4().hex
    toolset = str(msg.get("toolset", ""))

    async def on_chunk(t: str) -> None:
        await sess.send({"type": "delta", "id": cid, "text": t})

    try:
        if not NAME_RE.match(toolset):
            raise ValueError(f"invalid toolset: {toolset!r}")
        await run_hermes(str(msg.get("text", "")), on_chunk, skills=sess.skills, toolsets=toolset, reasoning=sess.reasoning,
                         **route_model(sess))
        await sess.send({"type": "done", "id": cid})
    except asyncio.CancelledError:
        await sess.send({"type": "done", "id": cid, "cancelled": True})
        raise
    except Exception as exc:  # noqa: BLE001
        await sess.send(error_frame(cid, exc))
        await sess.send({"type": "done", "id": cid})
    finally:
        sess.tasks.pop(cid, None)


# --------------------------------------------------------------------------- app

app = FastAPI(title="hermes-office-bridge")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {"ok": True, "sessions": len(sessions)}


@app.get("/status")
async def status() -> Dict[str, Any]:
    return {"hermes": await hermes_status(), "tools": list(TOOLS)}


@app.get("/auth/status")
async def auth_status_route() -> Dict[str, Any]:
    return await auth_info()


@app.post("/auth/google")
async def auth_google_route() -> Dict[str, Any]:
    """Start the Google (Antigravity) OAuth flow; progress and the sign-in URL arrive over /ws."""
    global login_task
    if not find_hermes():
        raise HTTPException(409, "Hermes CLI not found")
    if not (login_task and not login_task.done()):
        login_task = asyncio.create_task(_login())
    return {"started": True}


@app.get("/tools")
async def tools() -> Dict[str, Any]:
    return TOOLS


@app.get("/models")
async def models() -> Dict[str, Any]:
    return list_models()


@app.get("/skills")
async def skills() -> Dict[str, Any]:
    try:
        return {"skills": await list_skills()}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, str(exc))


@app.get("/skills/{name}")
async def skill_detail_route(name: str) -> Dict[str, Any]:
    detail = await asyncio.get_running_loop().run_in_executor(None, skill_detail, name)
    if not detail:
        raise HTTPException(404, f"skill not found: {name}")
    return detail


@app.get("/hermes-tools")
async def hermes_tools() -> Dict[str, Any]:
    return await tools_info()


@app.get("/style-profile")
async def get_style_profile() -> Dict[str, Any]:
    return {"path": str(style_profile_path()), "profile": load_style_profile()}


@app.put("/style-profile")
async def put_style_profile(body: Dict[str, Any], replace: bool = False) -> Dict[str, Any]:
    """Deep-merge `body` into the saved profile (or replace it with ?replace=true)."""
    try:
        return {"profile": save_style_profile(body, replace=replace)}
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/rpc/{tool}")
async def http_rpc(tool: str, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Call an Office tool on the most recently connected taskpane (handy for scripts/MCP)."""
    if tool not in TOOLS:
        raise HTTPException(404, f"unknown tool: {tool}")
    if not sessions:
        raise HTTPException(503, "no Office taskpane connected")
    sess = list(sessions.values())[-1]
    try:
        return {"result": await sess.rpc(tool, args or {})}
    except asyncio.TimeoutError:
        raise HTTPException(504, "taskpane did not answer in time")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc))


LOCAL_ORIGIN_RE = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")
COMPOSE_MAX = 20000


def open_in_browser(url: str) -> None:
    """Open `url` in the user's default browser (works from a LaunchAgent / systemd user unit / Windows task)."""
    import subprocess
    if sys.platform == "darwin":
        cmd = ["open", url]
    elif sys.platform.startswith("win"):
        cmd = ["cmd", "/c", "start", "", url]
    else:
        cmd = ["xdg-open", url]
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@app.post("/compose")
async def compose_route(request: Request) -> Dict[str, Any]:
    """Text typed in the browser compose page (where the OS input method works) -> every open task pane."""
    origin = request.headers.get("origin")
    if origin and not LOCAL_ORIGIN_RE.match(origin):
        raise HTTPException(403, "local pages only")
    body = await request.json()
    text = str(body.get("text", ""))[:COMPOSE_MAX]
    target = "inline" if body.get("target") == "inline" else "chat"
    if not text.strip():
        raise HTTPException(400, "empty text")
    await broadcast({"type": "compose", "target": target, "text": text})
    return {"ok": True, "delivered": len(sessions)}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    origin = ws.headers.get("origin")
    if origin and not re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin):
        await ws.close(code=1008)  # only local pages may drive login/install
        return
    await ws.accept()
    sess = Session(ws)
    sessions[sess.id] = sess
    try:
        await sess.send({"type": "status", "hermes": await hermes_status(), "tools": list(TOOLS)})
        while True:
            msg = json.loads(await ws.receive_text())
            kind = msg.get("type")
            if kind == "status":
                await sess.send({"type": "status", "hermes": await hermes_status(), "tools": list(TOOLS)})
            elif kind == "chat":
                cid = msg.setdefault("id", uuid.uuid4().hex)
                sess.tasks[cid] = asyncio.create_task(handle_chat(sess, msg))
            elif kind == "cancel":
                t = sess.tasks.get(msg.get("id", ""))
                if t:
                    t.cancel()
            elif kind == "auth_status":
                await sess.send({"type": "auth_status", **await auth_info()})
            elif kind == "auth_google":
                global login_task
                if not find_hermes():
                    await sess.send({"type": "error", "message": "Hermes CLI not found", "code": "hermes_not_found"})
                elif not (login_task and not login_task.done()):
                    login_task = asyncio.create_task(_login())
            elif kind == "auth_cancel":
                if login_task and not login_task.done():
                    login_task.cancel()
            elif kind == "auth_logout":
                try:
                    await run_cli("auth", "logout", AUTH_PROVIDER, timeout=30)
                except Exception as exc:  # noqa: BLE001
                    await sess.send({"type": "error", "message": str(exc)})
                await broadcast({"type": "auth_status", **await auth_info()})
            elif kind == "setup_install":
                global install_task
                target = msg.get("target")
                if target in ("hermes", "agy") and not (install_task and not install_task.done()):
                    install_task = asyncio.create_task(_install(target))
                elif target == "plugin" and not (install_task and not install_task.done()):
                    install_task = asyncio.create_task(_enable_plugin())
            elif kind == "open_compose":
                tgt = "inline" if msg.get("target") == "inline" else "chat"
                lang = "en" if msg.get("lang") == "en" else "vi"
                host_hdr = ws.headers.get("host") or f"localhost:{DEFAULT_PORT}"
                scheme = "https" if ws.url.scheme == "wss" else "http"
                try:
                    open_in_browser(f"{scheme}://{host_hdr}/compose.html?target={tgt}&lang={lang}")
                except Exception as exc:  # noqa: BLE001
                    await sess.send({"type": "error", "message": f"cannot open browser: {exc}"})
            elif kind == "list_models":
                await sess.send({"type": "models", **list_models(), "selected": {"model": sess.model, "provider": sess.provider}})
            elif kind == "set_model":
                model, provider = msg.get("model") or None, msg.get("provider") or None
                if (model and not NAME_RE.match(model)) or (provider and not NAME_RE.match(provider)):
                    await sess.send({"type": "error", "message": "invalid model or provider", "code": "invalid_model"})
                else:
                    sess.model, sess.provider = model, provider
                    await sess.send({"type": "models", **list_models(), "selected": {"model": model, "provider": provider}})
            elif kind == "list_skills":
                try:
                    await sess.send({"type": "skills", "skills": await list_skills(), "active": sess.skills})
                except Exception as exc:  # noqa: BLE001
                    await sess.send({"type": "error", "message": f"skills: {exc}"})
            elif kind == "get_skill":
                sname = str(msg.get("name", ""))
                detail = await asyncio.get_running_loop().run_in_executor(None, skill_detail, sname)
                if detail:
                    await sess.send({"type": "skill_detail", "skill": detail})
                else:
                    await sess.send({"type": "skill_detail", "name": sname, "skill": None})
            elif kind == "set_skills":
                names = [str(n) for n in (msg.get("skills") or [])]
                if all(NAME_RE.match(n) for n in names):
                    sess.skills = names
                    await sess.send({"type": "skills_active", "active": names})
                else:
                    await sess.send({"type": "error", "message": "invalid skill name", "code": "invalid_skill"})
            elif kind == "set_reasoning":
                lvl = msg.get("level") or None
                if lvl is not None and lvl not in REASONING_LEVELS:
                    await sess.send({"type": "error", "message": f"invalid reasoning level: {lvl}"})
                else:
                    sess.reasoning = lvl
                    await sess.send({"type": "reasoning", "level": lvl, "levels": list(REASONING_LEVELS)})
            elif kind == "set_rules":
                sess.rules = str(msg.get("rules") or "")[:RULES_MAX]
            elif kind == "create_skill":
                try:
                    path = create_skill(str(msg.get("name", "")).strip(), str(msg.get("description", "")), str(msg.get("body", "")))
                    await sess.send({"type": "skill_created", "ok": True, "name": str(msg.get("name", "")).strip(), "path": str(path)})
                    await sess.send({"type": "skills", "skills": await list_skills(), "active": sess.skills})
                except Exception as exc:  # noqa: BLE001
                    await sess.send({"type": "skill_created", "ok": False, "name": str(msg.get("name", "")), "message": str(exc)})
            elif kind == "list_tools":
                await sess.send({"type": "tools_info", **await tools_info()})
            elif kind in ("inline", "run_tool", "run_toolset"):
                cid = msg.setdefault("id", uuid.uuid4().hex)
                fn = {"inline": handle_inline, "run_tool": handle_run_tool, "run_toolset": handle_run_toolset}[kind]
                sess.tasks[cid] = asyncio.create_task(fn(sess, msg))
            elif kind == "restore_history":
                if not sess.history:
                    for m in (msg.get("messages") or [])[-200:]:
                        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str):
                            sess.history.append({"role": m["role"], "content": m["content"]})
            elif kind == "reset":
                sess.history.clear()
            elif kind == "rpc_result":
                sess.resolve(msg)
            elif kind == "ping":
                await sess.send({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.exception("websocket error")
    finally:
        sess.close()
        sessions.pop(sess.id, None)


# Static add-in frontend (addin/dist). Registered last so API routes and /ws win.
# Plain route instead of StaticFiles mount: StaticFiles does not handle the websocket scope
# cleanly alongside /ws and we want an SPA fallback to index.html anyway.
@app.get("/", include_in_schema=False)
@app.get("/{path:path}", include_in_schema=False)
async def static_files(path: str = "") -> FileResponse:
    root = DIST_DIR.resolve()
    if not (root / "index.html").is_file():
        raise HTTPException(404, f"add-in not built: {root}/index.html missing (run: cd addin && npm run build)")
    target = (root / (path or "index.html")).resolve()
    if root not in target.parents and target != root:
        raise HTTPException(404)
    nocache = {"Cache-Control": "no-cache, must-revalidate"}  # Office WebViews cache hard; always revalidate so fixes show up
    if target.is_file():
        return FileResponse(target, headers=nocache)
    if "." in Path(path).name:  # missing asset: real 404, not the SPA shell
        raise HTTPException(404)
    return FileResponse(root / "index.html", headers=nocache)


def main() -> None:
    import uvicorn

    p = argparse.ArgumentParser(description="Hermes Office bridge daemon")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--cert", default=str(CERT_DIR / "localhost.crt"))
    p.add_argument("--key", default=str(CERT_DIR / "localhost.key"))
    p.add_argument("--no-tls", action="store_true", help="serve plain ws:// even if certs exist")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    use_tls = not args.no_tls and os.path.isfile(args.cert) and os.path.isfile(args.key)
    scheme = "wss" if use_tls else "ws"
    log.info("listening on %s://%s:%d/ws", scheme, args.host, args.port)
    if not use_tls:
        log.warning("no TLS certs at %s; Office's https taskpane may block ws://. Run ./install.sh", CERT_DIR)
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        ssl_certfile=args.cert if use_tls else None,
        ssl_keyfile=args.key if use_tls else None,
        log_level="info",
    )


if __name__ == "__main__":
    sys.exit(main())
