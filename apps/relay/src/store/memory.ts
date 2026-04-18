import type WebSocket from "ws";
import type { SessionRecord, SessionState, TargetRecord } from "./types";
import type { PersistedStoreState } from "../persistence/file-state";

const MAX_SCROLLBACK_BYTES = 256 * 1024;

type MemoryStoreOptions = {
  onDirty?: () => void;
};

function makeSessionId(): string {
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSessionRecord(targetId: string, state: SessionState, id: string): SessionRecord {
  return {
    id,
    targetId,
    createdAt: Date.now(),
    state,
    scrollback: [],
    scrollbackBytes: 0,
  };
}

function recomputeScrollbackBytes(session: SessionRecord): void {
  session.scrollbackBytes = session.scrollback.reduce((total, chunk) => total + Buffer.byteLength(chunk, "utf8"), 0);
}

function trimScrollback(session: SessionRecord): void {
  while (session.scrollbackBytes > MAX_SCROLLBACK_BYTES && session.scrollback.length > 1) {
    const removed = session.scrollback.shift();
    if (!removed) {
      break;
    }

    session.scrollbackBytes -= Buffer.byteLength(removed, "utf8");
  }
}

export class MemoryStore {
  private readonly targets = new Map<string, TargetRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly webClients = new Map<string, Set<WebSocket>>();
  private onDirty?: () => void;

  constructor(options: MemoryStoreOptions = {}) {
    this.onDirty = options.onDirty;
  }

  setOnDirty(onDirty?: () => void): void {
    this.onDirty = onDirty;
  }

  exportState(): PersistedStoreState {
    return {
      sessions: this.listSessions().map((session) => ({
        id: session.id,
        targetId: session.targetId,
        createdAt: session.createdAt,
        state: session.state,
        scrollback: [...session.scrollback],
      })),
    };
  }

  importState(state: PersistedStoreState): void {
    this.sessions.clear();

    const restored = [...state.sessions].sort((a, b) => a.createdAt - b.createdAt);
    for (const session of restored) {
      if (this.sessions.has(session.id)) {
        continue;
      }

      const record: SessionRecord = {
        id: session.id,
        targetId: session.targetId,
        createdAt: session.createdAt,
        state: this.targets.has(session.targetId) ? "ready" : "connecting",
        scrollback: [...session.scrollback],
        scrollbackBytes: 0,
      };
      recomputeScrollbackBytes(record);
      trimScrollback(record);
      recomputeScrollbackBytes(record);
      this.sessions.set(record.id, record);
    }
  }

  private markDirty(): void {
    this.onDirty?.();
  }

  registerTarget(targetId: string, agentId: string, socket: WebSocket): TargetRecord {
    const record: TargetRecord = { id: targetId, agentId, connectedAt: Date.now(), socket };
    this.targets.set(targetId, record);
    return record;
  }

  unregisterTarget(targetId: string, socket?: WebSocket): void {
    const current = this.targets.get(targetId);
    if (!current) {
      return;
    }

    if (socket && current.socket !== socket) {
      return;
    }

    this.targets.delete(targetId);
  }

  getTarget(targetId: string): TargetRecord | undefined {
    return this.targets.get(targetId);
  }

  listTargets(): Array<Omit<TargetRecord, "socket">> {
    return Array.from(this.targets.values()).map((target) => ({
      id: target.id,
      agentId: target.agentId,
      connectedAt: target.connectedAt,
    }));
  }

  createSession(targetId: string, requestedId?: string): SessionRecord {
    const id = requestedId ?? makeSessionId();
    const existing = this.sessions.get(id);

    if (existing) {
      return existing;
    }

    const state: SessionState = this.targets.has(targetId) ? "ready" : "connecting";
    const session = makeSessionRecord(targetId, state, id);

    this.sessions.set(id, session);
    this.markDirty();
    return session;
  }

  ensureSession(sessionId: string, targetId: string): SessionRecord {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    return this.createSession(targetId, sessionId);
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): SessionRecord[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getSessionsByTarget(targetId: string): SessionRecord[] {
    return this.listSessions().filter((session) => session.targetId === targetId);
  }

  setSessionState(sessionId: string, state: SessionState): SessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    if (session.state === state) {
      return session;
    }

    session.state = state;
    this.markDirty();
    return session;
  }

  appendSessionOutput(sessionId: string, chunk: string): SessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || chunk.length === 0) {
      return session;
    }

    session.scrollback.push(chunk);
    session.scrollbackBytes += Buffer.byteLength(chunk, "utf8");
    trimScrollback(session);
    recomputeScrollbackBytes(session);
    this.markDirty();
    return session;
  }

  getSessionScrollback(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    return session ? session.scrollback.join("") : "";
  }

  addWebClient(sessionId: string, socket: WebSocket): void {
    const clients = this.webClients.get(sessionId) ?? new Set<WebSocket>();
    clients.add(socket);
    this.webClients.set(sessionId, clients);
  }

  removeWebClient(sessionId: string, socket: WebSocket): void {
    const clients = this.webClients.get(sessionId);
    if (!clients) {
      return;
    }

    clients.delete(socket);
    if (clients.size === 0) {
      this.webClients.delete(sessionId);
    }
  }

  getWebClients(sessionId: string): WebSocket[] {
    return Array.from(this.webClients.get(sessionId) ?? []);
  }

  factoryReset(): void {
    this.targets.clear();
    this.sessions.clear();
    this.webClients.clear();
    this.markDirty();
  }
}

export { MAX_SCROLLBACK_BYTES };
