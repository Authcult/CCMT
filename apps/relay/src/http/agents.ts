import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/service";

const RegisterAgentBodySchema = z.object({
  targetId: z.string().min(1),
  agentId: z.string().min(1),
  enrollSecret: z.string().min(1),
});

type AgentRouteDeps = {
  authService: AuthService;
  agentEnrollSecret: string;
};

export function registerAgentRoutes(app: FastifyInstance, deps: AgentRouteDeps): void {
  app.post("/agents/register", async (request, reply) => {
    const parsed = RegisterAgentBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }

    if (parsed.data.enrollSecret !== deps.agentEnrollSecret) {
      reply.code(401).send({ error: "invalid_enroll_secret" });
      return;
    }

    const agentToken = deps.authService.issueAgentToken({
      targetId: parsed.data.targetId,
      agentId: parsed.data.agentId,
    });

    return {
      agentToken,
      targetId: parsed.data.targetId,
      agentId: parsed.data.agentId,
    };
  });
}
