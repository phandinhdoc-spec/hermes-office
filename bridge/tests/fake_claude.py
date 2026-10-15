#!/usr/bin/env python3
"""Fake `claude` (Claude Code 2.1.300 shapes, captured from a real stream-json --verbose run)."""
import json, os, sys

args = sys.argv[1:]
mode = os.environ.get("FAKE_MODE", "")
stdin = "" if sys.stdin.isatty() or args[:1] in (["--version"], ["--help"]) else sys.stdin.read()
log = os.environ.get("FAKE_LOG")
if log:
    with open(log, "a", encoding="utf-8") as f:
        f.write(json.dumps({"argv": args, "stdin": stdin, "has_key": bool(os.environ.get("ANTHROPIC_API_KEY"))}) + "\n")

HELP = """Usage: claude [options] [command] [prompt]
Options:
  -p, --print                        Print response and exit
  --output-format <format>           Output format (text, json, stream-json)
  --verbose                          Override verbose mode setting
  --include-partial-messages         Include partial message chunks
  --model <model>                    Model alias or full name
  -r, --resume [value]               Resume a conversation
  --strict-mcp-config                Only use MCP servers from --mcp-config
  --disable-slash-commands           Disable all skills
  --tools <tools...>                 Specify the list of available tools
"""
if args[:1] == ["--version"]:
    print("2.1.300 (Claude Code)"); sys.exit(0)
if args[:1] == ["--help"]:
    print(HELP); sys.exit(0)

def opt(name):
    return args[args.index(name) + 1] if name in args else None

if "--tools" in args and mode == "notools":
    print("error: unknown option '--tools'", file=sys.stderr); sys.exit(1)
if mode == "badmodel":
    print("There's an issue with the selected model (" + str(opt("--model")) + "). It may not exist or you may not have access to it.", file=sys.stderr); sys.exit(1)
if mode == "auth":
    print("Invalid API key · Please run /login", file=sys.stderr); sys.exit(1)
if opt("--output-format") != "stream-json":
    print("Xin chào! (text)"); sys.exit(0)
if "--verbose" not in args:
    print("Error: When using --print, --output-format=stream-json requires --verbose", file=sys.stderr); sys.exit(1)
sid = opt("--resume") or "ba98ac7e-1ffd-4b78-81de-530b9eb326fa"
reply = "Xin chào!"
script = os.environ.get("FAKE_REPLIES")
if script:
    idx_file = script + ".idx"
    i = int(open(idx_file).read()) if os.path.exists(idx_file) else 0
    replies = json.load(open(script, encoding="utf-8"))
    reply = replies[min(i, len(replies) - 1)]
    open(idx_file, "w").write(str(i + 1))
print(json.dumps({"type": "system", "subtype": "init", "cwd": os.getcwd(), "session_id": sid, "tools": [], "model": "claude-sonnet-5-5"}))
if "--include-partial-messages" in args:
    for piece in ((reply,) if script else ("Xin ", "chào!")):
        print(json.dumps({"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": piece}}, "session_id": sid}))
print(json.dumps({"type": "assistant", "message": {"model": "claude-sonnet-5-5", "role": "assistant", "content": [{"type": "text", "text": reply}]}, "session_id": sid}))
print(json.dumps({"type": "rate_limit_event", "rate_limit_info": {"status": "allowed"}, "session_id": sid}))
print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": reply, "session_id": sid, "num_turns": 1}))
