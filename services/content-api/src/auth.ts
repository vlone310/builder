import { roles } from "@builder/db";
import type { MiddlewareHandler } from "hono";
import { sign, verify } from "hono/jwt";
import { z } from "zod";
import { ApiError, type AppEnv, type Auth } from "./http";

const claimsSchema = z.object({
  sub: z.string().min(1),
  org: z.string().min(1),
  role: z.enum(roles),
});

/**
 * Verifies the HS256 session token the auth service issues (for now, the
 * dev-token script). Claims: sub (user id), org, role, exp.
 */
export function authMiddleware(secret: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    if (!token) throw new ApiError(401, "unauthorized", "Missing bearer token");
    let payload: unknown;
    try {
      payload = await verify(token, secret, "HS256");
    } catch {
      throw new ApiError(401, "unauthorized", "Invalid or expired token");
    }
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) throw new ApiError(401, "unauthorized", "Token is missing claims");
    c.set("auth", { userId: claims.data.sub, orgId: claims.data.org, role: claims.data.role });
    await next();
  };
}

export function signSessionToken(
  auth: Auth,
  secret: string,
  ttlSeconds = 12 * 3600,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { sub: auth.userId, org: auth.orgId, role: auth.role, iat: now, exp: now + ttlSeconds },
    secret,
    "HS256",
  );
}
