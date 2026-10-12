import { useCallback, useEffect, useRef, useState } from "react";
import {
  BridgeClient,
  type BridgeEvent,
  type ConnState,
  type HermesStatus,
  type ModelOption,
  type OfficeToolInfo,
  type SkillDetail,
  type SkillInfo,
  type ToolsetInfo,
} from "../lib/bridge";
import { useI18n, type Key } from "../lib/i18n";
import { currentHost } from "../office/host";
import { applyInlineEdit, getInlineTarget, getSelectionText, replaceSelectionText, type InlineTarget } from "../office/tools";
import { isImeKey, shortcutLabel, useInlineShortcut } from "../hooks/useInlineShortcut";
import InlineEdit, { type InlineState } from "./InlineEdit";
import ModelSelector from "./ModelSelector";
import SkillsDrawer from "./SkillsDrawer";
import ToolsPanel from "./ToolsPanel";
import {
  IconButton, IconChevron, IconCopy, IconEdit, IconInsert, IconSelection, IconSend, IconSkills, IconStop, IconTools, IconTrash, IconX, Pill, StatusDot,
} from "./ui";

/** The CLI's quiet mode appends a `session_id:` footer; never insert that into a document. */
const clean = (t: string) => t.replace(/\s*session_id: \S+\s*$/, "");

const INLINE_IDLE: InlineState = { open: false, scope: "selection", target: "", output: "", busy: false, error: null };
type Sel = { model: string | null; provider: string | null };

interface Msg {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  /** tool steps only */
  tool?: string;
  args?: unknown;
  result?: unknown;
  ok?: boolean;
  pending?: boolean;
}

const CHIPS: { id: "summarize" | "proofread" | "translate" | "table" }[] = [
  { id: "summarize" }, { id: "proofread" }, { id: "translate" }, { id: "table" },
];

const ERR_KEYS: Record<string, Key> = {
  "err.hermes_not_found": "err.hermes_not_found",
  "err.invalid_model": "err.invalid_model",
  "err.invalid_skill": "err.invalid_skill",
};

const HISTORY_KEY = "hermes_office_chat_history";
const HISTORY_MAX = 300;

/** Load saved messages; anything that was mid-generation is settled so no spinner/cursor is restored. */
function loadHistory(): Msg[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((m) => m && typeof m.id === "string" && (m.role === "user" || m.role === "assistant" || m.role === "tool") && typeof m.text === "string")
      .map((m: Msg) => (m.pending ? { ...m, pending: false, ok: false } : m));
  } catch {
    return [];
  }
}

function saveHistory(msgs: Msg[]): void {
  try {
    if (!msgs.length) localStorage.removeItem(HISTORY_KEY);
    else localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-HISTORY_MAX).map((m) => (m.pending ? { ...m, pending: false, ok: false } : m))));
  } catch {
    /* storage unavailable or full in some Office webviews */
  }
}

const short = (v: unknown, n = 600) => (typeof v === "string" ? v : JSON.stringify(v, null, 1) ?? "").slice(0, n);

