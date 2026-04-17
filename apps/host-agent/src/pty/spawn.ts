import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import type { Writable } from "node:stream";
import type { TerminalProcess } from "./types";

type SpawnConfig = {
  shell: string;
  cols: number;
  rows: number;
};

const pythonPtyBridge = String.raw`
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import fcntl

shell = sys.argv[1]
cols = int(sys.argv[2])
rows = int(sys.argv[3])
master_fd, slave_fd = pty.openpty()
resize_fd = os.dup(slave_fd)
control_fd = 3
stdin_fd = sys.stdin.fileno()
stdout_fd = sys.stdout.fileno()
control_buffer = b""
control_open = True
stdin_open = True


def apply_size(next_cols, next_rows):
    if next_cols <= 0 or next_rows <= 0:
        return
    packed = struct.pack("HHHH", next_rows, next_cols, 0, 0)
    fcntl.ioctl(resize_fd, termios.TIOCSWINSZ, packed)


def send_signal(signal_name):
    sig = getattr(signal, signal_name, None)
    if sig is None:
        return
    try:
        os.killpg(process.pid, sig)
    except ProcessLookupError:
        pass


env = os.environ.copy()
env.setdefault("TERM", "xterm-256color")
apply_size(cols, rows)
process = subprocess.Popen(
    [shell],
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    cwd=os.getcwd(),
    env=env,
    start_new_session=True,
)
os.close(slave_fd)

while True:
    read_fds = [master_fd]
    if stdin_open:
        read_fds.append(stdin_fd)
    if control_open:
        read_fds.append(control_fd)

    ready, _, _ = select.select(read_fds, [], [], 0.1)

    if master_fd in ready:
        try:
            data = os.read(master_fd, 65536)
        except OSError:
            data = b""
        if data:
            os.write(stdout_fd, data)
        else:
            break

    if stdin_open and stdin_fd in ready:
        data = os.read(stdin_fd, 65536)
        if data:
            os.write(master_fd, data)
        else:
            stdin_open = False

    if control_open and control_fd in ready:
        chunk = os.read(control_fd, 65536)
        if chunk:
            control_buffer += chunk
            while b"\n" in control_buffer:
                line, control_buffer = control_buffer.split(b"\n", 1)
                if not line:
                    continue
                command = json.loads(line.decode("utf8"))
                if command.get("type") == "resize":
                    apply_size(int(command["cols"]), int(command["rows"]))
                    send_signal("SIGWINCH")
                elif command.get("type") == "signal":
                    send_signal(command.get("signal", "SIGTERM"))
        else:
            control_open = False

    if process.poll() is not None and not stdin_open and not control_open:
        break

os.close(master_fd)
os.close(resize_fd)
code = process.wait()
sys.exit(code if code is not None else 0)
`;

const require = createRequire(import.meta.url);

function getExtraPipe(stream: Writable | null | undefined): Writable | null {
  if (!stream || typeof stream.write !== "function") {
    return null;
  }

  return stream;
}

function writeControl(pipe: Writable | null, payload: Record<string, unknown>): void {
  pipe?.write(`${JSON.stringify(payload)}\n`);
}

function toUtf8(chunk: Buffer | string): string {
  return typeof chunk === "string" ? chunk : chunk.toString("utf8");
}

function createPipeTerminalProcess(child: ReturnType<typeof spawn>, options?: { controlPipe?: Writable | null }): TerminalProcess {
  return {
    write(data: string) {
      child.stdin?.write(data);
    },
    resize(cols, rows) {
      if (options?.controlPipe) {
        writeControl(options.controlPipe, { type: "resize", cols, rows });
      }
    },
    kill(signal) {
      if (options?.controlPipe) {
        writeControl(options.controlPipe, { type: "signal", signal });
        return;
      }

      child.kill(signal);
    },
    onData(callback) {
      const handleStdout = (buf: Buffer | string) => callback(toUtf8(buf));
      const handleStderr = (buf: Buffer | string) => callback(toUtf8(buf));
      child.stdout?.on("data", handleStdout);
      child.stderr?.on("data", handleStderr);

      return {
        dispose() {
          child.stdout?.off("data", handleStdout);
          child.stderr?.off("data", handleStderr);
        },
      };
    },
    onExit(callback) {
      const handleExit = (code: number | null) => callback({ exitCode: code });
      child.on("exit", handleExit);

      return {
        dispose() {
          child.off("exit", handleExit);
        },
      };
    },
  };
}

