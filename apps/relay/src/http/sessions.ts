import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getHttpToken, hasPermission, verifyUserAccessToken } from "../auth/jwt";
import type { AuthService } from "../auth/service";
import type { MemoryStore } from "../store/memory";

const CreateSessionBodySchema = z.object({
  targetId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
});

const SessionParamsSchema = z.object({
  sessionId: z.string().min(1),
});

type SessionRouteDeps = {
  store: MemoryStore;
  authService: AuthService;
};

function unauthorized(reply: FastifyReply): void {
  reply.code(401).send({ error: "unauthorized" });
}

function authenticate(request: FastifyRequest, reply: FastifyReply, authService: AuthService) {
  const claims = verifyUserAccessToken(getHttpToken(request), authService);
  if (!claims) {
    unauthorized(reply);
    return null;
  }

  return claims;
}

function sanitizeSession(session: ReturnType<MemoryStore["getSession"]>) {
  if (!session) {
    return null;
  }

  return {
    id: session.id,
    targetId: session.targetId,
    createdAt: session.createdAt,
    state: session.state,
  };
}

export function registerSessionRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  app.get("/sessions", async (request, reply) => {
    const claims = authenticate(request, reply, deps.authService);
    if (!claims) {
      return;
    }

    if (!hasPermission(claims, "terminal:read")) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    return {
      sessions: deps.store.listSessions().map((session) => sanitizeSession(session)),
    };
  });

  app.get("/sessions/:sessionId", async (request, reply) => {
    const claims = authenticate(request, reply, deps.authService);
    if (!claims) {
      return;
    }

    if (!hasPermission(claims, "terminal:read")) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    const parsed = SessionParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_session_id", details: parsed.error.flatten() });
      return;
    }

    const session = deps.store.getSession(parsed.data.sessionId);
    if (!session) {
      reply.code(404).send({ error: "session_not_found" });
      return;
    }

    return {
      session: sanitizeSession(session),
      scrollback: deps.store.getSessionScrollback(session.id),
    };
  });

  app.post("/sessions", async (request, reply) => {
    const claims = authenticate(request, reply, deps.authService);
    if (!claims) {
      return;
    }

    if (!hasPermission(claims, "terminal:write")) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    const parsed = CreateSessionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }

    const { targetId, sessionId } = parsed.data;
    const existingSession = sessionId ? deps.store.getSession(sessionId) : undefined;
    if (existingSession && existingSession.targetId !== targetId) {
      reply.code(409).send({ error: "session_target_mismatch" });
      return;
    }

    const resolvedTargetId = existingSession?.targetId ?? targetId;
    const targetOnline = Boolean(deps.store.getTarget(resolvedTargetId));
    if (!targetOnline && !existingSession) {
      reply.code(409).send({ error: "target_offline" });
      return;
    }

    const session = deps.store.createSession(resolvedTargetId, sessionId);
    const wsTicket = deps.authService.issueWsTicket({
      role: "web",
      sub: claims.sub,
      sessionId: session.id,
      targetId: session.targetId,
    });

    return { session: sanitizeSession(session), wsTicket };
  });
}

export { sanitizeSession };
