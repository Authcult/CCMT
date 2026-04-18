import { createHash, randomBytes } from "node:crypto";
import type { PersistedAuthState } from "../persistence/file-state";
import { buildTotpUri, generateTotpSecret, verifyTotpCode } from "./totp";

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  role: "owner" | "viewer";
  totpSecret: string;
};

export type DeviceRecord = {
  deviceId: string;
  userId: string;
  label: string;
  trusted: boolean;
  createdAt: number;
  lastSeenAt: number;
};

export type UserTokenClaims = {
  kind: "user";
  sub: string;
  role: "owner" | "viewer";
  permissions: Array<"terminal:read" | "terminal:write" | "terminal:control">;
  deviceId: string;
};

export type AgentTokenClaims = {
  kind: "agent";
  sub: string;
  targetId: string;
};

export type WsTicketClaims = {
  kind: "ws";
  sub: string;
  role: "web" | "agent";
  sessionId?: string;
  targetId?: string;
};

export type AnyClaims = UserTokenClaims | AgentTokenClaims | WsTicketClaims;

type LoginChallengeRecord = {
  userId: string;
  deviceLabel: string;
  expiresAt: number;
};

type TotpSetupChallengeRecord = {
  userId: string;
  secret: string;
  expiresAt: number;
};

type AuthServiceOptions = {
  onDirty?: () => void;
};

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hashPassword(password: string): string {
  return sha256(`ccmt-password:${password}`);
}

function hashToken(token: string): string {
  return sha256(`ccmt-token:${token}`);
}

function signToken(secret: string, payload: string): string {
  return sha256(`ccmt-signature:${secret}:${payload}`);
}

export class AuthService {
  private readonly users = new Map<string, UserRecord>();
  private readonly usernameToUserId = new Map<string, string>();
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly loginChallenges = new Map<string, LoginChallengeRecord>();
  private readonly totpSetupChallenges = new Map<string, TotpSetupChallengeRecord>();
  private readonly sessions = new Map<string, { claims: AnyClaims; expiresAt: number }>();
  private readonly refreshTokens = new Map<string, { userId: string; deviceId: string; expiresAt: number }>();
  private readonly agentTokens = new Map<string, { agentId: string; targetId: string; expiresAt: number }>();
  private onDirty?: () => void;

  constructor(
    private readonly tokenSecret: string,
    options: AuthServiceOptions = {},
  ) {
    this.onDirty = options.onDirty;
    this.seedUsers();
  }

  setOnDirty(onDirty?: () => void): void {
    this.onDirty = onDirty;
  }

  exportState(): PersistedAuthState {
    const now = Date.now();

    return {
      users: Array.from(this.users.values())
        .sort((a, b) => a.username.localeCompare(b.username))
        .map((user) => ({ ...user })),
      devices: Array.from(this.devices.values())
        .filter((device) => this.users.has(device.userId))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((device) => ({ ...device })),
      sessions: Array.from(this.sessions.entries())
        .filter(([, session]) => session.expiresAt > now)
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
        .map(([tokenHash, session]) => ({
          tokenHash,
          claims: session.claims,
          expiresAt: session.expiresAt,
        })),
      refreshTokens: Array.from(this.refreshTokens.entries())
        .filter(([, token]) => token.expiresAt > now && this.users.has(token.userId) && this.devices.has(token.deviceId))
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
        .map(([tokenHash, token]) => ({
          tokenHash,
          userId: token.userId,
          deviceId: token.deviceId,
          expiresAt: token.expiresAt,
        })),
      agentTokens: Array.from(this.agentTokens.entries())
        .filter(([, token]) => token.expiresAt > now)
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
        .map(([tokenHash, token]) => ({
          tokenHash,
          agentId: token.agentId,
          targetId: token.targetId,
          expiresAt: token.expiresAt,
        })),
    };
  }