function spawnWithNodePty(config: SpawnConfig): TerminalProcess | null {
  try {
    const pty = require("node-pty") as {
      spawn: (
        file: string,
        args: string[],
        options: {
          name: string;
          cols: number;
          rows: number;
          cwd: string;
          env: Record<string, string>;
        },
      ) => {
        write: (data: string) => void;
        resize: (cols: number, rows: number) => void;
        kill: (signal: "SIGINT" | "SIGTERM") => void;
        onData: (callback: (data: string) => void) => { dispose: () => void };
        onExit: (callback: (event: { exitCode: number | null }) => void) => { dispose: () => void };
      };
    };

    const ptyProcess = pty.spawn(config.shell, [], {
      name: "xterm-color",
      cols: config.cols,
      rows: config.rows,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });

    return {
      write: (data) => ptyProcess.write(data),
      resize: (cols, rows) => ptyProcess.resize(cols, rows),
      kill: (signal) => ptyProcess.kill(signal),
      onData: (callback) => ptyProcess.onData(callback),
      onExit: (callback) => ptyProcess.onExit(callback),
    };
  } catch {
    return null;
  }
}

function spawnWithPythonPty(config: SpawnConfig): TerminalProcess | null {
  if (process.platform === "win32") {
    return null;
  }

  const child = spawn("python3", ["-u", "-c", pythonPtyBridge, config.shell, String(config.cols), String(config.rows)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: process.env.TERM ?? "xterm-256color",
    },
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });

  if (!child.pid) {
    return null;
  }

  const controlPipe = getExtraPipe((child.stdio[3] ?? null) as Writable | null);
  if (!controlPipe) {
    child.kill();
    return null;
  }

  return createPipeTerminalProcess(child, { controlPipe });
}

function spawnWithScriptPty(config: SpawnConfig): TerminalProcess | null {
  const child = spawn("script", ["-qfec", config.shell, "/dev/null"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: process.env.TERM ?? "xterm-256color",
      COLUMNS: String(config.cols),
      LINES: String(config.rows),
    },
    stdio: "pipe",
  });

  if (!child.pid) {
    return null;
  }

  return createPipeTerminalProcess(child);
}

function spawnWithPipes(config: SpawnConfig): TerminalProcess {
  const child = spawn(config.shell, [], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "pipe",
  });

  return {
    write(data: string) {
      const normalized = data.replace(/\r\n?/g, "\n");
      child.stdin?.write(normalized);
    },
    resize() {
      // no-op when PTY is unavailable
    },
    kill(signal) {
      child.kill(signal);
    },
    onData(callback) {
      const handleStdout = (buf: Buffer | string) => callback(toUtf8(buf));
      const handleStderr = (buf: Buffer | string) => callback(toUtf8(buf));
      child.stdout?.on("data", handleStdout);
      child.stderr?.on("data", handleStderr);

      return {
        dispose() {
          child.stdout?.off("data", handleStdout);
          child.stderr?.off("data", handleStderr);
        },
      };
    },
    onExit(callback) {
      const handleExit = (code: number | null) => callback({ exitCode: code });
      child.on("exit", handleExit);

      return {
        dispose() {
          child.off("exit", handleExit);
        },
      };
    },
  };
}

export function spawnTerminal(config: SpawnConfig): TerminalProcess {
  return spawnWithNodePty(config) ?? spawnWithPythonPty(config) ?? spawnWithScriptPty(config) ?? spawnWithPipes(config);
}
