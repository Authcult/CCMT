export function getRelayWsUrl(): string {
  return process.env.NEXT_PUBLIC_CCMT_RELAY_WS_URL ?? "ws://localhost:8787/ws";
}

export function getRelayHttpUrl(): string {
  return process.env.NEXT_PUBLIC_CCMT_RELAY_HTTP_URL ?? "http://localhost:8787";
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${getRelayHttpUrl()}${path}`, {
    ...init,
    headers,
  });

  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;

  if (!response.ok) {
    const errorMessage = body?.error ?? `request_failed:${response.status}`;
    throw new Error(errorMessage);
  }

  return body as T;
}

export function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

export function withQuery(baseUrl: string, query: Record<string, string | undefined>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

export type TargetItem = {
  id: string;
  agentId: string;
  connectedAt: number;
};

export type SessionItem = {
  id: string;
  targetId: string;
  createdAt: number;
  state: "connecting" | "ready" | "disconnected";
};

export type SessionDetailResponse = {
  session: SessionItem;
  scrollback: string;
};

export type CreateSessionResponse = {
  session: SessionItem;
  wsTicket: string;
};

export type TargetListResponse = {
  targets: TargetItem[];
};

export type MeResponse = {
  user: {
    sub: string;
    role: "owner" | "viewer";
    permissions: Array<"terminal:read" | "terminal:write" | "terminal:control">;
    deviceId: string;
  };
};

export type SessionListResponse = {
  sessions: SessionItem[];
};

export type DeviceListResponse = {
  devices: Array<{
    deviceId: string;
    label: string;
    trusted: boolean;
    createdAt: number;
    lastSeenAt: number;
  }>;
};

export type AgentRegisterResponse = {
  agentToken: string;
  targetId: string;
  agentId: string;
};

export type InitializeSystemResponse = {
  status: "factory_reset";
  next: "bootstrap";
};

export async function fetchMe(accessToken: string): Promise<MeResponse> {
  return apiRequest<MeResponse>("/auth/me", {
    method: "GET",
    headers: authHeaders(accessToken),
  });
}

export async function fetchTargets(accessToken: string): Promise<TargetListResponse> {
  return apiRequest<TargetListResponse>("/targets", {
    method: "GET",
    headers: authHeaders(accessToken),
  });
}

export async function fetchSessions(accessToken: string): Promise<SessionListResponse> {
  return apiRequest<SessionListResponse>("/sessions", {
    method: "GET",
    headers: authHeaders(accessToken),
  });
}

export async function fetchSession(accessToken: string, sessionId: string): Promise<SessionDetailResponse> {
  return apiRequest<SessionDetailResponse>(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: authHeaders(accessToken),
  });
}

export async function createSession(accessToken: string, targetId: string, sessionId?: string): Promise<CreateSessionResponse> {
  return apiRequest<CreateSessionResponse>("/sessions", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ targetId, sessionId }),
  });
}

export function pickLatestSessionForTarget(sessions: SessionItem[], targetId: string): SessionItem | null {
  return sessions.find((session) => session.targetId === targetId) ?? null;
}

export async function createOrReuseSession(accessToken: string, targetId: string): Promise<CreateSessionResponse> {
  const { sessions } = await fetchSessions(accessToken);
  const existing = pickLatestSessionForTarget(sessions, targetId);
  return createSession(accessToken, targetId, existing?.id);
}

export async function reissueSessionTicket(accessToken: string, sessionId: string, targetId?: string): Promise<CreateSessionResponse> {
  const resolvedTargetId = targetId ?? (await fetchSession(accessToken, sessionId)).session.targetId;
  return createSession(accessToken, resolvedTargetId, sessionId);
}

export async function fetchDevices(accessToken: string): Promise<DeviceListResponse> {
  return apiRequest<DeviceListResponse>("/auth/devices", {
    method: "GET",
    headers: authHeaders(accessToken),
  });
}

export type TotpProvisioning = {
  secret: string;
  otpauthUrl: string;
};

export async function bootstrapOwner(body: { username: string; password: string }): Promise<{ user: { id: string; username: string; role: "owner" }; totp: TotpProvisioning }> {
  return apiRequest<{ user: { id: string; username: string; role: "owner" }; totp: TotpProvisioning }>("/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function initializeSystem(accessToken: string): Promise<InitializeSystemResponse> {
  return apiRequest<InitializeSystemResponse>("/auth/system/initialize", {
    method: "POST",
    headers: authHeaders(accessToken),
  });
}

export async function beginLogin(body: { username: string; password: string; deviceLabel: string }): Promise<{ challengeId: string; expiresAt: number }> {
  return apiRequest<{ challengeId: string; expiresAt: number }>("/auth/login/begin", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function verifyLogin(body: { challengeId: string; totpCode: string }): Promise<{ accessToken: string; refreshToken: string }> {
  return apiRequest<{ accessToken: string; refreshToken: string }>("/auth/login/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function beginTotpSetup(accessToken: string): Promise<{ challengeId: string; expiresAt: number; totp: TotpProvisioning }> {
  return apiRequest<{ challengeId: string; expiresAt: number; totp: TotpProvisioning }>("/auth/totp/setup/begin", {
    method: "POST",
    headers: authHeaders(accessToken),
  });
}

export async function verifyTotpSetup(accessToken: string, body: { challengeId: string; totpCode: string }): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/auth/totp/setup/verify", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  });
}

export async function refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  return apiRequest<{ accessToken: string; refreshToken: string }>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export async function registerAgent(body: { targetId: string; agentId: string; enrollSecret: string }): Promise<AgentRegisterResponse> {
  return apiRequest<AgentRegisterResponse>("/agents/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function buildWebSocketUrl(sessionId: string, wsTicket: string, targetId?: string): string {
  return withQuery(getRelayWsUrl(), {
    role: "web",
    sessionId,
    targetId,
    token: wsTicket,
  });
}

export function buildAgentWebSocketUrl(targetId: string, agentId: string, agentToken: string): string {
  return withQuery(getRelayWsUrl(), {
    role: "agent",
    targetId,
    agentId,
    token: agentToken,
  });
}
