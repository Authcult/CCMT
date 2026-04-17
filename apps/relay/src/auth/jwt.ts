import type { IncomingMessage } from "node:http";
import type { FastifyRequest } from "fastify";
import type { AgentTokenClaims, AnyClaims, AuthService, UserTokenClaims, WsTicketClaims } from "./service";

export function extractBearerToken(authHeader?: string): string | undefined {
  if (!authHeader) {
    return undefined;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return undefined;
  }

  return token;
}

export function getHttpToken(request: FastifyRequest): string | undefined {
  return extractBearerToken(request.headers.authorization);
}

export function getUpgradeToken(request: IncomingMessage, searchParams: URLSearchParams): string | undefined {
  const queryToken = searchParams.get("token") ?? undefined;
  if (queryToken) {
    return queryToken;
  }

  const authHeader = request.headers.authorization;
  if (typeof authHeader !== "string") {
    return undefined;
  }

  return extractBearerToken(authHeader);
}

export function verifyUserAccessToken(token: string | undefined, authService: AuthService): UserTokenClaims | null {
  const claims = verifyAnyToken(token, authService);
  if (!claims || claims.kind !== "user") {
    return null;
  }

  return claims;
}

export function verifyWsTicket(token: string | undefined, authService: AuthService): WsTicketClaims | null {
  const claims = verifyAnyToken(token, authService);
  if (!claims || claims.kind !== "ws") {
    return null;
  }

  return claims;
}

export function verifyAgentToken(token: string | undefined, authService: AuthService): AgentTokenClaims | null {
  return authService.verifyAgentToken(token);
}

function verifyAnyToken(token: string | undefined, authService: AuthService): AnyClaims | null {
  return authService.verifySessionToken(token);
}

export function hasPermission(claims: UserTokenClaims, permission: "terminal:read" | "terminal:write" | "terminal:control"): boolean {
  return claims.permissions.includes(permission);
}