function ToolStep({ m }: { m: Msg }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const tone = m.pending ? "text-indigo-500" : m.ok ? "text-emerald-500" : "text-red-500";
  return (
    <div className="animate-pop rounded-lg border border-gray-500/20 bg-gray-500/[0.04]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 px-2 py-1 text-left" aria-expanded={open}>
        <IconChevron className={"h-2.5 w-2.5 shrink-0 text-gray-400 transition-transform " + (open ? "rotate-90" : "")} />
        {m.pending ? <StatusDot tone="accent" pulse /> : <span className={"text-[11px] " + tone}>{m.ok ? "✓" : "✗"}</span>}
        <code className="min-w-0 flex-1 truncate text-[11px] text-gray-600 dark:text-gray-300">{m.tool?.replace(/^office_/, "")}</code>
        <span className={"text-[10px] " + (m.pending ? "shimmer-text" : "text-gray-400")}>{m.pending ? t("tool.running") : m.ok ? t("tool.done") : t("tool.failed")}</span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-gray-500/15 px-2 py-1.5">
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all text-[10.5px] text-gray-500">{short(m.args, 800)}</pre>
          {m.result !== undefined && (
            <pre className={"max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10.5px] " + (m.ok ? "text-gray-600 dark:text-gray-300" : "text-red-600")}>
              {short(m.result)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [conn, setConn] = useState<ConnState>("connecting");
  const [hermes, setHermes] = useState<HermesStatus | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>(loadHistory);
  const [input, setInput] = useState("");
  const [useSelection, setUseSelection] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "tools">("chat");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelCur, setModelCur] = useState<Sel | null>(null);
  const [modelSel, setModelSel] = useState<Sel | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillDetails, setSkillDetails] = useState<Record<string, SkillDetail | null>>({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [officeTools, setOfficeTools] = useState<OfficeToolInfo[]>([]);
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [toolResults, setToolResults] = useState<Record<string, { ok: boolean; result: unknown }>>({});
  const [inline, setInline] = useState<InlineState>(INLINE_IDLE);
  const inlineId = useRef<string | null>(null);
  const inlineTarget = useRef<InlineTarget>({ text: "", scope: "selection" });
  const inlineAuto = useRef(false);
  const inlineOut = useRef("");
  const client = useRef<BridgeClient>();
  // Latest translator for use inside the long-lived bridge event handler.
  const tRef = useRef(t);
  tRef.current = t;
  const endRef = useRef<HTMLDivElement>(null);
  const histRef = useRef<Msg[]>(msgs);
  histRef.current = msgs;

  // Persist the conversation (debounced while streaming; flushed when the taskpane closes).
  useEffect(() => {
    const id = window.setTimeout(() => saveHistory(msgs), 250);
    return () => window.clearTimeout(id);
  }, [msgs]);
  useEffect(() => {
    const flush = () => saveHistory(histRef.current);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  const applyInline = useCallback(async (text: string) => {
    try {
      await applyInlineEdit(inlineTarget.current, clean(text));
      setInline(INLINE_IDLE);
    } catch (err) {
      setInline((s) => ({ ...s, busy: false, error: err instanceof Error ? err.message : String(err) }));
    }
  }, []);

  const onEvent = useCallback((e: BridgeEvent) => {
    if ("id" in e && e.id && e.id === inlineId.current) {
      if (e.type === "delta") {
        inlineOut.current += e.text;
        setInline((s) => ({ ...s, output: s.output + e.text }));
      }
      else if (e.type === "error") setInline((s) => ({ ...s, error: e.message }));
      else if (e.type === "done") {
        inlineId.current = null;
        if (inlineAuto.current && inlineOut.current && !e.cancelled) void applyInline(inlineOut.current);
        setInline((s) => ({ ...s, busy: false, output: clean(s.output) }));
      }
      return;
    }
    switch (e.type) {
      case "status":
        setHermes(e.hermes);
        break;
      case "models":
        setModels(e.models);
        setModelCur(e.current);
        setModelSel(e.selected);
        break;
      case "skills":
        setSkills(e.skills);
        setActiveSkills(e.active);
        break;
      case "skill_detail": {
        const key = e.skill?.name ?? e.name;
        if (key) setSkillDetails((d) => ({ ...d, [key]: e.skill }));
        break;
      }
      case "skills_active":
        setActiveSkills(e.active);
        break;
      case "tools_info":
        setOfficeTools(e.office);
        setToolsets(e.hermes);
        break;
      case "delta":
        setMsgs((m) => {
          const last = m[m.length - 1];
          if (last && last.id === e.id && last.role === "assistant") {
            return [...m.slice(0, -1), { ...last, text: last.text + e.text }];
          }
          return [...m, { id: e.id, role: "assistant", text: e.text }];
        });
        break;
      case "tool_call":
        setMsgs((m) => [...m, { id: e.id, role: "tool", text: "", tool: e.tool, args: e.args, pending: true }]);
        break;
      case "tool_result":
        if (e.direct) {
          setToolResults((r) => ({ ...r, [e.tool]: { ok: e.ok, result: e.result } }));
          break;
        }
        setMsgs((m) => {
          let i = m.length - 1;
          while (i >= 0 && !(m[i].role === "tool" && m[i].pending && m[i].tool === e.tool)) i--;
          const done = { result: e.result, ok: e.ok, pending: false };
          if (i < 0) return [...m, { id: e.id, role: "tool", text: "", tool: e.tool, ...done }];
          return m.map((x, j) => (j === i ? { ...x, ...done } : x));
        });
        break;
      case "error":
        setError(e.code && `err.${e.code}` in ERR_KEYS ? tRef.current(ERR_KEYS[`err.${e.code}`]) : e.message);
        break;
      case "done":
        setBusy(null);
        setMsgs((m) => (m.some((x) => x.pending) ? m.map((x) => (x.pending ? { ...x, pending: false, ok: false } : x)) : m));
        break;
    }
  }, [applyInline]);

  useEffect(() => {
    const c = new BridgeClient(onEvent, (s) => {
      setConn(s);
      if (s === "open") {
        for (const type of ["list_models", "list_skills", "list_tools"]) c.send({ type });
        // Give a fresh bridge session the restored conversation as context (ignored if it already has history).
        const hist = histRef.current
          .filter((m) => (m.role === "user" || m.role === "assistant") && m.text)
          .map((m) => ({ role: m.role, content: m.text }));
        if (hist.length) c.send({ type: "restore_history", messages: hist });
      }
    });
    client.current = c;
    c.connect();
    return () => c.close();
  }, [onEvent]);

  // Auto-scroll the feed unless the user scrolled up to read.
  const feedRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onFeedScroll = () => {
    const el = feedRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);

  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || busy) return;
    stick.current = true;
    setError(null);
    let context: string | undefined;
    try {
      if (useSelection) {
        const sel = await getSelectionText();
        if (sel) context = `Selected content:\n${sel}`;
      }
    } catch (e) {
      setError(t("err.readSelection", { msg: e instanceof Error ? e.message : String(e) }));
    }
    const id = crypto.randomUUID();
    setMsgs((m) => [...m, { id: id + "-u", role: "user", text }]);
    setInput("");
    setBusy(id);
    try {
      client.current?.send({ type: "chat", id, text, host: currentHost(), context });
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const insertMsg = async (m: Msg) => {
    try {
      await replaceSelectionText(clean(m.text).trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const safeSend = (msg: object) => {
    try {
      client.current?.send(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const selectModel = (m: ModelOption | null) => safeSend({ type: "set_model", model: m?.id ?? null, provider: m?.provider ?? null });
  const changeSkills = (names: string[]) => {
    setActiveSkills(names);
    safeSend({ type: "set_skills", skills: names });
  };
  const runOffice = (tool: string, args: object) => safeSend({ type: "run_tool", id: crypto.randomUUID(), tool, args });
  const runToolset = (toolset: string, text: string) => {
    if (busy) return;
    const id = crypto.randomUUID();
    setMsgs((m) => [...m, { id: id + "-u", role: "user", text: `[${toolset}] ${text}` }]);
    setBusy(id);
    setTab("chat");
    safeSend({ type: "run_toolset", id, toolset, text });
  };

  const openInline = useCallback(async () => {
    if (inlineId.current) return;
    setTab("chat");
    setSkillsOpen(false);
    try {
      const t = await getInlineTarget();
      inlineTarget.current = t;
      setInline({ ...INLINE_IDLE, open: true, scope: t.scope, target: t.text });
    } catch (e) {
      setError(t("err.readSelection2", { msg: e instanceof Error ? e.message : String(e) }));
    }
  }, []);
  useInlineShortcut(openInline);

  const submitInline = (instruction: string, autoApply: boolean) => {
    const id = crypto.randomUUID();
    inlineId.current = id;
    inlineAuto.current = autoApply;
    inlineOut.current = "";
    setInline((s) => ({ ...s, output: "", busy: true, error: null }));
    try {
      client.current?.send({ type: "inline", id, text: instruction, target: inlineTarget.current.text, host: currentHost() });
    } catch (e) {
      inlineId.current = null;
      setInline((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : String(e) }));
    }
  };
  const cancelInline = () => {
    if (inlineId.current) safeSend({ type: "cancel", id: inlineId.current });
  };
  const closeInline = () => {
    cancelInline();
    inlineId.current = null;
    setInline(INLINE_IDLE);
  };

  const reset = () => {
    try {
      client.current?.send({ type: "reset" });
    } catch {
      /* bridge offline: still clear locally */
    }
    setMsgs([]);
    saveHistory([]);
    setConfirmClear(false);
  };

  const lastMsg = msgs[msgs.length - 1];
  const toolRunning = msgs.some((m) => m.pending);
  const streaming = !!busy && lastMsg?.role === "assistant";
  const status = inline.busy
    ? t("status.applying")
    : toolRunning
      ? t("status.applying")
      : busy
        ? streaming ? t("status.generating") : t("status.thinking")
        : null;
  const connTone = conn === "open" ? "ok" : conn === "connecting" ? "warn" : "bad";
  const chat = tab === "chat";
  const canSend = !!input.trim() && !busy && conn === "open";
  const last = msgs.length - 1;

  return (
    <div className="hx relative flex h-full flex-col overflow-hidden">
      {/* Header: one 32px row */}
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-gray-500/20 px-2">
        <span data-tip={t("header.bridge", { state: t(`conn.${conn}`) }) + (hermes ? t(hermes.installed ? "header.hermesOk" : "header.hermesMissing") : "")} data-tip-left="" className="flex items-center gap-1.5">
          <StatusDot tone={hermes && !hermes.installed ? "bad" : connTone} pulse={conn === "connecting"} />
          <strong className="text-[12px] font-semibold">Hermes</strong>
        </span>
        <span className="text-[11px] capitalize text-gray-500">{currentHost()}</span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={t("lang.switch")}
          data-tip={t("lang.switch")}
          data-tip-left=""
          onClick={() => setLang(lang === "vi" ? "en" : "vi")}
          className="inline-flex h-6 items-center rounded-md border border-gray-500/25 text-[10px] font-semibold leading-none"
        >
          {(["vi", "en"] as const).map((l) => (
            <span key={l} className={"px-1.5 py-1 " + (lang === l ? "rounded-md bg-indigo-600 text-white" : "text-gray-500")}>{l === "vi" ? "Viet" : "Eng"}</span>
          ))}
        </button>
        <IconButton tip={t("header.inline", { key: shortcutLabel })} onClick={() => void openInline()}><IconEdit /></IconButton>
        <IconButton tip={activeSkills.length ? t("header.skillsActive", { n: activeSkills.length }) : t("header.skills")} onClick={() => setSkillsOpen(true)} active={activeSkills.length > 0}><IconSkills /></IconButton>
        <IconButton tip={t("header.tools")} onClick={() => setTab(chat ? "tools" : "chat")} active={!chat}><IconTools /></IconButton>
        <IconButton tip={t("history.clear")} onClick={() => setConfirmClear(true)} disabled={!msgs.length} danger><IconTrash /></IconButton>
      </header>

      {(conn === "closed" || (hermes && !hermes.installed) || error) && (
        <div className="shrink-0 space-y-1 px-2 pt-1.5">
          {conn === "closed" && <Pill tone="warn">{t("banner.bridgeDown")}</Pill>}
          {hermes && !hermes.installed && <Pill tone="bad">{t("banner.noHermes")}</Pill>}
          {error && (
            <div className="flex items-start gap-1 rounded-lg border border-red-500/25 bg-red-500/10 px-2 py-1 text-[11px] text-red-700 dark:text-red-300">
              <span className="flex-1 break-words">{error}</span>
              <button type="button" aria-label={t("common.dismiss")} onClick={() => setError(null)} className="mt-0.5 opacity-70 hover:opacity-100"><IconX className="h-3 w-3" /></button>
            </div>
          )}
        </div>
      )}

      {!chat && (
        <ToolsPanel
          host={currentHost()}
          office={officeTools}
          hermes={toolsets}
          results={toolResults}
          onRunOffice={runOffice}
          onRunToolset={runToolset}
          disabled={conn !== "open"}
        />
      )}

      {/* Chat feed: takes all remaining height */}
      <div ref={feedRef} onScroll={onFeedScroll} className={"min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-2 " + (chat ? "" : "hidden")}>
        {!msgs.length && (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-gray-500">
            <IconSkills className="h-5 w-5 text-indigo-500" />
            <p className="text-[12px] font-medium text-gray-700 dark:text-gray-300">{t("empty.title", { host: currentHost() })}</p>
            <p className="text-[11px]">{t("empty.hint", { key: shortcutLabel })}</p>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "tool" ? (
            <ToolStep key={i} m={m} />
          ) : m.role === "user" ? (
            <div key={i} className="ml-8 animate-pop whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-indigo-600 px-2.5 py-1.5 text-[13px] text-white">
              {m.text}
            </div>
          ) : (
            <div key={i} className="group animate-pop">
              <div className="whitespace-pre-wrap break-words rounded-xl rounded-bl-sm border border-gray-500/20 bg-gray-500/[0.06] px-2.5 py-1.5 text-[13px]">
                {m.text}
                {busy && i === last && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-indigo-500 align-middle" />}
              </div>
              {!(busy && i === last) && (
                <div className="mt-0.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton tip={t("msg.insert")} onClick={() => void insertMsg(m)} tipLeft><IconInsert /></IconButton>
                  <IconButton tip={t("msg.copy")} onClick={() => void navigator.clipboard?.writeText(clean(m.text).trim())} tipLeft><IconCopy /></IconButton>
                </div>
              )}
            </div>
          ),
        )}
        {busy && !streaming && !toolRunning && (
          <div className="flex items-center gap-1.5 px-1 text-[11px]"><StatusDot tone="accent" pulse /><span className="shimmer-text">{t("status.thinkingShort")}</span></div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className={"shrink-0 space-y-1.5 px-2 pb-2 pt-1 " + (chat ? "" : "hidden")}>
        {status && (
          <div className="flex items-center gap-1.5 px-1 text-[11px]" role="status" aria-live="polite">
            <StatusDot tone="accent" pulse />
            <span className="shimmer-text flex-1">{status}</span>
            {busy && (
              <button type="button" onClick={() => client.current?.send({ type: "cancel", id: busy })} className="inline-flex h-5 items-center gap-1 rounded-full border border-red-500/30 px-2 text-[10.5px] text-red-600 hover:bg-red-500/10">
                <IconStop className="h-2.5 w-2.5" />{t("common.stop")}
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={!!busy || conn !== "open"}
              onClick={() => { setUseSelection(true); void send(t(`chip.${c.id}.prompt`)); }}
              data-tip={t(`chip.${c.id}.prompt`)}
              data-tip-up=""
              data-tip-left=""
              className="inline-flex h-5 items-center rounded-full border border-gray-500/25 px-2 text-[11px] text-gray-600 hover:border-indigo-500/50 hover:bg-indigo-500/10 hover:text-indigo-600 disabled:opacity-40 dark:text-gray-300"
            >
              {t(`chip.${c.id}`)}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-gray-500/30 bg-gray-500/[0.04] focus-within:border-indigo-500/60 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,.12)]">
          <textarea
            ref={taRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("composer.placeholder")}
            className="block max-h-40 w-full px-2.5 pb-0.5 pt-2 text-[13px] placeholder:text-gray-400"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isImeKey(e)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex items-center gap-1 px-1.5 pb-1.5">
            <ModelSelector models={models} current={modelCur} selected={modelSel} onSelect={selectModel} up />
            {activeSkills.slice(0, 2).map((s) => (
              <Pill key={s} tone="accent" tip={s} onRemove={() => changeSkills(activeSkills.filter((n) => n !== s))}>{s}</Pill>
            ))}
            {activeSkills.length > 2 && <Pill tone="accent" onClick={() => setSkillsOpen(true)} tip={t("skills.manage")}>+{activeSkills.length - 2}</Pill>}
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setUseSelection((v) => !v)}
              data-tip={useSelection ? t("composer.selOn") : t("composer.selOff")}
              data-tip-up=""
              aria-pressed={useSelection}
              className={"inline-flex h-6 w-6 items-center justify-center rounded-md " + (useSelection ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300" : "text-gray-400 hover:bg-gray-500/15")}
            >
              <IconSelection />
            </button>
            {busy ? (
              <button type="button" aria-label={t("common.stop")} data-tip={t("common.stop")} data-tip-up="" onClick={() => client.current?.send({ type: "cancel", id: busy })} className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-red-500/15 text-red-600 hover:bg-red-500/25">
                <IconStop />
              </button>
            ) : (
              <button type="button" aria-label={t("common.sendLabel")} data-tip={t("common.send")} data-tip-up="" disabled={!canSend} onClick={() => void send()} className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-gray-500/20 disabled:text-gray-400">
                <IconSend />
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmClear && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label={t("history.clear")}
          onKeyDown={(e) => e.key === "Escape" && setConfirmClear(false)}
        >
          <div className="animate-pop w-full max-w-[280px] space-y-3 rounded-xl border border-gray-500/30 bg-white p-3 shadow-xl dark:bg-[#1c1f25]">
            <p className="text-[12px]">{t("history.confirm")}</p>
            <div className="flex justify-end gap-1.5">
              <button type="button" autoFocus onClick={() => setConfirmClear(false)} className="h-6 rounded-md border border-gray-500/30 px-2.5 text-[11px] hover:bg-gray-500/10">{t("history.cancel")}</button>
              <button type="button" onClick={reset} className="h-6 rounded-md bg-red-600 px-2.5 text-[11px] font-medium text-white hover:bg-red-500">{t("history.confirmYes")}</button>
            </div>
          </div>
        </div>
      )}
      <SkillsDrawer
        details={skillDetails}
        onRequestDetail={(name) => safeSend({ type: "get_skill", name })}
        open={skillsOpen}
        skills={skills}
        active={activeSkills}
        onChange={changeSkills}
        onRefresh={() => safeSend({ type: "list_skills" })}
        onClose={() => setSkillsOpen(false)}
      />
      <InlineEdit
        state={inline}
        onSubmit={submitInline}
        onAccept={() => void applyInline(inline.output)}
        onCancel={cancelInline}
        onClose={closeInline}
      />
    </div>
  );
}
