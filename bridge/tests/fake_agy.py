#!/usr/bin/env python3
"""Fake `agy` that reproduces the real CLI's output shapes (captured from agy --help / models / stream-json)."""
import json, os, sys

args = sys.argv[1:]
mode = os.environ.get("FAKE_MODE", "")
log = os.environ.get("FAKE_LOG")
if log:
    with open(log, "a", encoding="utf-8") as f:
        f.write(json.dumps({"argv": args, "has_key": bool(os.environ.get("GEMINI_API_KEY")), "cwd": os.getcwd()}) + "\n")

HELP = """Usage of agy:
  --conversation                  Resume a previous conversation by ID
  --model                         Model for the current CLI session
  --dangerously-skip-permissions  Auto-approve all tool permission requests without prompting
  --output-format                 Output format for print mode (text, json, stream-json) (default text)
  --print-timeout                 Optional time limit for print mode
  -p                              Short alias for --print
  --sandbox                       Run in a sandbox with terminal restrictions enabled
"""
if args[:1] == ["--version"]:
    print("flag provided but not defined: -version\n" + HELP, file=sys.stderr); sys.exit(2)
if args[:1] == ["--help"]:
    print(HELP); sys.exit(0)
if args[:1] == ["models"]:
    print("gemini-3.8-flash-high     Gemini 3.8 Flash (High)\ngemini-3.8-flash-medium   Gemini 3.8 Flash (Medium)\n"
          "gemini-3.8-flash-low      Gemini 3.8 Flash (Low)\nclaude-sonnet-4-6         Claude Sonnet 4.6 (Thinking)\n"
          "claude-opus-4-6-thinking  Claude Opus 4.6 (Thinking)\ngpt-oss-120b-medium       GPT-OSS 120B (Medium)")
    sys.exit(0)

def opt(name):
    return args[args.index(name) + 1] if name in args else None

if mode == "noptimeout" and "--print-timeout" in args:
    print("flag provided but not defined: -print-timeout", file=sys.stderr); sys.exit(2)
conv = opt("--conversation")
if mode == "badconv" and conv:
    print("Error: conversation not found: " + conv, file=sys.stderr); sys.exit(1)
if mode == "badmodel":
    print("Error: unknown model '" + str(opt("--model")) + "'", file=sys.stderr); sys.exit(1)
if mode == "auth":
    print("Error: not logged in. Please run agy to sign in.", file=sys.stderr); sys.exit(1)
prompt = opt("-p")
if mode == "plain" or opt("--output-format") != "stream-json":
    print("Chào (text)"); sys.exit(0)
cid = conv or "cd48b78d-8c62-4d33-be59-76d0b7fcf132"
print(json.dumps({"event": "init", "conversation_id": cid, "init": {"cwd": os.getcwd(), "tools": ["run_command"], "permission_mode": "request-review"}}))
print(json.dumps({"event": "step_update", "step_update": {"conversation_id": cid, "step_index": 0, "state": "DONE", "step_type": "user_input"}}))
print(json.dumps({"event": "step_update", "step_update": {"conversation_id": cid, "step_index": 1, "state": "ACTIVE", "step_type": "agent_response", "text_delta": "Chào"}}))
print(json.dumps({"event": "step_update", "step_update": {"conversation_id": cid, "step_index": 1, "state": "DONE", "step_type": "agent_response", "text_delta": "\n"}}))
print(json.dumps({"event": "result", "result": {"conversation_id": cid, "status": "SUCCESS", "response": "Chào\n", "num_turns": 1}}))
