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

export interface Project {
  id: string;
  name: string;
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
}

const WS_KEY = "hermes_office_workspace_v1";
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
    const raw = JSON.parse(localStorage.getItem(WS_KEY) || "null");
    if (raw && Array.isArray(raw.chats) && raw.chats.length && Array.isArray(raw.projects)) {
      const ws: Workspace = {
        chats: raw.chats,
        projects: raw.projects.map((p: Project) => ({ ...p, skills: Array.isArray(p.skills) ? p.skills : [] })),
        activeId: raw.chats.some((c: ChatMeta) => c.id === raw.activeId) ? raw.activeId : raw.chats[0].id,
        globalRules: typeof raw.globalRules === "string" ? raw.globalRules : "",
        reasoning: typeof raw.reasoning === "string" ? raw.reasoning : null,
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
  return { chats: [first], projects: [], activeId: first.id, globalRules: "", reasoning: null };
}

export function saveWorkspace(ws: Workspace): void {
  try {
    localStorage.setItem(WS_KEY, JSON.stringify(ws));
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
