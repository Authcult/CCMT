"use client";

import { Activity, RefreshCw, XCircle } from "lucide-react";

type TerminalControlsProps = {
  onInterrupt: () => void;
  onReconnect: () => void;
  connectionLabel: string;
  connectionState: "connecting" | "ready" | "disconnected";
};

export function TerminalControls(props: TerminalControlsProps) {
  const isReady = props.connectionState === "ready";
  const isConnecting = props.connectionState === "connecting";

  return (
    <div className="flex items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-md w-full overflow-hidden">
      <div
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider shrink-0 transition-colors ${
          isReady
            ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.1)]"
            : isConnecting
            ? "bg-blue-500/10 border border-blue-500/30 text-blue-400"
            : "bg-rose-500/10 border border-rose-500/30 text-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.1)]"
        }`}
      >
        <span className="relative flex h-2 w-2 mr-1">
          {isReady && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
          {isConnecting && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${isReady ? "bg-emerald-500" : isConnecting ? "bg-blue-500" : "bg-rose-500"}`}></span>
        </span>
        {props.connectionLabel}
      </div>

      <div className="flex gap-2 shrink-0">
        <button
          onClick={props.onInterrupt}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 active:bg-rose-500/30 border border-rose-500/30 text-rose-400 hover:text-rose-300 font-medium rounded-lg transition-colors min-w-[70px] sm:min-w-0"
          type="button"
          title="Send SIGINT"
        >
          <XCircle size={16} />
          <span className="hidden sm:inline">Ctrl+C</span>
        </button>
        <button
          onClick={props.onReconnect}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 active:bg-blue-500/30 border border-blue-500/30 text-blue-400 hover:text-blue-300 font-medium rounded-lg transition-colors min-w-[70px] sm:min-w-0"
          type="button"
          title="Reconnect"
        >
          <RefreshCw size={16} className={isConnecting ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Reconnect</span>
        </button>
      </div>
    </div>
  );
}
