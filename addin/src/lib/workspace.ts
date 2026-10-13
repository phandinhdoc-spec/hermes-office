/** Chats ("sessions") and projects, persisted in localStorage. Each chat's messages live under their own key. */

export interface Msg {
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

export interface Note { id: string; text: string }
export interface Template { id: string; name: string; prompt: string; /** null = every chat */ projectId: string | null }
/** Metadata only: the text lives on the bridge (RAM + disk) under `doc_id`. `text` exists only on entries saved by older builds. */
export interface Attachment { name: string; doc_id?: string; chars?: number; chunks?: number; mode?: "inline" | "search"; text?: string }
export type Mode = "auto" | "approve" | "readonly";

export interface Project {
  id: string;
  name: string;
  /** Facts the user confirmed for this project's chats. */
  memory: Note[];
  /** Extra rules appended to every request made from this project's chats. */
  rules: string;
  /** Skills activated when entering the project. */
  skills: string[];
}

export interface ChatMeta {
  id: string;
  title: string;
  projectId: string | null;
  updated: number;
}

export interface Workspace {
  chats: ChatMeta[];
  projects: Project[];
  activeId: string;
  globalRules: string;
  reasoning: string | null;
  templates: Template[];
  memory: Note[];
  /** How often each skill was switched on, to rank the `/` menu. */
  skillUse: Record<string, number>;
  /** Skills created from this add-in, flagged "yours" in the `/` menu. */
  createdSkills: string[];
  /** Estimated tokens after which a long chat is flagged; 0 = never. */
  tokenLimit: number;
  mode: Mode;
}

import { currentHost } from "../office/host";

const OLD_WS_KEY = "hermes_office_workspace_v1"; // single workspace shared by every Office app (earlier build)
const LINK_KEY = "hermes_office_link";

/** Word/Excel/PowerPoint share one origin and therefore one localStorage; chats are kept per app unless the user links them. */
export const isLinked = (): boolean => {
  try {
    return localStorage.getItem(LINK_KEY) === "1";
  } catch {
    return false;
  }
};
export function setLinked(on: boolean): void {
  try {
    if (on) localStorage.setItem(LINK_KEY, "1");
    else localStorage.removeItem(LINK_KEY);
  } catch {
    /* ignore */
  }
}
const wsKey = () => `hermes_office_workspace_v2:${isLinked() ? "shared" : currentHost()}`;
const LEGACY_KEY = "hermes_office_chat_history"; // single-chat history of earlier builds
const chatKey = (id: string) => `hermes_office_chat_${id}`;
export const HISTORY_MAX = 300;

export const uid = () => crypto.randomUUID().slice(0, 8);

export function newChatMeta(projectId: string | null = null): ChatMeta {
  return { id: uid(), title: "", projectId, updated: Date.now() };
}

export function loadMsgs(id: string, legacy = false): Msg[] {
  try {
    const raw = JSON.parse(localStorage.getItem(legacy ? LEGACY_KEY : chatKey(id)) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((m) => m && typeof m.id === "string" && (m.role === "user" || m.role === "assistant" || m.role === "tool") && typeof m.text === "string")
      .map((m: Msg) => (m.pending ? { ...m, pending: false, ok: false } : m));
  } catch {
    return [];
  }
}

export function saveMsgs(id: string, msgs: Msg[]): void {
  try {
    if (!msgs.length) localStorage.removeItem(chatKey(id));
    else localStorage.setItem(chatKey(id), JSON.stringify(msgs.slice(-HISTORY_MAX).map((m) => (m.pending ? { ...m, pending: false, ok: false } : m))));
  } catch {
    /* storage unavailable or full in some Office webviews */
  }
}

export function removeMsgs(id: string): void {
  try {
    localStorage.removeItem(chatKey(id));
  } catch {
    /* ignore */
  }
}

export function loadWorkspace(): Workspace {
  try {
    let raw = JSON.parse(localStorage.getItem(wsKey()) || "null");
    if (!raw) {
      // Adopt the earlier single workspace once, into whichever app opens first.
      raw = JSON.parse(localStorage.getItem(OLD_WS_KEY) || "null");
      if (raw) localStorage.removeItem(OLD_WS_KEY);
    }
    if (raw && Array.isArray(raw.chats) && raw.chats.length && Array.isArray(raw.projects)) {
      const ws: Workspace = {
        chats: raw.chats,
        projects: raw.projects.map((p: Project) => ({ ...p, skills: Array.isArray(p.skills) ? p.skills : [], memory: Array.isArray(p.memory) ? p.memory : [] })),
        activeId: raw.chats.some((c: ChatMeta) => c.id === raw.activeId) ? raw.activeId : raw.chats[0].id,
        globalRules: typeof raw.globalRules === "string" ? raw.globalRules : "",
        reasoning: typeof raw.reasoning === "string" ? raw.reasoning : null,
        templates: Array.isArray(raw.templates) ? raw.templates : [],
        memory: Array.isArray(raw.memory) ? raw.memory : [],
        skillUse: raw.skillUse && typeof raw.skillUse === "object" ? raw.skillUse : {},
        createdSkills: Array.isArray(raw.createdSkills) ? raw.createdSkills : [],
        tokenLimit: typeof raw.tokenLimit === "number" ? raw.tokenLimit : 40000,
        mode: raw.mode === "approve" || raw.mode === "readonly" ? raw.mode : "auto",
      };
      return ws;
    }
  } catch {
    /* fall through to a fresh workspace */
  }
  // First run of this build: adopt the old single conversation, if any.
  const first = newChatMeta();
  const legacy = loadMsgs("", true);
  if (legacy.length) {
    saveMsgs(first.id, legacy);
    first.title = titleFrom(legacy);
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* ignore */
    }
  }
  return { chats: [first], projects: [], activeId: first.id, globalRules: "", reasoning: null, templates: [], memory: [], skillUse: {}, createdSkills: [], tokenLimit: 40000, mode: "auto" };
}

export function saveWorkspace(ws: Workspace): void {
  try {
    localStorage.setItem(wsKey(), JSON.stringify(ws));
  } catch {
    /* ignore */
  }
}

export function titleFrom(msgs: Msg[]): string {
  const u = msgs.find((m) => m.role === "user");
  return u ? u.text.replace(/^\[[^\]]+\]\s*/, "").replace(/\s+/g, " ").trim().slice(0, 40) : "";
}