  importState(state: PersistedAuthState): void {
    const now = Date.now();

    this.users.clear();
    this.usernameToUserId.clear();
    this.devices.clear();
    this.loginChallenges.clear();
    this.totpSetupChallenges.clear();
    this.sessions.clear();
    this.refreshTokens.clear();
    this.agentTokens.clear();

    for (const user of state.users) {
      if (this.users.has(user.id) || this.usernameToUserId.has(user.username)) {
        continue;
      }

      this.users.set(user.id, { ...user });
      this.usernameToUserId.set(user.username, user.id);
    }

    for (const device of state.devices) {
      if (!this.users.has(device.userId) || this.devices.has(device.deviceId)) {
        continue;
      }

      this.devices.set(device.deviceId, { ...device });
    }

    for (const session of state.sessions) {
      if (session.expiresAt <= now) {
        continue;
      }

      if (session.claims.kind === "user") {
        if (!this.users.has(session.claims.sub) || !this.devices.has(session.claims.deviceId)) {
          continue;
        }
      }

      this.sessions.set(session.tokenHash, {
        claims: session.claims,
        expiresAt: session.expiresAt,
      });
    }

    for (const token of state.refreshTokens) {
      if (token.expiresAt <= now || !this.users.has(token.userId) || !this.devices.has(token.deviceId)) {
        continue;
      }

      this.refreshTokens.set(token.tokenHash, {
        userId: token.userId,
        deviceId: token.deviceId,
        expiresAt: token.expiresAt,
      });
    }

    for (const token of state.agentTokens) {
      if (token.expiresAt <= now) {
        continue;
      }

      this.agentTokens.set(token.tokenHash, {
        agentId: token.agentId,
        targetId: token.targetId,
        expiresAt: token.expiresAt,
      });
    }
  }

  private markDirty(): void {
    this.onDirty?.();
  }

  private seedUsers(): void {
    const ownerUsername = process.env.CCMT_OWNER_USERNAME;
    const ownerPassword = process.env.CCMT_OWNER_PASSWORD;
    const ownerTotpSecret = process.env.CCMT_OWNER_TOTP_SECRET;

    if (!ownerUsername || !ownerPassword || !ownerTotpSecret) {
      return;
    }

    if (this.usernameToUserId.has(ownerUsername)) {
      return;
    }

    this.createUser(
      {
        id: "user-owner",
        username: ownerUsername,
        password: ownerPassword,
        role: "owner",
        totpSecret: ownerTotpSecret,
      },
      false,
    );
  }

  private createUser(
    input: { id: string; username: string; password: string; role: "owner" | "viewer"; totpSecret: string },
    markDirty = true,
  ): UserRecord {
    const user: UserRecord = {
      id: input.id,
      username: input.username,
      passwordHash: hashPassword(input.password),
      role: input.role,
      totpSecret: input.totpSecret,
    };

    this.users.set(user.id, user);
    this.usernameToUserId.set(user.username, user.id);
    if (markDirty) {
      this.markDirty();
    }
    return user;
  }

  private makeId(prefix: string): string {
    return `${prefix}-${randomBytes(8).toString("hex")}`;
  }

  private createOpaqueToken(prefix: string): string {
    return `${prefix}_${randomBytes(18).toString("base64url")}`;
  }

  private getRolePermissions(role: "owner" | "viewer"): Array<"terminal:read" | "terminal:write" | "terminal:control"> {
    return role === "owner" ? ["terminal:read", "terminal:write", "terminal:control"] : ["terminal:read"];
  }

  private createSessionToken(claims: AnyClaims, ttlMs: number, markDirty = true): string {
    const expiresAt = Date.now() + ttlMs;
    const payloadRaw = JSON.stringify({
      claims,
      exp: expiresAt,
      nonce: randomBytes(6).toString("hex"),
    });

    const payload = base64UrlEncode(payloadRaw);
    const signature = signToken(this.tokenSecret, payload);
    const token = `ccmt.${payload}.${signature}`;

    this.sessions.set(hashToken(token), {
      claims,
      expiresAt,
    });

    if (markDirty) {
      this.markDirty();
    }

    return token;
  }

  private issueDevice(user: UserRecord, deviceLabel: string): DeviceRecord {
    const deviceId = this.makeId("device");
    const now = Date.now();
    const device: DeviceRecord = {
      deviceId,
      userId: user.id,
      label: deviceLabel,
      trusted: true,
      createdAt: now,
      lastSeenAt: now,
    };

    this.devices.set(deviceId, device);
    this.markDirty();
    return device;
  }

  private issueUserTokens(user: UserRecord, deviceId: string): { accessToken: string; refreshToken: string } {
    const accessToken = this.createSessionToken(
      {
        kind: "user",
        sub: user.id,
        role: user.role,
        permissions: this.getRolePermissions(user.role),
        deviceId,
      },
      15 * 60_000,
      false,
    );

    const refreshToken = this.createOpaqueToken("refresh");
    this.refreshTokens.set(hashToken(refreshToken), {
      userId: user.id,
      deviceId,
      expiresAt: Date.now() + 30 * 24 * 60 * 60_000,
    });
    this.markDirty();

    return { accessToken, refreshToken };
  }

  hasAnyUser(): boolean {
    return this.users.size > 0;
  }

