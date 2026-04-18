import { connectAgentSocket } from "./relay/socket";
import { spawnTerminal } from "./pty/spawn";
import { getPublishTargets } from "./targets/discovery";

const relayHttpUrl = process.env.CCMT_WEB_RELAY_HTTP_URL ?? "http://127.0.0.1:8787";
const relayWsUrl = process.env.CCMT_WEB_RELAY_WS_URL ?? "ws://127.0.0.1:8787/ws";
const agentId = process.env.CCMT_AGENT_ID ?? "host-dev";
const targetId = process.env.CCMT_TARGET_ID ?? "claude-main";
const shell = process.env.CCMT_SHELL ?? "/bin/bash";
const agentEnrollSecret = process.env.CCMT_AGENT_ENROLL_SECRET ?? "ccmt-agent-enroll-dev";

const targets = getPublishTargets(targetId);
const selectedTarget = targets[0];

if (!selectedTarget) {
  throw new Error("No publish target available");
}

const terminalProcess = spawnTerminal({
  shell,
  cols: 120,
  rows: 40,
});

type AgentRegisterResponse = {
  agentToken: string;
  targetId: string;
  agentId: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableRegisterError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const cause = error.cause;
  if (!cause || typeof cause !== "object" || !("code" in cause)) {
    return error.message === "fetch failed";
  }

  const code = (cause as { code?: unknown }).code;
  return code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT";
}

async function registerAgent(): Promise<AgentRegisterResponse> {
  const response = await fetch(`${relayHttpUrl}/agents/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      targetId: selectedTarget.id,
      agentId,
      enrollSecret: agentEnrollSecret,
    }),
  });

  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;

  if (!response.ok) {
    throw new Error(body?.error ?? `register_failed_${response.status}`);
  }

  return body as AgentRegisterResponse;
}

async function registerAgentWithRetry(): Promise<AgentRegisterResponse> {
  while (true) {
    try {
      return await registerAgent();
    } catch (error) {
      if (!isRetryableRegisterError(error)) {
        throw error;
      }

      console.log("[host-agent] waiting for relay...");
      await sleep(1500);
    }
  }
}

function buildAgentWsUrl(token: string, targetIdValue: string, agentIdValue: string): string {
  const url = new URL(relayWsUrl);
  url.searchParams.set("role", "agent");
  url.searchParams.set("targetId", targetIdValue);
  url.searchParams.set("agentId", agentIdValue);
  url.searchParams.set("token", token);
  return url.toString();
}

async function boot(): Promise<void> {
  const registration = await registerAgentWithRetry();
  const wsUrl = buildAgentWsUrl(registration.agentToken, registration.targetId, registration.agentId);

  connectAgentSocket({
    relayWsUrl: wsUrl,
    targetId: selectedTarget.id,
    terminalProcess,
    onState: (state, detail) => {
      const suffix = detail ? ` (${detail})` : "";
      console.log(`[host-agent] ${state}${suffix}`);
    },
  });
}

boot().catch((error) => {
  console.error("[host-agent] boot failed", error);
  process.exit(1);
});
