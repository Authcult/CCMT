import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getHttpToken, hasPermission, verifyUserAccessToken } from "../auth/jwt";
import type { AuthService } from "../auth/service";
import type { MemoryStore } from "../store/memory";

type TargetRouteDeps = {
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

  if (!hasPermission(claims, "terminal:read")) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }

  return claims;
}

export function registerTargetRoutes(app: FastifyInstance, deps: TargetRouteDeps): void {
  app.get("/targets", async (request, reply) => {
    const claims = authenticate(request, reply, deps.authService);
    if (!claims) {
      return;
    }

    return {
      targets: deps.store.listTargets(),
      actor: claims.sub,
    };
  });
}