  factoryReset(): void {
    this.users.clear();
    this.usernameToUserId.clear();
    this.devices.clear();
    this.loginChallenges.clear();
    this.totpSetupChallenges.clear();
    this.sessions.clear();
    this.refreshTokens.clear();
    this.agentTokens.clear();
    this.markDirty();
  }

  createBootstrapOwner(input: { username: string; password: string }):
    | { ok: true; user: { id: string; username: string; role: "owner" }; totpSecret: string; otpauthUrl: string }
    | { ok: false; reason: "owner_exists" | "username_taken" } {
    if (this.hasAnyUser()) {
      return { ok: false, reason: "owner_exists" };
    }

    if (this.usernameToUserId.has(input.username)) {
      return { ok: false, reason: "username_taken" };
    }

    const userId = this.makeId("user");
    const totpSecret = generateTotpSecret();
    const user = this.createUser({
      id: userId,
      username: input.username,
      password: input.password,
      role: "owner",
      totpSecret,
    });

    return {
      ok: true,
      user: { id: user.id, username: user.username, role: "owner" },
      totpSecret,
      otpauthUrl: buildTotpUri({
        issuer: process.env.CCMT_TOTP_ISSUER ?? "CCMT",
        accountName: user.username,
        secret: totpSecret,
      }),
    };
  }

  beginTotpSetup(userId: string):
    | { ok: true; challengeId: string; expiresAt: number; secret: string; otpauthUrl: string }
    | { ok: false; reason: "user_not_found" } {
    const user = this.users.get(userId);
    if (!user) {
      return { ok: false, reason: "user_not_found" };
    }

    const challengeId = this.makeId("totp-setup");
    const expiresAt = Date.now() + 10 * 60_000;
    const secret = generateTotpSecret();

    this.totpSetupChallenges.set(challengeId, {
      userId,
      secret,
      expiresAt,
    });

    return {
      ok: true,
      challengeId,
      expiresAt,
      secret,
      otpauthUrl: buildTotpUri({
        issuer: process.env.CCMT_TOTP_ISSUER ?? "CCMT",
        accountName: user.username,
        secret,
      }),
    };
  }

  verifyTotpSetup(input: { userId: string; challengeId: string; totpCode: string }):
    | { ok: true }
    | { ok: false; reason: "challenge_not_found" | "challenge_expired" | "challenge_user_mismatch" | "totp_mismatch" } {
    const challenge = this.totpSetupChallenges.get(input.challengeId);
    if (!challenge) {
      return { ok: false, reason: "challenge_not_found" };
    }

    if (challenge.expiresAt <= Date.now()) {
      this.totpSetupChallenges.delete(input.challengeId);
      return { ok: false, reason: "challenge_expired" };
    }

    if (challenge.userId !== input.userId) {
      return { ok: false, reason: "challenge_user_mismatch" };
    }

    const isValid = verifyTotpCode(challenge.secret, input.totpCode);
    if (!isValid) {
      return { ok: false, reason: "totp_mismatch" };
    }

    const user = this.users.get(challenge.userId);
    if (!user) {
      this.totpSetupChallenges.delete(input.challengeId);
      return { ok: false, reason: "challenge_not_found" };
    }

    user.totpSecret = challenge.secret;
    this.totpSetupChallenges.delete(input.challengeId);
    this.markDirty();
    return { ok: true };
  }

  beginLogin(input: { username: string; password: string; deviceLabel: string }):
    | { ok: true; challengeId: string; expiresAt: number }
    | { ok: false; reason: "invalid_credentials" | "bootstrap_required" } {
    if (!this.hasAnyUser()) {
      return { ok: false, reason: "bootstrap_required" };
    }

    const userId = this.usernameToUserId.get(input.username);
    if (!userId) {
      return { ok: false, reason: "invalid_credentials" };
    }

    const user = this.users.get(userId);
    if (!user) {
      return { ok: false, reason: "invalid_credentials" };
    }

    if (user.passwordHash !== hashPassword(input.password)) {
      return { ok: false, reason: "invalid_credentials" };
    }

    const challengeId = this.makeId("challenge");
    const expiresAt = Date.now() + 5 * 60_000;

    this.loginChallenges.set(challengeId, {
      userId: user.id,
      deviceLabel: input.deviceLabel,
      expiresAt,
    });

    return { ok: true, challengeId, expiresAt };
  }

