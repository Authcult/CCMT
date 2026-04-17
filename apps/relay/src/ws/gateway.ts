import type { Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { makeFrame, parseFrame, type Actor, type Frame } from "@ccmt/protocol";
import { getUpgradeToken, verifyAgentToken, verifyWsTicket } from "../auth/jwt";
import type { AuthService, AgentTokenClaims, WsTicketClaims } from "../auth/service";
import { MemoryStore } from "../store/memory";

type GatewayConfig = {
  server: Server;
  wsPath: string;
  store: MemoryStore;
  authService: AuthService;
  logger: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
};

function sendFrame(socket: WebSocket, frame: Frame): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(frame));
}

function relayStateFrame(sessionId: string, state: "connecting" | "ready" | "disconnected", detail?: string): Frame {
  return makeFrame({
    sessionId,
    from: "relay",
    target: "web",
    body: {
      type: "session.state",
      payload: { state, detail },
    },
  });
}

function relayErrorFrame(sessionId: string, code: string, message: string): Frame {
  return makeFrame({
    sessionId,
    from: "relay",
    target: "web",
    body: {
      type: "session.error",
      payload: { code, message },
    },
  });
}

function forwardToWebClients(store: MemoryStore, sessionId: string, frame: Frame): void {
  for (const client of store.getWebClients(sessionId)) {
    sendFrame(client, frame);
  }
}

function isTerminalOutputFrame(frame: Frame): frame is Frame & { type: "terminal.output"; payload: { data: string; stream: "stdout" | "stderr" } } {
  return frame.type === "terminal.output";
}

function isTerminalExitFrame(frame: Frame): frame is Frame & { type: "terminal.exit"; payload: { code: number | null; reason?: string } } {
  return frame.type === "terminal.exit";
}

function appendSessionEvent(store: MemoryStore, sessionId: string, frame: Frame): void {
  if (isTerminalOutputFrame(frame)) {
    store.appendSessionOutput(sessionId, frame.payload.data);
    return;
  }

  if (isTerminalExitFrame(frame)) {
    const reason = frame.payload.reason ? ` (${frame.payload.reason})` : "";
    store.appendSessionOutput(sessionId, `\r\n[process exited: ${frame.payload.code ?? "null"}${reason}]\r\n`);
  }
}

function normalizeFrameRole(frame: Frame, from: Actor, target: Actor): Frame {
  return {
    ...frame,
    from,
    target,
  };
}

export function setupGateway(config: GatewayConfig): void {
  const wss = new WebSocketServer({ noServer: true });

  function onAgentConnected(socket: WebSocket, targetId: string, agentId: string): void {
    config.store.registerTarget(targetId, agentId, socket);
    config.logger.info({ targetId, agentId }, "agent connected");

    for (const session of config.store.getSessionsByTarget(targetId)) {
      config.store.setSessionState(session.id, "ready");
      forwardToWebClients(config.store, session.id, relayStateFrame(session.id, "ready"));
    }

    socket.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString();

      try {
        const parsed = parseFrame(JSON.parse(text));
        const session = config.store.ensureSession(parsed.sessionId, targetId);
        config.store.setSessionState(session.id, "ready");

        const normalized = normalizeFrameRole(parsed, "agent", "web");
        appendSessionEvent(config.store, session.id, normalized);
        forwardToWebClients(config.store, session.id, normalized);
      } catch (error) {
        config.logger.warn({ error, targetId }, "failed to parse frame from agent");
      }
    });

    socket.on("close", () => {
      config.store.unregisterTarget(targetId, socket);
      config.logger.info({ targetId, agentId }, "agent disconnected");

      for (const session of config.store.getSessionsByTarget(targetId)) {
        config.store.setSessionState(session.id, "disconnected");
        forwardToWebClients(config.store, session.id, relayStateFrame(session.id, "disconnected", "target offline"));
      }
    });
  }

  function onWebConnected(socket: WebSocket, sessionId: string, targetId?: string): void {
    let session = config.store.getSession(sessionId);

    if (!session) {
      const fallbackTargetId = targetId ?? config.store.listTargets()[0]?.id;
      if (!fallbackTargetId) {
        socket.send(JSON.stringify(relayErrorFrame(sessionId, "no_target", "No online target available")));
        socket.close(4404, "No target available");
        return;
      }

      session = config.store.createSession(fallbackTargetId, sessionId);
    }

    config.store.addWebClient(session.id, socket);

    const targetOnline = Boolean(config.store.getTarget(session.targetId));
    const state = targetOnline ? "ready" : "connecting";
    config.store.setSessionState(session.id, state);
    sendFrame(socket, relayStateFrame(session.id, state));
    const scrollback = config.store.getSessionScrollback(session.id);
    if (scrollback) {
      sendFrame(
        socket,
        makeFrame({
          sessionId: session.id,
          from: "relay",
          target: "web",
          body: {
            type: "terminal.output",
            payload: { data: scrollback, stream: "stdout" },
          },
        }),
      );
    }

    socket.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString();

      try {
        const parsed = parseFrame(JSON.parse(text));
        const latestSession = config.store.getSession(parsed.sessionId);
        if (!latestSession) {
          sendFrame(socket, relayErrorFrame(parsed.sessionId, "session_missing", "Session not found"));
          return;
        }

        const target = config.store.getTarget(latestSession.targetId);
        if (!target) {
          config.store.setSessionState(latestSession.id, "disconnected");
          sendFrame(socket, relayStateFrame(latestSession.id, "disconnected", "target offline"));
          return;
        }

        const normalized = normalizeFrameRole(parsed, "web", "agent");
        sendFrame(target.socket, normalized);
      } catch (error) {
        config.logger.warn({ error, sessionId }, "failed to parse frame from web");
        sendFrame(socket, relayErrorFrame(sessionId, "invalid_frame", "Could not parse frame"));
      }
    });

    socket.on("close", () => {
      config.store.removeWebClient(session.id, socket);
    });
  }

  config.server.on("upgrade", (request, socket, head) => {
    const requestUrl = request.url ?? "";
    const url = new URL(requestUrl, "http://localhost");

    if (url.pathname !== config.wsPath) {
      return;
    }

    const role = url.searchParams.get("role");
    if (role !== "agent" && role !== "web") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const token = getUpgradeToken(request, url.searchParams);
    if (role === "agent") {
      const claims = verifyAgentToken(token, config.authService);
      if (!claims) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        handleAgentUpgrade(ws, url, claims);
      });
      return;
    }

    const wsClaims = verifyWsTicket(token, config.authService);
    if (!wsClaims) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      handleWebUpgrade(ws, url, wsClaims);
    });
  });

  function handleAgentUpgrade(ws: WebSocket, url: URL, claims: AgentTokenClaims): void {
    const targetId = url.searchParams.get("targetId") ?? claims.targetId;
    const agentId = url.searchParams.get("agentId") ?? claims.sub;
    if (!targetId) {
      ws.close(4400, "targetId required");
      return;
    }

    if (targetId !== claims.targetId) {
      ws.close(4403, "target mismatch");
      return;
    }

    onAgentConnected(ws, targetId, agentId);
  }

  function handleWebUpgrade(ws: WebSocket, url: URL, claims: WsTicketClaims): void {
    const sessionId = url.searchParams.get("sessionId") ?? claims.sessionId;
    if (!sessionId) {
      ws.close(4400, "sessionId required");
      return;
    }

    const targetId = url.searchParams.get("targetId") ?? claims.targetId;
    onWebConnected(ws, sessionId, targetId ?? undefined);
  }
}
