import { callTool } from "../office/tools";

export interface HermesStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface AuthInfo {
  hermes: HermesStatus;
  agy: { installed: boolean; path: string | null };
  logged_in: boolean;
  account: string | null;
  provider: string;
  models: { core: string | null; fast: string | null };
  login_running: boolean;
  install_running: boolean;
  /** Antigravity plugin of Hermes, enabled automatically once agy is installed. */
  plugin?: { name: string | null; enabled: boolean };
}

export type BridgeEvent =
  | ({ type: "auth_status" } & AuthInfo)
  | { type: "auth_progress"; stage: string; line: string; url?: string; ok?: boolean; manual?: boolean; cancelled?: boolean; timeout?: boolean; error?: string }
  | { type: "plugin_progress"; stage: string; line: string; plugin?: string; ok?: boolean; needs?: "hermes" | "agy"; timeout?: boolean; error?: string }
  | { type: "compose"; target: "chat" | "inline"; text: string }
  | { type: "status"; hermes: HermesStatus; tools: string[] }
  | { type: "delta"; id: string; text: string }
  | { type: "tool_call"; id: string; tool: string; args: unknown }
  | { type: "tool_result"; id: string; tool: string; ok: boolean; result: unknown; direct?: boolean }
  | { type: "models"; models: ModelOption[]; current: { model: string | null; provider: string | null }; selected: { model: string | null; provider: string | null } }
  | { type: "skills"; skills: SkillInfo[]; active: string[] }
  | { type: "skills_active"; active: string[] }
  | { type: "reasoning"; level: string | null; levels: string[] }
  | { type: "skill_created"; ok: boolean; name: string; message?: string; path?: string }
  | { type: "skill_detail"; skill: SkillDetail | null; name?: string }
  | { type: "tools_info"; office: OfficeToolInfo[]; hermes: ToolsetInfo[] }
  | { type: "done"; id: string; cancelled?: boolean }
  | { type: "error"; id?: string; message: string; code?: string };

export interface ModelOption {
  id: string;
  provider: string | null;
  label: string;
  /** "core" = main reasoning model, "fast" = low-latency interactive model */
  role?: "core" | "fast";
}
export interface SkillInfo {
  name: string;
  category: string;
  source: string;
  enabled: boolean;
  note?: string;
  description_en?: string;
  description_vi?: string;
}
export interface SkillDetail {
  name: string;
  category: string;
  path: string;
  description_en: string;
  description_vi: string;
  translated: boolean;
  tags: string[];
  version: string;
  purpose: string;
  explanation: string;
  usage: string;
  content: string;
  body: string;
}
export interface OfficeToolInfo {
  name: string;
  host: string;
  args: Record<string, string>;
}
export interface ToolsetInfo {
  name: string;
  enabled: boolean;
  label: string;
}

const PORT = import.meta.env.VITE_BRIDGE_PORT ?? "8765";
const URLS: string[] = import.meta.env.VITE_BRIDGE_URL
  ? [import.meta.env.VITE_BRIDGE_URL]
  : [`wss://127.0.0.1:${PORT}/ws`, `wss://localhost:${PORT}/ws`, `ws://127.0.0.1:${PORT}/ws`];

export type ConnState = "connecting" | "open" | "closed";

/** Reconnecting WebSocket client; answers the bridge's rpc_request frames with Office.js calls. */
export class BridgeClient {
  private ws?: WebSocket;
  private urlIdx = 0;
  private retry = 0;
  private stopped = false;

  constructor(
    private onEvent: (e: BridgeEvent) => void,
    private onState: (s: ConnState) => void,
  ) {}

  connect(): void {
    this.stopped = false;
    this.onState("connecting");
    const ws = new WebSocket(URLS[this.urlIdx % URLS.length]);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.retry = 0;
      this.onState("open");
    };
    ws.onmessage = (ev) => this.handle(JSON.parse(ev.data));
    ws.onclose = () => {
      this.onState("closed");
      if (this.stopped) return;
      if (!opened) this.urlIdx++; // try the next candidate URL
      setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retry++, 10000));
    };
    ws.onerror = () => ws.close();
  }

  close(): void {
    this.stopped = true;
    this.ws?.close();
  }

  send(msg: object): void {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new Error("Bridge not connected");
    this.ws.send(JSON.stringify(msg));
  }

  private async handle(msg: any): Promise<void> {
    if (msg.type === "rpc_request") {
      try {
        const result = await callTool(msg.tool, msg.args);
        this.send({ type: "rpc_result", id: msg.id, result });
      } catch (e) {
        this.send({ type: "rpc_result", id: msg.id, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    this.onEvent(msg as BridgeEvent);
  }
}