  verifyLogin(input: { challengeId: string; totpCode: string }):
    | {
        ok: true;
        accessToken: string;
        refreshToken: string;
        device: DeviceRecord;
        user: { id: string; username: string; role: "owner" | "viewer" };
      }
    | { ok: false; reason: "challenge_not_found" | "challenge_expired" | "totp_mismatch" } {
    const challenge = this.loginChallenges.get(input.challengeId);
    if (!challenge) {
      return { ok: false, reason: "challenge_not_found" };
    }

    if (challenge.expiresAt <= Date.now()) {
      this.loginChallenges.delete(input.challengeId);
      return { ok: false, reason: "challenge_expired" };
    }

    const user = this.users.get(challenge.userId);
    if (!user) {
      this.loginChallenges.delete(input.challengeId);
      return { ok: false, reason: "challenge_not_found" };
    }

    if (!verifyTotpCode(user.totpSecret, input.totpCode)) {
      return { ok: false, reason: "totp_mismatch" };
    }

    this.loginChallenges.delete(input.challengeId);

    const device = this.issueDevice(user, challenge.deviceLabel);
    const tokens = this.issueUserTokens(user, device.deviceId);

    return {
      ok: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      device,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  }

  refreshAccessToken(refreshToken: string):
    | { ok: true; accessToken: string; refreshToken: string }
    | { ok: false; reason: "invalid_refresh" | "expired_refresh" | "unknown_user" } {
    const key = hashToken(refreshToken);
    const record = this.refreshTokens.get(key);
    if (!record) {
      return { ok: false, reason: "invalid_refresh" };
    }

    if (record.expiresAt <= Date.now()) {
      this.refreshTokens.delete(key);
      this.markDirty();
      return { ok: false, reason: "expired_refresh" };
    }

    const user = this.users.get(record.userId);
    if (!user) {
      this.refreshTokens.delete(key);
      this.markDirty();
      return { ok: false, reason: "unknown_user" };
    }

    const accessToken = this.createSessionToken(
      {
        kind: "user",
        sub: user.id,
        role: user.role,
        permissions: this.getRolePermissions(user.role),
        deviceId: record.deviceId,
      },
      15 * 60_000,
      false,
    );

    const nextRefreshToken = this.createOpaqueToken("refresh");
    this.refreshTokens.set(hashToken(nextRefreshToken), {
      userId: record.userId,
      deviceId: record.deviceId,
      expiresAt: Date.now() + 30 * 24 * 60 * 60_000,
    });
    this.refreshTokens.delete(key);

    const device = this.devices.get(record.deviceId);
    if (device) {
      device.lastSeenAt = Date.now();
    }

    this.markDirty();
    return { ok: true, accessToken, refreshToken: nextRefreshToken };
  }

  issueAgentToken(input: { targetId: string; agentId: string }): string {
    const opaque = this.createOpaqueToken("agent");
    this.agentTokens.set(hashToken(opaque), {
      agentId: input.agentId,
      targetId: input.targetId,
      expiresAt: Date.now() + 365 * 24 * 60 * 60_000,
    });
    this.markDirty();

    return opaque;
  }

  verifyAgentToken(token: string | undefined): AgentTokenClaims | null {
    if (!token) {
      return null;
    }

    const key = hashToken(token);
    const record = this.agentTokens.get(key);
    if (!record) {
      return null;
    }

    if (record.expiresAt <= Date.now()) {
      this.agentTokens.delete(key);
      this.markDirty();
      return null;
    }

    return {
      kind: "agent",
      sub: record.agentId,
      targetId: record.targetId,
    };
  }

  issueWsTicket(input: { role: "web" | "agent"; sub: string; sessionId?: string; targetId?: string }): string {
    return this.createSessionToken(
      {
        kind: "ws",
        sub: input.sub,
        role: input.role,
        sessionId: input.sessionId,
        targetId: input.targetId,
      },
      60_000,
    );
  }

  verifySessionToken(token: string | undefined): AnyClaims | null {
    if (!token) {
      return null;
    }

    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "ccmt") {
      return null;
    }

    const payload = parts[1];
    const signature = parts[2];
    if (!payload || !signature) {
      return null;
    }

    const expected = signToken(this.tokenSecret, payload);
    if (expected !== signature) {
      return null;
    }

    let decoded: { claims: AnyClaims; exp: number };
    try {
      decoded = JSON.parse(base64UrlDecode(payload));
    } catch {
      return null;
    }

    if (!decoded || !decoded.claims || typeof decoded.exp !== "number" || decoded.exp <= Date.now()) {
      return null;
    }

    const key = hashToken(token);
    const inMemorySession = this.sessions.get(key);
    if (!inMemorySession) {
      return null;
    }

    if (inMemorySession.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      this.markDirty();
      return null;
    }

    return decoded.claims;
  }

  listDevicesByUser(userId: string): DeviceRecord[] {
    return Array.from(this.devices.values())
      .filter((device) => device.userId === userId)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }
}