/** Rules sent to the bridge: global first, then the active project's. */
export function effectiveRules(ws: Workspace): string {
  const chat = ws.chats.find((c) => c.id === ws.activeId);
  const proj = chat?.projectId ? ws.projects.find((p) => p.id === chat.projectId) : undefined;
  return [ws.globalRules.trim(), proj?.rules.trim()].filter(Boolean).join("\n\n");
}

const notesText = (n: Note[]) => n.map((x) => `- ${x.text}`).join("\n");

/** Confirmed notes sent to the bridge: global first, then the active project's. */
export function effectiveMemory(ws: Workspace): string {
  const chat = ws.chats.find((c) => c.id === ws.activeId);
  const proj = chat?.projectId ? ws.projects.find((p) => p.id === chat.projectId) : undefined;
  return [notesText(ws.memory), proj ? notesText(proj.memory) : ""].filter(Boolean).join("\n");
}

// ---- attachments (kept per chat; the bridge only extracts text) --------------------------------
const attKey = (id: string) => `hermes_office_att_${id}`;
export function loadAtt(id: string): Attachment[] {
  try {
    const v = JSON.parse(localStorage.getItem(attKey(id)) || "[]");
    return Array.isArray(v) ? v.filter((a) => a && typeof a.name === "string" && (typeof a.doc_id === "string" || typeof a.text === "string")) : [];
  } catch {
    return [];
  }
}
export function saveAtt(id: string, list: Attachment[]): boolean {
  try {
    if (!list.length) localStorage.removeItem(attKey(id));
    else localStorage.setItem(attKey(id), JSON.stringify(list));
    return true;
  } catch {
    return false; // storage quota: the attachments stay in memory until the taskpane closes
  }
}

/** Rough token estimate (Vietnamese and English average ~3.2 chars/token). */
export const estimateTokens = (chars: number) => Math.ceil(chars / 3.2);

export function chatTokens(msgs: Msg[], rules: string, memory: string, att: Attachment[]): number {
  const chars = msgs.reduce((n, m) => n + (m.role === "tool" ? 200 : m.text.length), 0) + rules.length + memory.length + att.reduce((n, a) => n + (a.mode === "search" ? 1800 : a.chars ?? a.text?.length ?? 0), 0);
  return estimateTokens(chars) + 1800; // system preamble + tool list
}

export function toMarkdown(title: string, msgs: Msg[]): string {
  const body = msgs
    .filter((m) => m.role !== "tool" && m.text.trim())
    .map((m) => `### ${m.role === "user" ? "Bạn" : "Hermes"}\n\n${m.text.replace(/```office-memory[\s\S]*?```/g, "").trim()}`)
    .join("\n\n");
  return `# ${title || "Hộp thoại Hermes"}\n\n_Xuất ngày ${new Date().toLocaleString("vi-VN")}_\n\n${body}\n`;
}

/** Fill {vùng chọn}/{selection}, {ngày}/{date}, {tên file}/{file}, {ứng dụng}/{app}. */
export function fillTemplate(prompt: string, v: { selection: string; file: string; app: string }): string {
  const d = new Date().toLocaleDateString("vi-VN");
  return prompt
    .replace(/\{(vùng chọn|selection)\}/gi, v.selection)
    .replace(/\{(ngày|date)\}/gi, d)
    .replace(/\{(tên file|file)\}/gi, v.file)
    .replace(/\{(ứng dụng|app)\}/gi, v.app);
}
