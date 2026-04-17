import WebSocket from "ws";
import { makeFrame, parseFrame } from "@ccmt/protocol";
import { resizeTerminal, sendSignal, writeInput } from "../pty/control";
import type { TerminalProcess } from "../pty/types";

type AgentSocketConfig = {
  relayWsUrl: string;
  targetId: string;
  terminalProcess: TerminalProcess;
  onState: (state: "connecting" | "ready" | "disconnected", detail?: string) => void;
};

const debugEnabled = process.env.CCMT_DEBUG === "1";

function debugLog(message: string, extra?: Record<string, unknown>): void {
  if (!debugEnabled) {
    return;
  }

  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[host-agent:debug] ${message}${suffix}`);
}

export function connectAgentSocket(config: AgentSocketConfig): void {
  let closedByApp = false;
  let activeSessionId: string | null = null;

  const connect = () => {
    config.onState("connecting");
    const socket = new WebSocket(config.relayWsUrl);

    socket.on("open", () => {
      config.onState("ready");
    });

    const terminalDataDisposable = config.terminalProcess.onData((data: string) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (!activeSessionId) {
        return;
      }

      const frame = makeFrame({
        sessionId: activeSessionId,
        from: "agent",
        target: "web",
        body: {
          type: "terminal.output",
          payload: {
            data,
            stream: "stdout",
          },
        },
      });

      socket.send(JSON.stringify(frame));
    });

    const terminalExitDisposable = config.terminalProcess.onExit(({ exitCode }) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (!activeSessionId) {
        return;
      }

      const frame = makeFrame({
        sessionId: activeSessionId,
        from: "agent",
        target: "web",
        body: {
          type: "terminal.exit",
          payload: {
            code: exitCode,
          },
        },
      });

      socket.send(JSON.stringify(frame));
    });

    socket.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString();

      try {
        const frame = parseFrame(JSON.parse(text));
        activeSessionId = frame.sessionId;

        if (frame.type === "terminal.input") {
          writeInput(config.terminalProcess, frame.payload.data);
          return;
        }

        if (frame.type === "terminal.resize") {
          resizeTerminal(config.terminalProcess, frame.payload.cols, frame.payload.rows);
          return;
        }

        if (frame.type === "terminal.signal") {
          sendSignal(config.terminalProcess, frame.payload.signal);
        }
      } catch {
        // ignore malformed frames
      }
    });

    socket.on("close", () => {
      activeSessionId = null;
      terminalDataDisposable.dispose();
      terminalExitDisposable.dispose();
      config.onState("disconnected", "relay closed connection");

      if (!closedByApp) {
        setTimeout(connect, 1500);
      }
    });

    socket.on("error", () => {
      config.onState("disconnected", "relay connection error");
    });
  };

  connect();

  process.on("SIGINT", () => {
    closedByApp = true;
    config.terminalProcess.kill("SIGTERM");
    process.exit(0);
  });
}
