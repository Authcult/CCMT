import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const PermissionSchema = z.enum(["terminal:read", "terminal:write", "terminal:control"]);
const UserRoleSchema = z.enum(["owner", "viewer"]);
const WsRoleSchema = z.enum(["web", "agent"]);
const SessionStateSchema = z.enum(["connecting", "ready", "disconnected"]);

const UserClaimsSchema = z.object({
  kind: z.literal("user"),
  sub: z.string().min(1),
  role: UserRoleSchema,
  permissions: z.array(PermissionSchema),
  deviceId: z.string().min(1),
});

const AgentClaimsSchema = z.object({
  kind: z.literal("agent"),
  sub: z.string().min(1),
  targetId: z.string().min(1),
});

const WsTicketClaimsSchema = z.object({
  kind: z.literal("ws"),
  sub: z.string().min(1),
  role: WsRoleSchema,
  sessionId: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
});

const AnyClaimsSchema = z.discriminatedUnion("kind", [UserClaimsSchema, AgentClaimsSchema, WsTicketClaimsSchema]);

export const PersistedAuthStateSchema = z.object({
  users: z.array(
    z.object({
      id: z.string().min(1),
      username: z.string().min(1),
      passwordHash: z.string().min(1),
      role: UserRoleSchema,
      totpSecret: z.string().min(1),
    }),
  ),
  devices: z.array(
    z.object({
      deviceId: z.string().min(1),
      userId: z.string().min(1),
      label: z.string(),
      trusted: z.boolean(),
      createdAt: z.number().int(),
      lastSeenAt: z.number().int(),
    }),
  ),
  sessions: z.array(
    z.object({
      tokenHash: z.string().min(1),
      claims: AnyClaimsSchema,
      expiresAt: z.number().int(),
    }),
  ),
  refreshTokens: z.array(
    z.object({
      tokenHash: z.string().min(1),
      userId: z.string().min(1),
      deviceId: z.string().min(1),
      expiresAt: z.number().int(),
    }),
  ),
  agentTokens: z.array(
    z.object({
      tokenHash: z.string().min(1),
      agentId: z.string().min(1),
      targetId: z.string().min(1),
      expiresAt: z.number().int(),
    }),
  ),
});

export const PersistedStoreStateSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string().min(1),
      targetId: z.string().min(1),
      createdAt: z.number().int(),
      state: SessionStateSchema,
      scrollback: z.array(z.string()),
    }),
  ),
});

export const RelayPersistedStateSchema = z.object({
  version: z.literal(1),
  auth: PersistedAuthStateSchema,
  store: PersistedStoreStateSchema,
});

export type PersistedAuthState = z.infer<typeof PersistedAuthStateSchema>;
export type PersistedStoreState = z.infer<typeof PersistedStoreStateSchema>;
export type RelayPersistedState = z.infer<typeof RelayPersistedStateSchema>;

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

type FileStateRepositoryOptions = {
  filePath: string;
  debounceMs: number;
  logger: Logger;
  getState: () => RelayPersistedState;
};

function resolveFilePath(filePath: string): string {
  return resolve(filePath);
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export class FileStateRepository {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingWrite: Promise<void> | null = null;
  private dirty = false;

  constructor(private readonly options: FileStateRepositoryOptions) {}

  async load(): Promise<RelayPersistedState | null> {
    const filePath = resolveFilePath(this.options.filePath);

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const validation = RelayPersistedStateSchema.safeParse(parsed);
      if (!validation.success) {
        this.options.logger.warn(
          {
            filePath,
            issues: validation.error.issues.map((issue) => issue.path.join(".") || "(root)"),
          },
          "relay state file is invalid; starting with in-memory state",
        );
        return null;
      }

      this.options.logger.info(
        {
          filePath,
          users: validation.data.auth.users.length,
          sessions: validation.data.store.sessions.length,
        },
        "loaded relay state",
      );
      return validation.data;
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") {
        return null;
      }

      this.options.logger.warn({ error, filePath }, "failed to load relay state; starting with in-memory state");
      return null;
    }
  }

  scheduleSave(): void {
    this.dirty = true;
    if (this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow().catch((error) => {
        this.options.logger.error({ error, filePath: resolveFilePath(this.options.filePath) }, "failed to save relay state");
      });
    }, this.options.debounceMs);
  }

  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pendingWrite) {
      await this.pendingWrite;
    }

    if (!this.dirty) {
      return;
    }

    const state = this.options.getState();
    this.dirty = false;
    this.pendingWrite = this.writeState(state);

    try {
      await this.pendingWrite;
    } catch (error) {
      this.dirty = true;
      throw error;
    } finally {
      this.pendingWrite = null;
    }

    if (this.dirty) {
      await this.flushNow();
    }
  }

  private async writeState(state: RelayPersistedState): Promise<void> {
    const filePath = resolveFilePath(this.options.filePath);
    const directory = dirname(filePath);
    const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    const payload = `${JSON.stringify(state)}\n`;
    const startedAt = Date.now();

    await mkdir(directory, { recursive: true, mode: 0o700 });

    const handle = await open(tempPath, "w", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(tempPath, filePath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }

    await chmod(filePath, 0o600).catch(() => undefined);

    this.options.logger.info(
      {
        filePath,
        bytes: Buffer.byteLength(payload, "utf8"),
        durationMs: Date.now() - startedAt,
        users: state.auth.users.length,
        sessions: state.store.sessions.length,
      },
      "saved relay state",
    );
  }
}
