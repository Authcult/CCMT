export type TerminalSignal = "SIGINT" | "SIGTERM";

export type TerminalExitEvent = {
  exitCode: number | null;
};

export type Disposable = {
  dispose: () => void;
};

export type TerminalProcess = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal: TerminalSignal) => void;
  onData: (callback: (data: string) => void) => Disposable;
  onExit: (callback: (event: TerminalExitEvent) => void) => Disposable;
};
