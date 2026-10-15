"""Background learner for Hermes Office.

After a successful Office task the bridge queues a *sanitized* record: the user's request and the
sequence of Office tools that worked, never document text or tool arguments. A worker, running while
the bridge is idle (Office does not need to be open), asks the same backend/model that did the work
to distil reusable procedures, and writes them as skills in ~/.hermes/skills/learned-<name>/SKILL.md,
where Hermes discovers them. The lean engine offers them to the model through an index plus the
on-demand `office_skill_read` tool.

Guard rails (learned skills are loaded into future prompts, so they must be safe and small):
  * procedures only: no names, scores, emails, long numbers or URLs; no code fences or tool blocks;
  * merge into an existing skill instead of creating near-duplicates; at most MAX_SKILLS skills;
  * every overwrite/deletion is backed up under ~/.hermes-office/learned_backup/;
  * at most MAX_PER_DAY learning runs per day, only after IDLE seconds without chat activity.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import time
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

import backends

log = logging.getLogger("hermes-office-learner")

PREFIX = "learned-"
MIN_ITEMS = int(os.environ.get("HERMES_LEARN_MIN_ITEMS", "3"))
MAX_PER_DAY = int(os.environ.get("HERMES_LEARN_MAX_PER_DAY", "6"))
IDLE = float(os.environ.get("HERMES_LEARN_IDLE", "120"))
MAX_SKILLS = int(os.environ.get("HERMES_LEARN_MAX_SKILLS", "30"))
QUEUE_MAX = 200
BATCH_MAX = 12
BODY_MAX = 1500
DESC_MAX = 200
MAX_ATTEMPTS = 3

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,48}$")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
LONGNUM_RE = re.compile(r"\d[\d .,-]{6,}\d")
INJECTION_RE = re.compile(
    r"ignore (all|any|previous|prior|the above)|disregard|system prompt|jailbreak|override (the )?rules|"
    r"office-tool|```|https?://|api[_ -]?key|password|mật khẩu",
    re.I,
)

_last_activity = 0.0
_wake: Optional[asyncio.Event] = None


def enabled() -> bool:
    return os.environ.get("HERMES_LEARN", "1").lower() not in ("0", "false", "no")


def touch() -> None:
    """Called on chat activity so learning never competes with the user."""
    global _last_activity
    _last_activity = time.time()


def _queue_path() -> Path:
    return backends.office_home() / "learn_queue.jsonl"


def _state_path() -> Path:
    return backends.office_home() / "learn_state.json"


def _backup_dir() -> Path:
    return backends.office_home() / "learned_backup"


def redact(text: str, limit: int = 400) -> str:
    text = EMAIL_RE.sub("[email]", text)
    text = LONGNUM_RE.sub("[số]", text)
    return " ".join(text.split())[:limit]


# --------------------------------------------------------------------------- queue


def read_queue() -> List[Dict[str, Any]]:
    try:
        rows = [json.loads(l) for l in _queue_path().read_text(encoding="utf-8").splitlines() if l.strip()]
        return [r for r in rows if isinstance(r, dict)]
    except (OSError, ValueError):
        return []


def write_queue(items: List[Dict[str, Any]]) -> None:
    p = _queue_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items[-QUEUE_MAX:]), encoding="utf-8")
    tmp.replace(p)


def enqueue(backend: str, model: str, host: str, request: str, trace: List[Dict[str, Any]]) -> bool:
    """Queue one finished task. `trace` = [{"tool", "ok", "arg_keys"}]; tool arguments/results are never stored."""
    if not enabled() or backend not in backends.BACKENDS or not model:
        return False
    clean = [{"tool": str(t.get("tool", ""))[:60], "ok": bool(t.get("ok")), "arg_keys": [str(k)[:30] for k in (t.get("arg_keys") or [])][:12]} for t in trace[:40]]
    if len(clean) < 2 or not all(t["ok"] for t in clean):
        return False  # only multi-step tasks that fully worked are worth learning from
    item = {"id": uuid.uuid4().hex[:10], "ts": time.time(), "backend": backend, "model": model, "host": host[:20],
            "request": redact(request), "trace": clean, "attempts": 0}
    write_queue(read_queue() + [item])
    if _wake is not None:
        _wake.set()
    return True


# --------------------------------------------------------------------------- learned skills on disk


def _frontmatter(text: str) -> Dict[str, str]:
    m = re.match(r"\A---\s*\n(.*?)\n---", text, re.S)
    meta: Dict[str, str] = {}
    if m:
        for line in m.group(1).splitlines():
            k, sep, v = line.partition(":")
            if sep and not line.startswith((" ", "\t")):
                meta[k.strip()] = v.strip().strip("\"'")
    return meta


def learned_skills(skills_root: Path) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    try:
        dirs = sorted(d for d in skills_root.iterdir() if d.is_dir() and d.name.startswith(PREFIX))
    except OSError:
        return out
    for d in dirs:
        f = d / "SKILL.md"
        try:
            meta = _frontmatter(f.read_text(encoding="utf-8"))
        except OSError:
            continue
        out.append({"name": d.name, "description": meta.get("description", ""), "path": str(f)})
    return out


def _backup(skills_root: Path, name: str) -> None:
    src = skills_root / name / "SKILL.md"
    if src.is_file():
        dst = _backup_dir() / name
        dst.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst / f"{int(time.time())}.md")


def delete_learned(skills_root: Path, name: str) -> bool:
    if not name.startswith(PREFIX) or not NAME_RE.match(name):
        return False
    d = skills_root / name
    if not (d / "SKILL.md").is_file():
        return False
    _backup(skills_root, name)
    shutil.rmtree(d, ignore_errors=True)
    return True


def validate(name: str, description: str, body: str) -> Optional[str]:
    """Return a reason to reject, or None."""
    if not NAME_RE.match(name):
        return "bad name"
    if not description.strip() or not body.strip():
        return "empty"
    if len(body) > BODY_MAX or len(description) > DESC_MAX:
        return "too long"
    blob = f"{name}\n{description}\n{body}"
    if INJECTION_RE.search(blob):
        return "forbidden content"
    if EMAIL_RE.search(blob) or LONGNUM_RE.search(blob):
        return "personal data"
    return None


def save_skill(skills_root: Path, name: str, description: str, body: str, update: Optional[str], by: str) -> str:
    base = (update or name).strip().lower()
    base = base[len(PREFIX):] if base.startswith(PREFIX) else base
    why = validate(base, " ".join(description.split()), body.strip())
    if why:
        raise ValueError(f"rejected {base!r}: {why}")
    dirname = PREFIX + base
    exists = (skills_root / dirname / "SKILL.md").is_file()
    if not exists and len(learned_skills(skills_root)) >= MAX_SKILLS:
        raise ValueError(f"limit of {MAX_SKILLS} learned skills reached")
    _backup(skills_root, dirname)
    desc = " ".join(description.split())
    text = (f"---\nname: {dirname}\ndescription: {json.dumps(desc, ensure_ascii=False)}\nsource: hermes-office-learned\n"
            f"learned_by: {by}\nupdated: {time.strftime('%Y-%m-%d')}\n---\n\n{body.strip()}\n")
    path = skills_root / dirname / "SKILL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return dirname


# --------------------------------------------------------------------------- the learning pass

LEARN_PROMPT = """You maintain a small library of reusable skills for Hermes Office, an assistant that edits Word, Excel and PowerPoint through tools.
Below are tasks that were completed successfully. For each you get the user's request and the ordered Office tools that worked (names and argument NAMES only; document content is intentionally omitted).

