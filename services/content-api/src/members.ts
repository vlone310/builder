import {
  type Db,
  generateInviteToken,
  invites,
  memberships,
  newId,
  normalizeEmail,
  orgMembers,
  orgs,
  roles,
  type Tx,
  withOrg,
} from "@builder/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type EmailSender, linkEmail } from "./email";
import { ApiError, type AppEnv, notFound, parseJson, requirePermission } from "./http";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

export interface MemberRoutesOptions {
  db: Db;
  /** The editor's base URL; invite links open there. */
  editorUrl: string;
  /** Sends invite emails; without it the API only returns the link. */
  email?: EmailSender | undefined;
}

const inviteSchema = z.object({ email: z.email(), role: z.enum(roles) });
const roleSchema = z.object({ role: z.enum(roles) });

/** Changing or removing a member must leave the org at least one admin. */
async function assertAdminRemains(tx: Tx, orgId: string, userId: string) {
  const admins = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "admin")))
    .for("update");
  if (admins.length === 1 && admins[0]?.userId === userId) {
    throw new ApiError(409, "last_admin", "An org needs at least one admin");
  }
}

export function memberRoutes({ db, editorUrl, email }: MemberRoutesOptions) {
  const app = new Hono<AppEnv>();
  const inviteUrl = (token: string) => new URL(`#/invite/${token}`, editorUrl).toString();

  app.get("/members", async (c) => {
    const { orgId } = c.get("auth");
    const items = await withOrg(db, orgId, (tx) => orgMembers(tx));
    return c.json({ items });
  });

  app.patch("/members/:userId", async (c) => {
    const { orgId } = requirePermission(c, "members.manage");
    const userId = c.req.param("userId");
    const { role } = await parseJson(c, roleSchema);
    const updated = await withOrg(db, orgId, async (tx) => {
      if (role !== "admin") await assertAdminRemains(tx, orgId, userId);
      return tx
        .update(memberships)
        .set({ role })
        .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
        .returning();
    });
    if (updated.length === 0) throw notFound("Member");
    return c.json({ userId, role });
  });

  app.delete("/members/:userId", async (c) => {
    const { orgId } = requirePermission(c, "members.manage");
    const userId = c.req.param("userId");
    const removed = await withOrg(db, orgId, async (tx) => {
      await assertAdminRemains(tx, orgId, userId);
      return tx
        .delete(memberships)
        .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
        .returning();
    });
    if (removed.length === 0) throw notFound("Member");
    return c.body(null, 204);
  });

  app.get("/invites", async (c) => {
    const { orgId } = requirePermission(c, "members.manage");
    const items = await withOrg(db, orgId, (tx) =>
      tx
        .select({
          id: invites.id,
          email: invites.email,
          role: invites.role,
          invitedBy: invites.invitedBy,
          expiresAt: invites.expiresAt,
          createdAt: invites.createdAt,
        })
        .from(invites)
        .where(
          and(
            eq(invites.orgId, orgId),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .orderBy(invites.createdAt),
    );
    return c.json({ items });
  });

  /** Invites by email. A new invite to the same address replaces the live one. */
  app.post("/invites", async (c) => {
    const { orgId, userId } = requirePermission(c, "members.manage");
    const input = await parseJson(c, inviteSchema);
    const address = normalizeEmail(input.email);
    const token = generateInviteToken();
    const { invite, orgName } = await withOrg(db, orgId, async (tx) => {
      await tx
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invites.orgId, orgId),
            eq(invites.email, address),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
          ),
        );
      const [row] = await tx
        .insert(invites)
        .values({
          id: newId("inv"),
          orgId,
          email: address,
          role: input.role,
          hash: token.hash,
          invitedBy: userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .returning();
      const [org] = await tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId));
      return { invite: row as typeof invites.$inferSelect, orgName: org?.name ?? orgId };
    });

    const url = inviteUrl(token.plaintext);
    let emailed = false;
    if (email) {
      try {
        await email(
          linkEmail({
            to: address,
            subject: `You're invited to ${orgName} on Builder`,
            intro: `You've been invited to join ${orgName} on Builder as ${input.role}.`,
            action: "Accept the invite",
            url,
            outro: "The link expires in 7 days.",
          }),
        );
        emailed = true;
      } catch (error) {
        // The invite stands; the admin can copy the link from the response.
        console.error("Invite email failed", error);
      }
    }

    return c.json(
      {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
        url,
        emailed,
      },
      201,
    );
  });

  app.post("/invites/:inviteId/revoke", async (c) => {
    const { orgId } = requirePermission(c, "members.manage");
    const revoked = await withOrg(db, orgId, (tx) =>
      tx
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invites.id, c.req.param("inviteId")),
            eq(invites.orgId, orgId),
            isNull(invites.acceptedAt),
          ),
        )
        .returning({ id: invites.id }),
    );
    if (revoked.length === 0) throw notFound("Invite");
    return c.body(null, 204);
  });

  return app;
}
