import { z } from "zod";

export const RoleSchema = z.enum(["owner", "viewer"]);

export const PermissionSchema = z.enum(["terminal:read", "terminal:write", "terminal:control"]);

export const AuthClaimsSchema = z.object({
  sub: z.string().min(1),
  role: RoleSchema,
  permissions: z.array(PermissionSchema),
  deviceId: z.string().min(1),
  sessionIds: z.array(z.string().min(1)).default([]),
});

export type AuthClaims = z.infer<typeof AuthClaimsSchema>;
