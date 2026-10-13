import { useCallback, useEffect, useRef, useState } from "react";
import {
  BridgeClient,
  type AuthInfo,
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
import ImeTextarea, { type ImeTextareaHandle } from "./ImeTextarea";
import InlineEdit, { type InlineState } from "./InlineEdit";
import LoginModal, { type AuthProgress } from "./LoginModal";
import ModelSelector from "./ModelSelector";
import ReasoningSelector from "./ReasoningSelector";
import RulesModal from "./RulesModal";
import SessionsDrawer from "./SessionsDrawer";
import SkillCreateModal from "./SkillCreateModal";
import SkillsDrawer from "./SkillsDrawer";
import {
  chatTokens, effectiveMemory, effectiveRules, fillTemplate, isLinked, loadAtt, loadMsgs, loadWorkspace, newChatMeta, removeMsgs, saveAtt, saveMsgs, saveWorkspace, setLinked, titleFrom, toMarkdown, uid,
  type Attachment, type Mode, type Msg, type Project, type Template, type Workspace,
} from "../lib/workspace";
import ToolsPanel from "./ToolsPanel";
import ApprovalCard from "./ApprovalCard";
import AttachMenu from "./AttachMenu";
import MemoryModal from "./MemoryModal";
import ModeSelector from "./ModeSelector";
import MoreMenu from "./MoreMenu";
import RichText from "./RichText";
import TemplatesModal from "./TemplatesModal";
import { gotoRef } from "../office/goto";
import type { Snapshot } from "../office/snapshot";
import TooltipHost from "./TooltipHost";
import {
  IconButton, IconCheck, IconChevron, IconCopy, IconEdit, IconFolder, IconInsert, IconLink, IconPlus, IconRules, IconSelection, IconSend, IconUndo, IconSkills, IconStop, IconTools, IconTrash, IconX, Pill, StatusDot,
} from "./ui";

/** The CLI's quiet mode appends a `session_id:` footer; never insert that into a document. */
/** What the bridge needs to find an attachment again; legacy entries keep their text so the bridge can adopt them. */
const attRef = (a: Attachment) => (a.doc_id ? { name: a.name, doc_id: a.doc_id } : { name: a.name, text: a.text });

const clean = (t: string) => t.replace(/\s*session_id: \S+\s*$/, "").replace(/```office-memory[\s\S]*?```/g, "");

const INLINE_IDLE: InlineState = { open: false, scope: "selection", target: "", output: "", busy: false, error: null };
type Sel = { model: string | null; provider: string | null };

// One colour family per quick action; light and dark variants are separate literal classes so Tailwind keeps them.
const CHIPS: { id: "summarize" | "proofread" | "translate" | "table"; cls: string }[] = [
  { id: "summarize", cls: "border-sky-600/40 bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300 dark:hover:bg-sky-400/20" },
  { id: "proofread", cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/20" },
  { id: "translate", cls: "border-amber-600/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:bg-amber-400/20" },
  { id: "table", cls: "border-fuchsia-600/40 bg-fuchsia-500/10 text-fuchsia-700 hover:bg-fuchsia-500/20 dark:border-fuchsia-400/40 dark:bg-fuchsia-400/10 dark:text-fuchsia-300 dark:hover:bg-fuchsia-400/20" },
];

const ERR_KEYS: Record<string, Key> = {
  "err.hermes_not_found": "err.hermes_not_found",
  "err.invalid_model": "err.invalid_model",
  "err.invalid_skill": "err.invalid_skill",
};

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
  const [ws, setWs] = useState<Workspace>(loadWorkspace);
  const [msgs, setMsgs] = useState<Msg[]>(() => loadMsgs(ws.activeId));
  const wsRef = useRef<Workspace>(ws);
  const activeIdRef = useRef<string>(ws.activeId);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [rulesModal, setRulesModal] = useState<{ kind: "global" } | { kind: "project"; id: string | "new" } | null>(null);
  const [undo, setUndo] = useState<Snapshot[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [approval, setApproval] = useState<{ rid: string; calls: { tool: string; args: unknown }[] } | null>(null);
  const [proposals, setProposals] = useState<{ id: string; note: string }[]>([]);
  const [att, setAtt] = useState<Attachment[]>(() => loadAtt(ws.activeId));
  const [extractedIn, setExtractedIn] = useState<Extract<BridgeEvent, { type: "extracted" }> | null>(null);
  const [summaryIn, setSummaryIn] = useState<Extract<BridgeEvent, { type: "summary" }> | null>(null);
  const [summarizing, setSummarizing] = useState<string | null>(null);
  const [warnOff, setWarnOff] = useState<string[]>([]);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [slashQ, setSlashQ] = useState<string | null>(null);
  const turnLabel = useRef<Record<string, string>>({});
  const attPending = useRef<Record<string, string>>({});
  const [skillCreate, setSkillCreate] = useState<{ open: boolean; busy: boolean; error: string | null }>({ open: false, busy: false, error: null });
  // Nội dung ô chat nằm trong DOM (ImeTextarea, uncontrolled) để không làm hỏng bộ gõ tiếng Việt; state chỉ giữ cờ "có chữ".
  const [hasInput, setHasInput] = useState(false);
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
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authDismissed, setAuthDismissed] = useState(false);
  const [progress, setProgress] = useState<AuthProgress>({ stage: null, lines: [] });
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [officeTools, setOfficeTools] = useState<OfficeToolInfo[]>([]);
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [toolResults, setToolResults] = useState<Record<string, { ok: boolean; result: unknown }>>({});
  const [inline, setInline] = useState<InlineState>(INLINE_IDLE);
  const [composeIn, setComposeIn] = useState<{ text: string; seq: number } | null>(null);
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
    const id = window.setTimeout(() => saveMsgs(activeIdRef.current, msgs), 250);
    return () => window.clearTimeout(id);
  }, [msgs]);
  useEffect(() => {
    const flush = () => saveMsgs(activeIdRef.current, histRef.current);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  /** Single writer for workspace state: the ref is always current, so handlers can chain updates safely. */
  const updateWs = useCallback((fn: (w: Workspace) => Workspace) => {
    const next = fn(wsRef.current);
    wsRef.current = next;
    setWs(next);
    saveWorkspace(next);
  }, []);
  // Name a chat after its first user message.
  useEffect(() => {
    const title = titleFrom(msgs);
    const cur = wsRef.current.chats.find((c) => c.id === activeIdRef.current);
    if (title && cur && !cur.title) updateWs((w) => ({ ...w, chats: w.chats.map((c) => (c.id === cur.id ? { ...c, title } : c)) }));
  }, [msgs, updateWs]);

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
      case "compose":
        if (e.target === "inline") setComposeIn({ text: e.text, seq: Date.now() });
        else {
          taRef.current?.append(e.text);
          setTimeout(() => taRef.current?.focus(), 0);
        }
        break;
      case "status":
        setHermes(e.hermes);
        break;
      case "auth_status":
        setAuth(e);
        setHermes(e.hermes);
        if (e.logged_in) setAuthOpen(false);
        break;
      case "auth_progress":
        if (e.line === "exit") {
          setProgress((p) => ({ ...p, stage: null, failed: !e.ok, manual: e.manual }));
        } else {
          setProgress((p) => ({ stage: e.stage, lines: e.line === "start" ? [] : [...p.lines, e.line].slice(-40), url: e.url ?? p.url }));
        }
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
      case "skill_created":
        if (e.ok) {
          setSkillCreate({ open: false, busy: false, error: null });
          setActiveSkills((a) => (a.includes(e.name) ? a : [...a, e.name]));
        } else setSkillCreate((c) => ({ ...c, busy: false, error: e.message ?? "error" }));
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
      case "approval_request":
        setApproval({ rid: e.rid, calls: e.calls });
        break;
      case "memory_proposal":
        setProposals((p) => (p.some((x) => x.note === e.note) ? p : [...p, { id: crypto.randomUUID().slice(0, 8), note: e.note }]));
        break;
      case "extracted":
        setExtractedIn(e);
        break;
      case "attachments":
        // The bridge is the source of truth for what it still holds; keep only metadata here.
        setAtt((cur) => {
          const next: Attachment[] = e.items.filter((x) => x.ok).map((x) => ({ name: x.name, doc_id: x.doc_id, chars: x.chars, chunks: x.chunks, mode: x.mode }));
          if (e.items.some((x) => !x.ok)) setNotice(tRef.current("att.missing", { name: e.items.filter((x) => !x.ok).map((x) => x.name).join(", ") }));
          return JSON.stringify(next) === JSON.stringify(cur) ? cur : next;
        });
        break;
      case "summary":
        setSummaryIn(e);
        break;
      case "done":
        setApproval(null);
        setBusy(null);
        setMsgs((m) => (m.some((x) => x.pending) ? m.map((x) => (x.pending ? { ...x, pending: false, ok: false } : x)) : m));
        break;
    }
  }, [applyInline]);

  useEffect(() => {
    const c = new BridgeClient(onEvent, (s) => {
      setConn(s);
      if (s === "open") {
        c.send({ type: "set_mode", mode: wsRef.current.mode });
        c.send({ type: "set_memory", memory: effectiveMemory(wsRef.current) });
        c.send({ type: "set_attachments", items: loadAtt(activeIdRef.current).map(attRef) });
        for (const type of ["list_models", "list_skills", "list_tools", "auth_status"]) c.send({ type });
        c.send({ type: "set_reasoning", level: wsRef.current.reasoning });
        c.send({ type: "set_rules", rules: effectiveRules(wsRef.current) });
        // Give a fresh bridge session the restored conversation as context (ignored if it already has history).
        const hist = histRef.current
          .filter((m) => (m.role === "user" || m.role === "assistant") && m.text)
          .map((m) => ({ role: m.role, content: m.text }));
        if (hist.length) c.send({ type: "restore_history", messages: hist });
      }
    }, (turn, snap, err) => {
      if (snap) setUndo((u) => [...u, { ...snap, label: (turnLabel.current[turn] ?? snap.label).slice(0, 50) }].slice(-5));
      else setError(tRef.current("undo.noSnap", { msg: err ?? "?" }));
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

  const taRef = useRef<ImeTextareaHandle>(null);

  const send = async (override?: string) => {
    let text = (override ?? taRef.current?.getValue() ?? "").trim();
    if (!text || busy) return;
    if (/\{[^}]+\}/.test(text)) {
      let sel = "";
      try { sel = await getSelectionText(); } catch { /* no selection available */ }
      text = fillTemplate(text, { selection: sel, file: (Office.context.document?.url || "").split(/[\\/]/).pop() || "", app: currentHost() });
    }
    setSlashQ(null);
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
    turnLabel.current[id] = text;
    updateWs((w) => ({ ...w, chats: w.chats.map((c) => (c.id === w.activeId ? { ...c, updated: Date.now() } : c)) }));
    setMsgs((m) => [...m, { id: id + "-u", role: "user", text }]);
    taRef.current?.setValue("");
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

  const startLogin = () => {
    setProgress({ stage: "login", lines: [] });
    safeSend({ type: "auth_google" });
  };
  const startInstall = () => {
    setProgress({ stage: "hermes", lines: [] });
    safeSend({ type: "setup_install", target: "hermes" });
  };
  const needAuth = !!auth && (!auth.hermes.installed || !auth.logged_in);
  const showAuth = needAuth && (authOpen || (!authDismissed && conn === "open"));

  const selectModel = (m: ModelOption | null) => safeSend({ type: "set_model", model: m?.id ?? null, provider: m?.provider ?? null });
  const changeSkills = (names: string[]) => {
    setActiveSkills(names);
    safeSend({ type: "set_skills", skills: names });
    // A project remembers the skills chosen while working in it.
    const pid = wsRef.current.chats.find((c) => c.id === wsRef.current.activeId)?.projectId;
    if (pid) updateWs((w) => ({ ...w, projects: w.projects.map((p) => (p.id === pid ? { ...p, skills: names } : p)) }));
  };
  const createSkill = (name: string, description: string, body: string) => {
    setSkillCreate({ open: true, busy: true, error: null });
    safeSend({ type: "create_skill", name, description, body });
  };

  // ---- chats / projects -------------------------------------------------------------
  /** Make `id` the active chat: persist the old one, load the new one and give the bridge a clean context for it. */
  const switchTo = (id: string) => {
    if (id === activeIdRef.current) return;
    saveMsgs(activeIdRef.current, histRef.current);
    const next = loadMsgs(id);
    activeIdRef.current = id;
    histRef.current = next;
    setMsgs(next);
    updateWs((w) => ({ ...w, activeId: id }));
    exitSelect();
    setError(null);
    setProposals([]);
    setApproval(null);
    setAtt(loadAtt(id));
    safeSend({ type: "reset" });
    const hist = next.filter((m) => (m.role === "user" || m.role === "assistant") && m.text).map((m) => ({ role: m.role, content: m.text }));
    if (hist.length) safeSend({ type: "restore_history", messages: hist });
    const pid = wsRef.current.chats.find((c) => c.id === id)?.projectId;
    const proj = pid ? wsRef.current.projects.find((p) => p.id === pid) : undefined;
    if (proj?.skills.length) {
      setActiveSkills(proj.skills);
      safeSend({ type: "set_skills", skills: proj.skills });
    }
  };
  const newChat = (projectId: string | null = null) => {
    if (busy) return;
    const cur = wsRef.current.chats.find((c) => c.id === activeIdRef.current);
    if (!histRef.current.length && cur && cur.projectId === projectId) {
      setSessionsOpen(false);
      taRef.current?.focus();
      return;
    }
    const meta = newChatMeta(projectId);
    updateWs((w) => ({ ...w, chats: [...w.chats, meta] }));
    switchTo(meta.id);
    setSessionsOpen(false);
    setTab("chat");
    setTimeout(() => taRef.current?.focus(), 0);
  };
  const deleteChat = (id: string) => {
    if (id === activeIdRef.current && busy) return;
    removeMsgs(id);
    const rest = wsRef.current.chats.filter((c) => c.id !== id);
    if (id !== activeIdRef.current) {
      updateWs((w) => ({ ...w, chats: rest }));
      return;
    }
    const fallback = [...rest].sort((a, b) => b.updated - a.updated)[0] ?? newChatMeta();
    updateWs((w) => ({ ...w, chats: rest.length ? rest : [fallback] }));
    switchTo(fallback.id);
  };
  const deleteProject = (id: string) =>
    updateWs((w) => ({ ...w, projects: w.projects.filter((p) => p.id !== id), chats: w.chats.map((c) => (c.projectId === id ? { ...c, projectId: null } : c)) }));
  const saveRules = (name: string, rules: string) => {
    const m = rulesModal;
    setRulesModal(null);
    if (!m) return;
    if (m.kind === "global") {
      updateWs((w) => ({ ...w, globalRules: rules }));
    } else if (m.id === "new") {
      const proj: Project = { id: uid(), name, rules, skills: [], memory: [] };
      updateWs((w) => ({ ...w, projects: [...w.projects, proj] }));
      newChat(proj.id);
    } else {
      updateWs((w) => ({ ...w, projects: w.projects.map((p) => (p.id === m.id ? { ...p, name, rules } : p)) }));
    }
  };
  const selectReasoning = (level: string | null) => {
    updateWs((w) => ({ ...w, reasoning: level }));
    safeSend({ type: "set_reasoning", level });
  };
  const rulesStr = effectiveRules(ws);
  const memStr = effectiveMemory(ws);
  useEffect(() => {
    if (conn === "open") safeSend({ type: "set_memory", memory: memStr });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, memStr]);
  useEffect(() => {
    if (!saveAtt(activeIdRef.current, att)) setNotice(tRef.current("att.notSaved"));
    if (conn === "open") safeSend({ type: "set_attachments", items: att.map(attRef) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, att]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(id);
  }, [notice]);

  // 4. templates visible in the current chat
  const curProjectId = ws.chats.find((c) => c.id === ws.activeId)?.projectId ?? null;
  const curProject = ws.projects.find((p) => p.id === curProjectId);
  const userTemplates = ws.templates.filter((x) => !x.projectId || x.projectId === curProjectId);
  const slashItems: { key: string; name: string; prompt: string }[] = [
    ...CHIPS.map((c) => ({ key: c.id, name: t(`chip.${c.id}`), prompt: t(`chip.${c.id}.prompt`) })),
    ...userTemplates.map((x) => ({ key: x.id, name: x.name, prompt: x.prompt })),
  ].filter((x) => slashQ !== null && x.name.toLowerCase().includes(slashQ.toLowerCase()));
  const pickSlash = (prompt: string) => {
    taRef.current?.setValue(prompt);
    setHasInput(true);
    setSlashQ(null);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  // 5 + 9. modes and approval
  const changeMode = (m: Mode) => {
    updateWs((w) => ({ ...w, mode: m }));
    safeSend({ type: "set_mode", mode: m });
  };
  const answerApproval = (ok: boolean) => {
    if (!approval) return;
    safeSend({ type: "approval_response", rid: approval.rid, ok });
    setApproval(null);
  };

  // 3. undo
  const undoLast = async () => {
    const snap = undo[undo.length - 1];
    if (!snap || busy) return;
    try {
      await snap.restore();
      setUndo((u) => u.slice(0, -1));
      setNotice(t("undo.done", { label: snap.label }) + (snap.note ? " " + t("undo.note", { note: snap.note }) : ""));
    } catch (e) {
      setError(t("undo.failed", { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  // 7. memory
  const saveNote = (p: { id: string; note: string }) => {
    const note = { id: uid(), text: p.note };
    if (curProjectId) updateWs((w) => ({ ...w, projects: w.projects.map((x) => (x.id === curProjectId ? { ...x, memory: [...x.memory, note] } : x)) }));
    else updateWs((w) => ({ ...w, memory: [...w.memory, note] }));
    setProposals((l) => l.filter((x) => x.id !== p.id));
  };

  // 6. attachments
  const addFile = async (f: File) => {
    // Raw upload over HTTP: no size cap and no base64 inflation (the WebSocket frame limit does not apply).
    setNotice(t("att.reading", { name: f.name }));
    try {
      const r = await fetch(`/extract?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      const j = await r.json();
      setExtractedIn({ type: "extracted", id: crypto.randomUUID(), ok: !!j.ok, name: j.name || f.name, doc_id: j.doc_id, chars: j.chars, chunks: j.chunks, mode: j.mode, message: j.message });
    } catch (e) {
      setExtractedIn({ type: "extracted", id: crypto.randomUUID(), ok: false, name: f.name, message: e instanceof Error ? e.message : String(e) });
    }
  };
  const addLink = (url: string) => {
    const id = crypto.randomUUID();
    attPending.current[id] = url;
    safeSend({ type: "extract_url", id, url });
  };
  useEffect(() => {
    if (!extractedIn) return;
    const e = extractedIn;
    setExtractedIn(null);
    delete attPending.current[e.id];
    if (e.ok && e.doc_id) {
      setAtt((a) => [...a.filter((x) => x.name !== e.name), { name: e.name, doc_id: e.doc_id, chars: e.chars, chunks: e.chunks, mode: e.mode }]);
      setNotice(e.mode === "search" ? t("att.searchMode", { name: e.name, chunks: String(e.chunks ?? "?") }) : null);
    } else setError(t("att.failed", { name: e.name, msg: e.message ?? "?" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractedIn]);

  // 1 + 2 + 8. summaries, export, context meter
  const chatTitle = ws.chats.find((c) => c.id === ws.activeId)?.title || "";
  const tokens = chatTokens(msgs, rulesStr, memStr, att);
  const fmtTok = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
  const overLimit = ws.tokenLimit > 0 && tokens > ws.tokenLimit;
  const startSummary = (purpose: "compress" | "insert") => {
    if (busy || summarizing || !msgs.length) return;
    const id = crypto.randomUUID();
    setSummarizing(id);
    setNotice(t("more.summarizing"));
    safeSend({ type: "summarize", id, purpose });
  };
  useEffect(() => {
    if (!summaryIn) return;
    const e = summaryIn;
    setSummaryIn(null);
    setSummarizing(null);
    if (e.failed || e.cancelled || !e.text) return;
    if (e.purpose === "insert") {
      replaceSelectionText(e.text).then(() => setNotice(t("more.summaryInserted"))).catch((err) => setError(err instanceof Error ? err.message : String(err)));
      return;
    }
    const cur = wsRef.current.chats.find((c) => c.id === activeIdRef.current);
    const meta = { ...newChatMeta(cur?.projectId ?? null), title: ("↪ " + (cur?.title || t("chats.untitled"))).slice(0, 40) };
    saveMsgs(meta.id, [{ id: uid() + "-s", role: "assistant", text: t("ctx.summaryTitle") + "\n\n" + e.text }]);
    updateWs((w) => ({ ...w, chats: [...w.chats, meta] }));
    switchTo(meta.id);
    setSessionsOpen(false);
    setTab("chat");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryIn]);
  const downloadMd = () => {
    const blob = new Blob([toMarkdown(chatTitle, msgs)], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = ((chatTitle || "hermes-chat").replace(/[\\/:*?"<>|]+/g, "").trim() || "hermes-chat") + ".md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const copyMd = () => void navigator.clipboard?.writeText(toMarkdown(chatTitle, msgs)).then(() => setNotice(t("more.copied")));
  const cycleLimit = () => {
    const order = [20000, 40000, 80000, 0];
    updateWs((w) => ({ ...w, tokenLimit: order[(order.indexOf(w.tokenLimit) + 1) % order.length] }));
  };

  // 9. jump to a cited place
  const jump = (kind: string, target: string) => {
    gotoRef(kind, target).catch((e) => setError(t("ref.failed", { msg: e instanceof Error ? e.message : String(e) })));
  };

  useEffect(() => {
    if (conn === "open") safeSend({ type: "set_rules", rules: rulesStr });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, rulesStr]);
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
    saveMsgs(activeIdRef.current, []);
    setConfirmClear(false);
    exitSelect();
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };
  /** Remove messages by index and persist immediately (the debounced save would lag 250ms). */
  const deleteMsgs = (idx: Set<number>) => {
    const next = histRef.current.filter((_, i) => !idx.has(i));
    histRef.current = next;
    setMsgs(next);
    saveMsgs(activeIdRef.current, next);
    setSelected(new Set());
    if (!next.length) setSelectMode(false);
  };
  const toggleSel = (i: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(i)) n.add(i);
      return n;
    });

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
  const canSend = hasInput && !busy && conn === "open";
  const last = msgs.length - 1;
  const selectable = msgs.flatMap((m, i) => (m.pending || (busy && i === last) ? [] : [i]));

  return (
    <div className="hx relative flex h-full flex-col overflow-hidden">
      {/* Header: status + language only. The right 68px is kept clear because Office draws its own floating
          button over the top-right corner of the taskpane (it cannot be hidden from an add-in). */}
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-gray-500/20 px-2 pr-[68px]">
        <span data-tip={t("header.bridge", { state: t(`conn.${conn}`) }) + (hermes ? t(hermes.installed ? "header.hermesOk" : "header.hermesMissing") : "")} data-tip-left="" className="flex items-center gap-1.5">
          <StatusDot tone={hermes && !hermes.installed ? "bad" : connTone} pulse={conn === "connecting"} />
          <strong className="text-[12px] font-semibold">Hermes</strong>
        </span>
        <span className="text-[11px] capitalize text-gray-500">{currentHost()}</span>
        <span className="flex-1" />
        {auth?.logged_in && auth.account && (
          <button type="button" onClick={() => { if (confirmLogout) { setConfirmLogout(false); safeSend({ type: "auth_logout" }); } else { setConfirmLogout(true); window.setTimeout(() => setConfirmLogout(false), 4000); } }} data-tip={t("auth.signedInAs", { email: auth.account }) + " · " + t("auth.logout")} data-tip-left="" className="max-w-[90px] truncate text-[10px] text-emerald-600 hover:underline">
            {confirmLogout ? t("auth.logout") + "?" : auth.account}
          </button>
        )}
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
      </header>

      {(conn === "closed" || (hermes && !hermes.installed) || needAuth || error) && (
        <div className="shrink-0 space-y-1 px-2 pt-1.5">
          {needAuth && auth?.hermes.installed && <Pill tone="warn" onClick={() => setAuthOpen(true)}>{t("banner.signIn")}</Pill>}
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

      {(notice || (overLimit && !warnOff.includes(ws.activeId) && !busy && !summarizing && msgs.length > 0)) && (
        <div className="shrink-0 space-y-1 px-2 pt-1.5">
          {notice && <div className="flex items-start gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-800 dark:text-emerald-300"><span className="flex-1 break-words">{notice}</span><button type="button" aria-label={t("common.dismiss")} onClick={() => setNotice(null)} className="mt-0.5 opacity-70 hover:opacity-100"><IconX className="h-3 w-3" /></button></div>}
          {overLimit && !warnOff.includes(ws.activeId) && !busy && !summarizing && msgs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200">
              <span className="min-w-0 flex-1">{t("ctx.warn", { n: fmtTok(tokens) })}</span>
              <button type="button" className="h-5 rounded-md bg-amber-600 px-2 text-white hover:bg-amber-500" onClick={() => startSummary("compress")}>{t("ctx.do")}</button>
              <button type="button" className="h-5 rounded-md border border-amber-500/40 px-2 hover:bg-amber-500/10" onClick={() => setWarnOff((w) => [...w, ws.activeId])}>{t("ctx.later")}</button>
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
        {msgs.map((m, i) => {
          const live = !!busy && i === last;
          const sel = selected.has(i);
          return (
            <div key={i} className="group flex items-start gap-1.5">
              {selectMode && (
                <input
                  type="checkbox"
                  checked={sel}
                  disabled={live || m.pending}
                  onChange={() => toggleSel(i)}
                  aria-label={t("history.selectMsg")}
                  className="mt-1.5 h-3.5 w-3.5 shrink-0 accent-indigo-600"
                />
              )}
              <div
                className={"min-w-0 flex-1 " + (selectMode ? "cursor-pointer " + (sel ? "opacity-100" : "opacity-70") : "")}
                onClick={selectMode && !live && !m.pending ? () => toggleSel(i) : undefined}
              >
                {m.role === "tool" ? (
                  <ToolStep m={m} />
                ) : m.role === "user" ? (
                  <div className="ml-8 animate-pop whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-indigo-600 px-2.5 py-1.5 text-[13px] text-white">
                    {m.text}
                  </div>
                ) : (
                  <div className="animate-pop">
                    <div className="whitespace-pre-wrap break-words rounded-xl rounded-bl-sm border border-gray-500/20 bg-gray-500/[0.06] px-2.5 py-1.5 text-[13px]">
                      <RichText text={m.text} onRef={jump} />
                      {live && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-indigo-500 align-middle" />}
                    </div>
                    {!live && !selectMode && (
                      <div className="mt-0.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <IconButton tip={t("msg.insert")} onClick={() => void insertMsg(m)} tipLeft><IconInsert /></IconButton>
                        <IconButton tip={t("msg.copy")} onClick={() => void navigator.clipboard?.writeText(clean(m.text).trim())} tipLeft><IconCopy /></IconButton>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {!selectMode && !live && !m.pending && (
                <div className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton tip={t("history.deleteSingle")} onClick={() => deleteMsgs(new Set([i]))} tipLeft danger><IconTrash /></IconButton>
                </div>
              )}
            </div>
          );
        })}
        {busy && !streaming && !toolRunning && (
          <div className="flex items-center gap-1.5 px-1 text-[11px]"><StatusDot tone="accent" pulse /><span className="shimmer-text">{t("status.thinkingShort")}</span></div>
        )}
        <div ref={endRef} />
      </div>

      {selectMode && chat && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-gray-500/20 bg-gray-500/[0.06] px-2 py-1.5 text-[11px]">
          <span className="mr-auto font-medium">{t("history.selectedCount", { n: selected.size })}</span>
          <button
            type="button"
            onClick={() => setSelected(selected.size === selectable.length ? new Set() : new Set(selectable))}
            className="h-6 rounded-md border border-gray-500/30 px-2 hover:bg-gray-500/10"
          >
            {selected.size === selectable.length && selectable.length ? t("history.deselectAll") : t("history.selectAll")}
          </button>
          <button
            type="button"
            disabled={!selected.size}
            onClick={() => deleteMsgs(selected)}
            className="h-6 rounded-md bg-red-600 px-2 font-medium text-white hover:bg-red-500 disabled:opacity-40"
          >
            {t("history.deleteSelected", { n: selected.size })}
          </button>
          <button type="button" onClick={exitSelect} className="h-6 rounded-md border border-gray-500/30 px-2 hover:bg-gray-500/10">{t("history.cancel")}</button>
        </div>
      )}


      {/* Toolbar: chats, undo, inline edit, skills, tools, overflow menu */}
      <div className="flex shrink-0 items-center gap-0.5 border-t border-gray-500/20 px-1.5 py-1">
        <IconButton tip={t("tb.new")} onClick={() => newChat(curProjectId)} disabled={!!busy}><IconPlus /></IconButton>
        <IconButton tip={t("tb.chats")} onClick={() => setSessionsOpen(true)} active={sessionsOpen}><IconFolder /></IconButton>
        <IconButton
          tip={isLinked() ? t("link.on") : t("link.off")}
          active={isLinked()}
          disabled={!!busy}
          onClick={() => { saveMsgs(activeIdRef.current, histRef.current); setLinked(!isLinked()); window.location.reload(); }}
        ><IconLink /></IconButton>
        <IconButton tip={undo.length ? t("tb.undo") + " · " + undo[undo.length - 1].label : t("tb.undoNone")} onClick={() => void undoLast()} disabled={!undo.length || !!busy}><IconUndo /></IconButton>
        <span className="mx-1 h-4 w-px bg-gray-500/25" aria-hidden />
        <IconButton tip={t("header.inline", { key: shortcutLabel })} onClick={() => void openInline()}><IconEdit /></IconButton>
        <IconButton tip={activeSkills.length ? t("header.skillsActive", { n: activeSkills.length }) : t("header.skills")} onClick={() => setSkillsOpen(true)} active={activeSkills.length > 0}><IconSkills /></IconButton>
        <IconButton tip={t("header.tools")} onClick={() => setTab(chat ? "tools" : "chat")} active={!chat}><IconTools /></IconButton>
        <span className="min-w-0 flex-1 truncate px-1.5 text-center text-[10.5px] text-gray-500" data-tip={t("ctx.meter", { n: fmtTok(tokens) })}>
          {(curProject ? curProject.name + " › " : "") + (chatTitle || t("chats.untitled"))}
          {msgs.length > 0 && <span className={"ml-1 " + (overLimit ? "font-semibold text-amber-600" : "opacity-70")}>≈{fmtTok(tokens)}</span>}
        </span>
        <IconButton tip={selectMode ? t("history.exitSelectMode") : t("history.selectMode")} onClick={() => (selectMode ? exitSelect() : setSelectMode(true))} disabled={!msgs.length} active={selectMode}><IconCheck /></IconButton>
        <IconButton tip={t("history.clearAll")} onClick={() => setConfirmClear(true)} disabled={!msgs.length} danger><IconTrash /></IconButton>
        <MoreMenu
          items={[
            { label: "📐 " + t("tb.rules"), onClick: () => setRulesModal({ kind: "global" }) },
            { label: "🧠 " + t("more.memory"), onClick: () => setMemoryOpen(true) },
            { label: "⚡ " + t("more.templates"), onClick: () => setTplOpen(true) },
            { label: "", onClick: () => {}, sep: true },
            { label: "⬇ " + t("more.export"), onClick: downloadMd, disabled: !msgs.length },
            { label: "⧉ " + t("more.copyMd"), onClick: copyMd, disabled: !msgs.length },
            { label: "📝 " + t("more.insertSummary"), onClick: () => startSummary("insert"), disabled: !msgs.length || !!busy || !!summarizing },
            { label: "↪ " + t("more.compress"), onClick: () => startSummary("compress"), disabled: !msgs.length || !!busy || !!summarizing },
            { label: "", onClick: () => {}, sep: true },
            { label: "📏 " + t("more.limit", { n: ws.tokenLimit ? `${ws.tokenLimit / 1000}k` : t("more.limitOff") }), onClick: cycleLimit },
          ]}
        />
      </div>

      {approval && chat && <ApprovalCard calls={approval.calls} onApply={() => answerApproval(true)} onReject={() => answerApproval(false)} />}
      {chat && proposals.map((p) => (
        <div key={p.id} className="animate-pop mx-2 mb-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[11px]">
          <span className="min-w-0 flex-1 break-words">🧠 {t("memory.propose")} <b>{p.note}</b></span>
          <button type="button" className="h-5 rounded-md bg-indigo-600 px-2 text-white hover:bg-indigo-500" onClick={() => saveNote(p)}>{t("memory.save")}</button>
          <button type="button" className="h-5 rounded-md border border-gray-500/30 px-2 hover:bg-gray-500/10" onClick={() => setProposals((l) => l.filter((x) => x.id !== p.id))}>{t("memory.skip")}</button>
        </div>
      ))}

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
              className={"inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium disabled:opacity-40 " + c.cls}
            >
              {t(`chip.${c.id}`)}
            </button>
          ))}
          {userTemplates.map((x: Template) => (
            <button
              key={x.id}
              type="button"
              disabled={!!busy || conn !== "open"}
              onClick={() => { setUseSelection(true); void send(x.prompt); }}
              data-tip={x.prompt.slice(0, 120)}
              className="inline-flex h-5 max-w-[120px] items-center rounded-full border border-violet-600/40 bg-violet-500/10 px-2 text-[11px] font-medium text-violet-700 hover:bg-violet-500/20 disabled:opacity-40 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-300 dark:hover:bg-violet-400/20"
            >
              <span className="truncate">{x.name}</span>
            </button>
          ))}
        </div>
        <div className="relative rounded-xl border border-gray-500/30 bg-gray-500/[0.04] focus-within:border-indigo-500/60 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,.12)]">
          {slashQ !== null && slashItems.length > 0 && (
            <div role="listbox" className="animate-pop absolute bottom-full left-0 z-50 mb-1 max-h-48 w-full overflow-y-auto rounded-xl border border-gray-500/25 bg-white p-1 shadow-xl dark:bg-[#1c1f24]">
              {slashItems.map((x, i) => (
                <button key={x.key} type="button" role="option" aria-selected={i === 0} onMouseDown={(e) => e.preventDefault()} onClick={() => pickSlash(x.prompt)} className={"block w-full rounded-md px-2 py-1 text-left hover:bg-gray-500/15 " + (i === 0 ? "bg-gray-500/10" : "")}>
                  <span className="block truncate text-[12px] font-medium">/{x.name}</span>
                  <span className="block truncate text-[10.5px] text-gray-500">{x.prompt}</span>
                </button>
              ))}
            </div>
          )}
          {att.length > 0 && (
            <div className="flex flex-wrap gap-1 px-1.5 pt-1.5">
              {att.map((a) => (
                <Pill
                  key={a.name}
                  tone={a.mode === "search" ? "accent" : "neutral"}
                  tip={a.mode === "search" ? t("att.pillSearch", { chars: (a.chars ?? 0).toLocaleString(), chunks: String(a.chunks ?? "?") }) : t("att.pillInline", { chars: (a.chars ?? a.text?.length ?? 0).toLocaleString() })}
                  onRemove={() => setAtt((l) => l.filter((x) => x.name !== a.name))}
                >
                  {a.mode === "search" ? "🔎" : "📎"} {a.name.slice(0, 26)}
                </Pill>
              ))}
            </div>
          )}
          <ImeTextarea
            ref={taRef}
            rows={5}
            onTextChange={(v) => { setHasInput(!!v.trim()); setSlashQ(v.startsWith("/") && !v.includes("\n") ? v.slice(1) : null); }}
            placeholder={t("composer.placeholder")}
            className="block min-h-[110px] w-full px-2.5 pb-1 pt-2 text-[13px] leading-[1.6] placeholder:text-gray-400"
            onKeyDown={(e) => {
              if (e.key === "Escape" && slashQ !== null) setSlashQ(null);
              if (e.key === "Enter" && !e.shiftKey && !isImeKey(e)) {
                e.preventDefault();
                if (slashQ !== null && slashItems.length) return pickSlash(slashItems[0].prompt);
                void send();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5">
            <ModelSelector models={models} current={modelCur} selected={modelSel} onSelect={selectModel} up />
            <ReasoningSelector level={ws.reasoning} onSelect={selectReasoning} />
            <ModeSelector mode={ws.mode} onSelect={changeMode} />
            {activeSkills.slice(0, 1).map((s) => (
              <Pill key={s} tone="accent" tip={s} onRemove={() => changeSkills(activeSkills.filter((n) => n !== s))}>{s}</Pill>
            ))}
            {activeSkills.length > 1 && <Pill tone="accent" onClick={() => setSkillsOpen(true)} tip={t("skills.manage")}>+{activeSkills.length - 1}</Pill>}
            <span className="flex-1" />
            <AttachMenu disabled={conn !== "open"} onFile={(f) => void addFile(f)} onLink={addLink} />
            <button
              type="button"
              onClick={() => safeSend({ type: "open_compose", target: "chat", lang })}
              data-tip={t("compose.open")}
              data-tip-up=""
              aria-label={t("compose.open")}
              className="inline-flex h-6 items-center justify-center rounded-md px-1.5 text-[11px] text-gray-500 hover:bg-gray-500/15"
            >
              ⌨ Web
            </button>
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

      <TooltipHost />
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
      {showAuth && (
        <LoginModal
          auth={auth}
          progress={progress}
          onLogin={startLogin}
          onCancel={() => safeSend({ type: "auth_cancel" })}
          onInstall={startInstall}
          onClose={() => { setAuthOpen(false); setAuthDismissed(true); }}
        />
      )}
      <SkillsDrawer
        details={skillDetails}
        onRequestDetail={(name) => safeSend({ type: "get_skill", name })}
        open={skillsOpen}
        skills={skills}
        active={activeSkills}
        onChange={changeSkills}
        onRefresh={() => safeSend({ type: "list_skills" })}
        onCreate={() => setSkillCreate({ open: true, busy: false, error: null })}
        onClose={() => setSkillsOpen(false)}
      />
      {sessionsOpen && (
        <SessionsDrawer
          chats={ws.chats}
          projects={ws.projects}
          activeId={ws.activeId}
          busy={!!busy}
          onSelect={(id) => { switchTo(id); setSessionsOpen(false); setTab("chat"); }}
          onNew={newChat}
          onRename={(id, title) => updateWs((w) => ({ ...w, chats: w.chats.map((c) => (c.id === id ? { ...c, title } : c)) }))}
          onDelete={deleteChat}
          onNewProject={() => setRulesModal({ kind: "project", id: "new" })}
          onEditProject={(id) => setRulesModal({ kind: "project", id })}
          onDeleteProject={deleteProject}
          onClose={() => setSessionsOpen(false)}
        />
      )}
      {rulesModal && (() => {
        const proj = rulesModal.kind === "project" && rulesModal.id !== "new" ? ws.projects.find((p) => p.id === rulesModal.id) : undefined;
        if (rulesModal.kind === "project" && rulesModal.id !== "new" && !proj) return null;
        return rulesModal.kind === "global" ? (
          <RulesModal title={t("rules.globalTitle")} hint={t("rules.globalHint")} rules={ws.globalRules} onSave={saveRules} onClose={() => setRulesModal(null)} />
        ) : (
          <RulesModal
            title={proj ? t("rules.projectTitle") + ": " + proj.name : t("rules.newProjectTitle")}
            hint={t("rules.projectHint")}
            name={proj?.name ?? ""}
            rules={proj?.rules ?? ""}
            onSave={saveRules}
            onClose={() => setRulesModal(null)}
          />
        );
      })()}
      {memoryOpen && (
        <MemoryModal
          globalNotes={ws.memory}
          project={curProject ? { name: curProject.name, notes: curProject.memory } : undefined}
          onGlobal={(n) => updateWs((w) => ({ ...w, memory: n }))}
          onProject={(n) => updateWs((w) => ({ ...w, projects: w.projects.map((p) => (p.id === curProjectId ? { ...p, memory: n } : p)) }))}
          onClose={() => setMemoryOpen(false)}
        />
      )}
      {tplOpen && <TemplatesModal templates={ws.templates} projectId={curProjectId} projectName={curProject?.name} onChange={(tp) => updateWs((w) => ({ ...w, templates: tp }))} onClose={() => setTplOpen(false)} />}
      {skillCreate.open && (
        <SkillCreateModal busy={skillCreate.busy} error={skillCreate.error} onCreate={createSkill} onClose={() => setSkillCreate({ open: false, busy: false, error: null })} />
      )}
      <InlineEdit
        state={inline}
        incoming={composeIn}
        onCompose={() => safeSend({ type: "open_compose", target: "inline", lang })}
        onSubmit={submitInline}
        onAccept={() => void applyInline(inline.output)}
        onCancel={cancelInline}
        onClose={closeInline}
      />
    </div>
  );
}
