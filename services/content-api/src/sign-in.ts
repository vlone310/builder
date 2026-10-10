import {
  type Db,
  invites,
  memberships,
  normalizeEmail,
  type Role,
  resolveInvite,
  upsertUser,
  userMemberships,
  withOrg,
} from "@builder/db";
import { and, eq, isNull } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";
import { signSessionToken } from "./auth";
import { ApiError, parseJson } from "./http";

/** Org session tokens are short; the editor refreshes them with its Keycloak token. */
export const ORG_TOKEN_TTL_SECONDS = 15 * 60;

export interface OidcOptions {
  /** The Keycloak realm's issuer, e.g. https://auth.example.com/realms/builder. */
  issuer: string;
  /** Required in the access token's aud claim (an audience mapper on the editor client). */
  audience: string;
  /** The editor's public client, reported to the editor at /auth/providers. */
  editorClientId: string;
  /** Where to fetch the realm's keys, when the issuer URL is not reachable from the API. */
  jwksUrl?: string | undefined;
  /** Tests pass local keys instead. */
  keys?: JWTVerifyGetKey | undefined;
}

export interface Identity {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
});

/** Verifies Keycloak access tokens: signature from the realm's JWKS, issuer, audience, expiry. */
export function createOidcVerifier(options: OidcOptions) {
  const keys =
    options.keys ??
    createRemoteJWKSet(
      new URL(options.jwksUrl ?? `${options.issuer}/protocol/openid-connect/certs`),
    );
  return async (token: string): Promise<Identity> => {
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: ["RS256", "PS256", "ES256"],
      }));
    } catch {
      throw new ApiError(401, "unauthorized", "Invalid or expired sign-in token");
    }
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new ApiError(401, "unauthorized", "Sign-in token is missing sub or email");
    }
    return {
      id: claims.data.sub,
      email: normalizeEmail(claims.data.email),
      emailVerified: claims.data.email_verified === true,
      name: claims.data.name ?? claims.data.preferred_username ?? "",
    };
  };
}

const tokenSchema = z.object({ orgId: z.string().min(1) });
const acceptSchema = z.object({ token: z.string().min(1) });

/**
 * Routes that turn a Keycloak sign-in into what the rest of the API uses: the
 * user's orgs, a short org-scoped session token, and invite acceptance.
 */
export function signInRoutes(options: { db: Db; oidc: OidcOptions; jwtSecret: string }) {
  const { db, jwtSecret } = options;
  const verify = createOidcVerifier(options.oidc);
  const app = new Hono();

  /** The Keycloak user behind the request; their profile is kept fresh in users. */
  async function signedInUser(c: Context): Promise<Identity> {
    const token = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    if (!token) throw new ApiError(401, "unauthorized", "Missing sign-in token");
    const identity = await verify(token);
    await upsertUser(db, identity);
    return identity;
  }

  app.get("/auth/orgs", async (c) => {
    const user = await signedInUser(c);
    const orgs = await userMemberships(db, user.id);
    return c.json({
      user: { id: user.id, email: user.email, name: user.name },
      orgs: orgs.map((org) => ({ id: org.orgId, name: org.orgName, role: org.role })),
    });
  });

  app.post("/auth/token", async (c) => {
    const user = await signedInUser(c);
    const { orgId } = await parseJson(c, tokenSchema);
    const membership = (await userMemberships(db, user.id)).find((m) => m.orgId === orgId);
    if (!membership) throw new ApiError(403, "forbidden", "Not a member of this org");
    const token = await signSessionToken(
      { userId: user.id, orgId, role: membership.role },
      jwtSecret,
      ORG_TOKEN_TTL_SECONDS,
    );
    return c.json({
      token,
      expiresAt: new Date(Date.now() + ORG_TOKEN_TTL_SECONDS * 1000).toISOString(),
      userId: user.id,
      role: membership.role,
      org: { id: orgId, name: membership.orgName },
      user: { email: user.email, name: user.name },
    });
  });

  /** What an invite link offers, before signing in. */
  app.get("/auth/invites/:token", async (c) => {
    const invite = await resolveInvite(db, c.req.param("token"));
    if (!invite) throw new ApiError(404, "not_found", "This invite is invalid or has expired");
    return c.json({
      org: { id: invite.orgId, name: invite.orgName },
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
    });
  });

  app.post("/auth/invites/accept", async (c) => {
    const user = await signedInUser(c);
    const { token } = await parseJson(c, acceptSchema);
    const invite = await resolveInvite(db, token);
    if (!invite) throw new ApiError(404, "not_found", "This invite is invalid or has expired");
    if (user.email !== invite.email) {
      throw new ApiError(
        403,
        "invite_email_mismatch",
        `This invite is for ${invite.email}; you are signed in as ${user.email}`,
      );
    }
    if (!user.emailVerified) {
      throw new ApiError(403, "email_not_verified", `Verify ${user.email} before accepting`);
    }
    const role = await withOrg(db, invite.orgId, async (tx) => {
      const claimed = await tx
        .update(invites)
        .set({ acceptedAt: new Date(), acceptedBy: user.id })
        .where(
          and(eq(invites.id, invite.id), isNull(invites.acceptedAt), isNull(invites.revokedAt)),
        )
        .returning({ id: invites.id });
      if (claimed.length === 0) {
        throw new ApiError(404, "not_found", "This invite is invalid or has expired");
      }
      // An existing member keeps their role: an invite never downgrades anyone.
      const [existing] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.orgId, invite.orgId), eq(memberships.userId, user.id)));
      if (existing) return existing.role;
      await tx
        .insert(memberships)
        .values({ orgId: invite.orgId, userId: user.id, role: invite.role });
      return invite.role;
    });
    return c.json({ org: { id: invite.orgId, name: invite.orgName }, role: role as Role });
  });

  return app;
}
