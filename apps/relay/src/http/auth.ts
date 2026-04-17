import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "../auth/service";
import { getHttpToken, verifyUserAccessToken } from "../auth/jwt";

const BeginLoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  deviceLabel: z.string().min(1),
});

const VerifyLoginBodySchema = z.object({
  challengeId: z.string().min(1),
  totpCode: z.string().length(6),
});

const BootstrapBodySchema = z.object({
  username: z.string().min(3),
  password: z.string().min(8),
});

const TotpSetupVerifyBodySchema = z.object({
  challengeId: z.string().min(1),
  totpCode: z.string().length(6),
});

const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

type AuthRouteDeps = {
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

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  app.post("/auth/bootstrap", async (request, reply) => {
    const parsed = BootstrapBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }

    const result = deps.authService.createBootstrapOwner(parsed.data);
    if (!result.ok) {
      reply.code(409).send({ error: result.reason });
      return;
    }

    return {
      user: result.user,
      totp: {
        secret: result.totpSecret,
        otpauthUrl: result.otpauthUrl,
      },
    };
  });

  app.post("/auth/system/initialize", async (request, reply) => {
    const claims = authenticate(request, reply, deps.authService);
    if (!claims) {
      return;
    }

    if (claims.role !== "owner") {
      reply.code(403).send({ error: "forbidden_not_owner" });
      return;
    }

    return {
      status: deps.authService.hasAnyUser() ? "already_initialized" : "initialized",
    };
  });

  app.post("/auth/login/begin", async (request, reply) => {
    const parsed = BeginLoginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }

    const result = deps.authService.beginLogin(parsed.data);
    if (!result.ok) {
      if (result.reason === "bootstrap_required") {
        reply.code(409).send({ error: result.reason });
        return;
      }

      reply.code(401).send({ error: result.reason });
      return;
    }

    return {
      challengeId: result.challengeId,
      expiresAt: result.expiresAt,
    };
  });

  app.post("/auth/login/verify", async (request, reply) => {
    const parsed = VerifyLoginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }

    const result = deps.authService.verifyLogin(parsed.data);
    if (!result.ok) {
      reply.code(401).send({ error: result.reason });
      return;
    }

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      device: result.device,
    };
  });

  app.post("/auth/totp/setup/begin", async (request, reply) => {
    const claims = authenticate(request, reply, deps.authService);
    if (!claims) {
      return;
    }

    const result = deps.authService.beginTotpSetup(claims.sub);
    if (!result.ok) {
      reply.code(404).send({ error: result.reason });
      return;
    }

    return {
      challengeId: result.challengeId,
      expiresAt: result.expiresAt,
      totp: {
        secret: result.secret,
        otpauthUrl: result.otpauthUrl,
      },
    };
  });

  app.post("/auth/totp/setup/verify", async (request, reply) => {
    const claims = authenticate(request, reply, deps.authService);
    if (!claims) {
      return;
    }

    const parsed = TotpSetupVerifyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }

    const result = deps.authService.verifyTotpSetup({
      userId: claims.sub,
      challengeId: parsed.data.challengeId,
      totpCode: parsed.data.totpCode,
    });

    if (!result.ok) {
      reply.code(400).send({ error: result.reason });
      return;
    }

    return { ok: true };
  });

  app.post("/auth/refresh", async (request, reply) => {
    const parsed = RefreshBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }

    const result = deps.authService.refreshAccessToken(parsed.data.refreshToken);
    if (!result.ok) {
      reply.code(401).send({ error: result.reason });
      return;
    }

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  });

  app.get("/auth/me", async (request, reply) => {
    const claims = authenticate(request, reply, deps.authService);
    if (!claims) {
      return;
    }

    return { user: claims };
  });

  app.get("/auth/devices", async (request, reply) => {
    const claims = authenticate(request, reply, deps.authService);
    if (!claims) {
      return;
    }

    return {
      devices: deps.authService.listDevicesByUser(claims.sub),
    };
  });
}