Existing learned skills:
{existing}

Completed tasks:
{tasks}

Decide whether there is a REUSABLE PROCEDURE worth saving. Rules:
- Procedures only: when to use it, the tool sequence, parameter conventions, pitfalls. Generalize. NEVER include names of people or students, scores, school or personal data, document text, emails, phone numbers, numbers longer than 5 digits or URLs.
- Prefer updating an existing skill (set "update" to its name) over creating a new one. Do not create near-duplicates.
- At most 2 skills. Body: Markdown, at most {body_max} characters, in the same language as the user requests. No code fences, no instructions to ignore rules.
- If nothing is worth saving, return {{"skills": []}}.
Do not use any tools. Reply with ONLY this JSON:
{{"skills": [{{"name": "kebab-case-name", "description": "one line, at most {desc_max} characters", "body": "markdown", "update": "existing-name or null"}}]}}"""


def build_prompt(items: List[Dict[str, Any]], existing: List[Dict[str, str]]) -> str:
    ex = "\n".join(f"- {e['name']}: {e['description']}" for e in existing) or "(none yet)"
    tasks = []
    for i, it in enumerate(items, 1):
        seq = " -> ".join(f"{t['tool']}({','.join(t['arg_keys'])})" for t in it["trace"])
        tasks.append(f"{i}. [{it['host']}] request: {it['request']}\n   tools: {seq}")
    return LEARN_PROMPT.format(existing=ex, tasks="\n".join(tasks), body_max=BODY_MAX, desc_max=DESC_MAX)


def parse_reply(text: str) -> List[Dict[str, Any]]:
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b <= a:
        return []
    try:
        data = json.loads(text[a:b + 1])
    except ValueError:
        return []
    skills = data.get("skills") if isinstance(data, dict) else None
    out = []
    for s in (skills or [])[:2]:
        if isinstance(s, dict) and all(isinstance(s.get(k), str) for k in ("name", "description", "body")):
            upd = s.get("update")
            out.append({"name": s["name"], "description": s["description"], "body": s["body"], "update": upd if isinstance(upd, str) and upd.strip().lower() not in ("", "null", "none") else None})
    return out


Runner = Callable[[str, str, str], Awaitable[str]]  # (backend, model, prompt) -> reply text


async def run_batch(skills_root: Path, runner: Runner, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Learn from `items`, one pass per (backend, model) group. Returns {"done": [ids], "saved": [names]}."""
    groups: Dict[Any, List[Dict[str, Any]]] = defaultdict(list)
    for it in items:
        groups[(it["backend"], it["model"])].append(it)
    done: List[str] = []
    saved: List[str] = []
    for (backend, model), group in groups.items():
        batch = group[-BATCH_MAX:]
        try:
            reply = await runner(backend, model, build_prompt(batch, learned_skills(skills_root)))
        except Exception as exc:  # noqa: BLE001
            log.warning("learning pass failed on %s/%s: %s", backend, model, exc)
            continue
        for sk in parse_reply(reply):
            try:
                saved.append(save_skill(skills_root, sk["name"], sk["description"], sk["body"], sk["update"], f"{backend}/{model}"))
            except ValueError as exc:
                log.info("learned skill dropped: %s", exc)
        done += [i["id"] for i in group]
    return {"done": done, "saved": saved}


