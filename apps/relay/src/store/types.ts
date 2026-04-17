import type WebSocket from "ws";

export type SessionState = "connecting" | "ready" | "disconnected";

export type TargetRecord = {
  id: string;
  agentId: string;
  connectedAt: number;
  socket: WebSocket;
};

export type SessionRecord = {
  id: string;
  targetId: string;
  createdAt: number;
  state: SessionState;
  scrollback: string[];
  scrollbackBytes: number;
};
