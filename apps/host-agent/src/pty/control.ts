import type { TerminalProcess, TerminalSignal } from "./types";

export function writeInput(terminalProcess: TerminalProcess, data: string): void {
  terminalProcess.write(data);
}

export function resizeTerminal(terminalProcess: TerminalProcess, cols: number, rows: number): void {
  terminalProcess.resize(cols, rows);
}

export function sendSignal(terminalProcess: TerminalProcess, signal: TerminalSignal): void {
  terminalProcess.kill(signal);
}