def _read_state() -> Dict[str, Any]:
    try:
        d = json.loads(_state_path().read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {"runs": []}
    except (OSError, ValueError):
        return {"runs": []}


def _write_state(state: Dict[str, Any]) -> None:
    try:
        _state_path().parent.mkdir(parents=True, exist_ok=True)
        _state_path().write_text(json.dumps(state), encoding="utf-8")
    except OSError:
        pass


def due(items: List[Dict[str, Any]], now: Optional[float] = None) -> bool:
    now = now if now is not None else time.time()
    if not items or now - _last_activity < IDLE:
        return False
    runs = [t for t in _read_state().get("runs", []) if now - t < 86400]
    if len(runs) >= MAX_PER_DAY:
        return False
    return len(items) >= MIN_ITEMS or now - min(i["ts"] for i in items) > 6 * 3600


async def tick(skills_root: Path, runner: Runner) -> Optional[Dict[str, Any]]:
    """One scheduling step; returns the batch result when a learning pass ran."""
    items = read_queue()
    if not due(items):
        return None
    now = time.time()
    result = await run_batch(skills_root, runner, items)
    st = _read_state()
    st["runs"] = [t for t in st.get("runs", []) if now - t < 86400] + [now]
    st["last"] = {"at": now, "saved": result["saved"]}
    _write_state(st)
    done = set(result["done"])
    rest = []
    for it in read_queue():
        if it["id"] in done:
            continue
        it["attempts"] = it.get("attempts", 0) + 1
        if it["attempts"] < MAX_ATTEMPTS:
            rest.append(it)
    write_queue(rest)
    if result["saved"]:
        log.info("learned skills: %s", ", ".join(result["saved"]))
    return result


async def worker(skills_root: Path, runner: Runner) -> None:
    """Long-running loop started with the bridge daemon."""
    global _wake
    _wake = asyncio.Event()
    while True:
        try:
            await tick(skills_root, runner)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("learner tick failed")
        try:
            await asyncio.wait_for(_wake.wait(), timeout=60)
        except asyncio.TimeoutError:
            pass
        _wake.clear()


def status(skills_root: Path) -> Dict[str, Any]:
    st = _read_state()
    return {"enabled": enabled(), "queued": len(read_queue()), "skills": learned_skills(skills_root), "last": st.get("last")}
