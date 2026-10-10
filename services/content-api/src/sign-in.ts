import { randomBytes } from "node:crypto";
import {
  authAccounts,
  authSessions,
  authVerifications,
  type Db,
  emailInvited,
  invites,
  memberships,
  newId,
  normalizeEmail,
  type Role,
  resolveInvite,
  userMemberships,
  users,
  withOrg,
} from "@builder/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { and, eq, isNull } from "drizzle-orm";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { signSessionToken } from "./auth";
import { type EmailSender, linkEmail } from "./email";
import { ApiError, parseJson } from "./http";

/** Org session tokens are short; the editor refreshes them with its sign-in cookie. */
export const ORG_TOKEN_TTL_SECONDS = 15 * 60;

export interface SignInOptions {
  db: Db;
  /** Signs Better Auth cookies; 32+ characters. */
  secret: string;
  /** The Content API's public URL; magic links point at it. */
  baseUrl: string;
  /** Editor origins: CORS with credentials and allowed sign-in callback URLs. */
  trustedOrigins: string[];
  email: EmailSender;
  google?: { clientId: string; clientSecret: string } | undefined;
}

export type Auth = ReturnType<typeof createAuth>;

const randomId = () => randomBytes(16).toString("base64url");

/**
 * Better Auth owns identity: users, sign-in sessions, OAuth accounts and
 * magic-link verifications. Sign-up is open only to emails with a live invite;
 * org membership and roles stay in our tables.
 */
export function createAuth(options: SignInOptions) {
  const { db, email } = options;
  return betterAuth({
    appName: "Builder",
    baseURL: options.baseUrl,
    basePath: "/auth",
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    session: { expiresIn: 7 * 24 * 3600, updateAge: 24 * 3600 },
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    advanced: {
      cookiePrefix: "builder",
      database: { generateId: ({ model }) => (model === "user" ? newId("usr") : randomId()) },
    },
    ...(options.google
      ? {
          socialProviders: {
            google: {
              clientId: options.google.clientId,
              clientSecret: options.google.clientSecret,
              prompt: "select_account" as const,
            },
          },
        }
      : {}),
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await emailInvited(db, user.email))) return false;
            return { data: { ...user, email: normalizeEmail(user.email) } };
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 15 * 60,
        storeToken: "hashed",
        sendMagicLink: async ({ email: to, url }) => {
          // Unknown and uninvited addresses get nothing, and the response is the
          // same either way, so the form does not reveal who has an account.
          const known = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, normalizeEmail(to)));
          if (known.length === 0 && !(await emailInvited(db, to))) return;
          await email(
            linkEmail({
              to,
              subject: "Sign in to Builder",
              intro:
                "Use this link to sign in to Builder. It works once and expires in 15 minutes.",
              action: "Sign in",
              url,
              outro: "If you did not ask to sign in, you can ignore this email.",
            }),
          );
        },
      }),
    ],
  });
}

const tokenSchema = z.object({ orgId: z.string().min(1) });
const acceptSchema = z.object({ token: z.string().min(1) });

/**
 * Routes that turn a Better Auth sign-in into what the rest of the API uses:
 * the list of the user's orgs, and a short org-scoped session token.
 */
export function signInRoutes(auth: Auth, options: SignInOptions, jwtSecret: string) {
  const { db } = options;
  const app = new Hono();

  // Cookie-authenticated writes must come from the editor. Better Auth checks
  // its own routes; this covers ours.
  const sameOrigin: MiddlewareHandler = async (c, next) => {
    const origin = c.req.header("origin");
    if (!origin || !options.trustedOrigins.includes(origin)) {
      throw new ApiError(403, "forbidden", "Origin not allowed");
    }
    await next();
  };

  async function signedInUser(c: Context) {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new ApiError(401, "unauthorized", "Not signed in");
    return session.user;
  }

  app.get("/auth/orgs", async (c) => {
    const user = await signedInUser(c);
    const orgs = await userMemberships(db, user.id);
    return c.json({
      user: { id: user.id, email: user.email, name: user.name },
      orgs: orgs.map((org) => ({ id: org.orgId, name: org.orgName, role: org.role })),
    });
  });

  app.post("/auth/token", sameOrigin, async (c) => {
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

  app.post("/auth/invites/accept", sameOrigin, async (c) => {
    const user = await signedInUser(c);
    const { token } = await parseJson(c, acceptSchema);
    const invite = await resolveInvite(db, token);
    if (!invite) throw new ApiError(404, "not_found", "This invite is invalid or has expired");
    if (!user.emailVerified || normalizeEmail(user.email) !== invite.email) {
      throw new ApiError(
        403,
        "invite_email_mismatch",
        `This invite is for ${invite.email}; you are signed in as ${user.email}`,
      );
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
