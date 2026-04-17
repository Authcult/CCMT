"use client";

import { useEffect, useRef } from "react";

type TerminalViewportProps = {
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: (writer: (chunk: string) => void) => void;
};

export function TerminalViewport({ onInput, onResize, onReady }: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let disposed = false;
    let rafId: number | null = null;
    let fitTimer: number | null = null;
    let lastCols = 0;
    let lastRows = 0;
    let term: import("xterm").Terminal | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let onDataDisposable: { dispose: () => void } | null = null;

    const fitAndReport = () => {
      if (!term || !fitAddon) {
        return;
      }

      fitAddon.fit();

      if (term.cols <= 0 || term.rows <= 0) {
        return;
      }

      if (term.cols === lastCols && term.rows === lastRows) {
        return;
      }

      lastCols = term.cols;
      lastRows = term.rows;
      onResizeRef.current(term.cols, term.rows);
    };

    const requestFit = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }

      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        fitAndReport();
      });
    };

    const init = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("xterm"), import("@xterm/addon-fit")]);

      const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
      if (fonts?.ready) {
        try {
          await fonts.ready;
        } catch {
          // ignore font loading failures
        }
      }

      if (disposed || !containerRef.current) {
        return;
      }

      term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        allowTransparency: true,
        theme: {
          background: "#0c0c0c",
          foreground: "#e2e8f0",
          cursor: "#94a3b8",
          selectionBackground: "rgba(59, 130, 246, 0.3)",
          black: "#0f172a",
          red: "#ef4444",
          green: "#10b981",
          yellow: "#f59e0b",
          blue: "#3b82f6",
          magenta: "#8b5cf6",
          cyan: "#06b6d4",
          white: "#f8fafc",
          brightBlack: "#475569",
          brightRed: "#f87171",
          brightGreen: "#34d399",
          brightYellow: "#fbbf24",
          brightBlue: "#60a5fa",
          brightMagenta: "#a78bfa",
          brightCyan: "#22d3ee",
          brightWhite: "#ffffff",
        },
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      const writer = (chunk: string) => {
        term?.write(chunk);
      };

      onReadyRef.current(writer);

      onDataDisposable = term.onData((data) => {
        onInputRef.current(data);
      });

      resizeObserver = new ResizeObserver(() => {
        requestFit();
      });
      resizeObserver.observe(containerRef.current);

      requestFit();
      fitTimer = window.setTimeout(() => {
        requestFit();
      }, 120);
    };

    void init();

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", requestFit);
    window.addEventListener("orientationchange", requestFit);
    visualViewport?.addEventListener("resize", requestFit);
    visualViewport?.addEventListener("scroll", requestFit);

    return () => {
      disposed = true;

      window.removeEventListener("resize", requestFit);
      window.removeEventListener("orientationchange", requestFit);
      visualViewport?.removeEventListener("resize", requestFit);
      visualViewport?.removeEventListener("scroll", requestFit);

      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }

      if (fitTimer !== null) {
        window.clearTimeout(fitTimer);
      }

      resizeObserver?.disconnect();
      onDataDisposable?.dispose();
      term?.dispose();
    };
  }, []);

  return (
    <div className="w-full h-full p-2 bg-[#0c0c0c]">
      <div
        ref={containerRef}
        className="w-full h-full rounded-md overflow-hidden"
      />
    </div>
  );
}
