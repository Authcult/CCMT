"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Terminal, AlertCircle } from "lucide-react";
import { makeFrame, parseFrame } from "@ccmt/protocol";
import { TerminalControls } from "../../../components/TerminalControls";
import { buildWebSocketUrl, refreshToken, reissueSessionTicket } from "../../../lib/relaySocket";
import { getAccessToken, getRefreshToken, setAuthTokens } from "../../../lib/auth";
import { useI18n } from "../../../components/I18nProvider";

const TerminalViewport = dynamic(() => import("../../../components/TerminalViewport").then((mod) => mod.TerminalViewport), { ssr: false });

type ConnectionState = "connecting" | "ready" | "disconnected";

type WsContext = {
  wsUrl: string;
  sessionId: string;
  targetId?: string;
};

export default function TerminalPage() {
  const { t } = useI18n();
  const params = useParams<{ sessionId: string }>();
  const searchParams = useSearchParams();
  const routeSessionId = params.sessionId;

  const socketRef = useRef<WebSocket | null>(null);
  const writeRef = useRef<((chunk: string) => void) | null>(null);
  const pendingOutputRef = useRef<string[]>([]);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectAttemptRef = useRef(0);
  const latestSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [errorText, setErrorText] = useState<string | null>(null);
  const wsContextRef = useRef<WsContext | null>(null);

  const ticketFromUrl = searchParams.get("ticket") ?? undefined;
  const targetIdFromUrl = searchParams.get("targetId") ?? undefined;

  const ensureWsContext = useCallback(async (): Promise<WsContext> => {
    if (wsContextRef.current) {
      return wsContextRef.current;
    }

    const buildContext = (wsTicket: string, targetId?: string): WsContext => ({
      wsUrl: buildWebSocketUrl(routeSessionId, wsTicket, targetId),
      sessionId: routeSessionId,
      targetId,
    });

    const createContextFromAccessToken = async (accessToken: string): Promise<WsContext> => {
      const sessionResult = await reissueSessionTicket(accessToken, routeSessionId, targetIdFromUrl || undefined);
      return buildContext(sessionResult.wsTicket, sessionResult.session.targetId);
    };

    const accessToken = getAccessToken();
    if (accessToken) {
      try {
        const context = await createContextFromAccessToken(accessToken);
        wsContextRef.current = context;
        return context;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "unauthorized") {
          throw error;
        }
      }

      const refresh = getRefreshToken();
      if (!refresh) {
        throw new Error("unauthorized");
      }

      const tokens = await refreshToken(refresh);
      setAuthTokens(tokens.accessToken, tokens.refreshToken);
      const context = await createContextFromAccessToken(tokens.accessToken);
      wsContextRef.current = context;
      return context;
    }

    if (ticketFromUrl) {
      const context = buildContext(ticketFromUrl, targetIdFromUrl);
      wsContextRef.current = context;
      return context;
    }

    throw new Error("missing_access_token");
  }, [routeSessionId, targetIdFromUrl, ticketFromUrl]);

  const appendOutput = useCallback((chunk: string) => {
    const writer = writeRef.current;
    if (writer) {
      writer(chunk);
      return;
    }

    pendingOutputRef.current.push(chunk);
  }, []);

  const sendFrame = useCallback(
    (
      body:
        | { type: "terminal.input"; payload: { data: string } }
        | { type: "terminal.resize"; payload: { cols: number; rows: number } }
        | { type: "terminal.signal"; payload: { signal: "SIGINT" | "SIGTERM" } },
    ) => {
      const socket = socketRef.current;
      const sessionId = wsContextRef.current?.sessionId ?? routeSessionId;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const frame = makeFrame({
        sessionId,
        from: "web",
        target: "agent",
        body,
      });

      socket.send(JSON.stringify(frame));
    },
    [routeSessionId],
  );

  const connect = useCallback(async () => {
    if (socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const attempt = connectAttemptRef.current + 1;
    connectAttemptRef.current = attempt;
    setConnectionState("connecting");
    setErrorText(null);

    const context = await ensureWsContext();
    if (attempt !== connectAttemptRef.current) {
      return;
    }

    const socket = new WebSocket(context.wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) {
        return;
      }

      setConnectionState("ready");
      appendOutput("\r\n[relay] connected\r\n");

      const latestSize = latestSizeRef.current;
      if (latestSize) {
        sendFrame({
          type: "terminal.resize",
          payload: { cols: latestSize.cols, rows: latestSize.rows },
        });
      }
    };

    socket.onmessage = (event) => {
      if (socketRef.current !== socket) {
        return;
      }

      try {
        const frame = parseFrame(JSON.parse(event.data as string));

        if (frame.type === "terminal.output") {
          appendOutput(frame.payload.data);
          return;
        }

        if (frame.type === "session.state") {
          setConnectionState(frame.payload.state);
          if (frame.payload.detail) {
            appendOutput(`\r\n[relay] ${frame.payload.detail}\r\n`);
          }
          return;
        }

        if (frame.type === "session.error") {
          appendOutput(`\r\n[error] ${frame.payload.code}: ${frame.payload.message}\r\n`);
        }
      } catch {
        appendOutput("\r\n[error] invalid frame received\r\n");
      }
    };

    socket.onclose = () => {
      if (socketRef.current !== socket) {
        return;
      }

      socketRef.current = null;
      setConnectionState("disconnected");
      appendOutput("\r\n[relay] disconnected\r\n");
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }

      reconnectTimerRef.current = window.setTimeout(() => {
        void connectRef.current();
      }, 1500);
    };

    socket.onerror = async () => {
      if (socketRef.current !== socket) {
        return;
      }

      setConnectionState("disconnected");

      const refresh = getRefreshToken();
      if (!refresh) {
        return;
      }

      try {
        const tokens = await refreshToken(refresh);
        setAuthTokens(tokens.accessToken, tokens.refreshToken);
      } catch {
        // ignore refresh failures here; UI remains disconnected
      }
    };
  }, [appendOutput, ensureWsContext, sendFrame]);

  const connectRef = useRef(connect);
  connectRef.current = connect;

  const doConnect = useCallback(() => {
    void connectRef.current();
  }, []);

  useEffect(() => {
    doConnect();

    return () => {
      connectAttemptRef.current += 1;

      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }

      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState <= WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [doConnect]);

  const handleReconnect = useCallback(() => {
    connectAttemptRef.current += 1;

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) {
      socket.close();
    }

    doConnect();
  }, [doConnect]);

  const connectionLabel = connectionState === "ready" ? t("term.state.ready") : connectionState === "connecting" ? t("term.state.connecting") : t("term.state.disconnected");
  const sessionDisplay = wsContextRef.current?.sessionId ?? routeSessionId;

  return (
    <main className="h-[100dvh] w-full bg-slate-950 flex flex-col p-2 sm:p-4 gap-3 overflow-hidden">

      {/* Header bar */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 shadow-lg shrink-0">
        <Link
          href="/"
          className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors text-sm font-medium"
        >
          <ArrowLeft size={16} /> {t("term.backLink")}
        </Link>

        <div className="flex items-center gap-2 px-3 py-1 bg-slate-950 rounded-lg border border-slate-800">
          <Terminal size={14} className="text-blue-500" />
          <span className="text-xs font-mono text-slate-300 truncate max-w-[150px] sm:max-w-none">{sessionDisplay}</span>
        </div>
      </div>

      {/* Terminal controls */}
      <div className="shrink-0">
        <TerminalControls
          connectionLabel={connectionLabel}
          connectionState={connectionState}
          onInterrupt={() => sendFrame({ type: "terminal.signal", payload: { signal: "SIGINT" } })}
          onReconnect={handleReconnect}
        />
      </div>

      {/* Xterm viewport container */}
      <div className="flex-1 bg-[#0c0c0c] border border-slate-800 rounded-xl overflow-hidden shadow-2xl relative min-h-[300px]">
        <TerminalViewport
          onInput={(data) => sendFrame({ type: "terminal.input", payload: { data } })}
          onResize={(cols, rows) => {
            latestSizeRef.current = { cols, rows };
            sendFrame({ type: "terminal.resize", payload: { cols, rows } });
          }}
          onReady={(writer) => {
            writeRef.current = writer;
            for (const chunk of pendingOutputRef.current) {
              writer(chunk);
            }
            pendingOutputRef.current = [];
            writer(`\x1b[38;5;39m${t("term.sessionPrefix")} \x1b[1m${sessionDisplay}\x1b[0m\r\n`);
          }}
        />
      </div>

      {/* Error toaster */}
      {errorText && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-rose-500/90 border border-rose-400 text-white px-4 py-2.5 rounded-lg shadow-xl shrink-0 z-50">
          <AlertCircle size={16} />
          <span className="text-sm font-medium">{errorText}</span>
        </div>
      )}
    </main>
  );
}
