import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { type Db, hashApiKey, type Tx } from "./client";
import { type Role, users } from "./schema";

/** An invite token; store the hash, email the plaintext once. */
export function generateInviteToken(): { plaintext: string; hash: string } {
  const plaintext = `bk_inv_${randomBytes(24).toString("base64url")}`;
  return { plaintext, hash: hashApiKey(plaintext) };
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export interface UserMembership {
  orgId: string;
  orgName: string;
  role: Role;
}

/** Every org a user belongs to, across orgs (runs as the table owner). */
export async function userMemberships(db: Db, userId: string): Promise<UserMembership[]> {
  const rows = await db.execute<{ org_id: string; org_name: string; role: Role }>(
    sql`SELECT * FROM builder_user_memberships(${userId})`,
  );
  return rows.map((row) => ({ orgId: row.org_id, orgName: row.org_name, role: row.role }));
}

export interface ResolvedInvite {
  id: string;
  orgId: string;
  orgName: string;
  email: string;
  role: Role;
  expiresAt: Date;
}

/** A live invite by its plaintext token, across orgs. */
export async function resolveInvite(db: Db, plaintext: string): Promise<ResolvedInvite | null> {
  const rows = await db.execute<{
    id: string;
    org_id: string;
    org_name: string;
    email: string;
    role: Role;
    expires_at: string | Date;
  }>(sql`SELECT * FROM builder_resolve_invite(${hashApiKey(plaintext)})`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    orgName: row.org_name,
    email: row.email,
    role: row.role,
    expiresAt: new Date(row.expires_at),
  };
}

export interface OrgMember {
  userId: string;
  role: Role;
  createdAt: Date;
  email: string | null;
  name: string | null;
}

/** Members of the org the transaction is scoped to (see withOrg). */
export async function orgMembers(tx: Tx): Promise<OrgMember[]> {
  const rows = await tx.execute<{
    user_id: string;
    role: Role;
    created_at: string | Date;
    email: string | null;
    name: string | null;
  }>(sql`SELECT * FROM builder_org_members()`);
  return rows.map((row) => ({
    userId: row.user_id,
    role: row.role,
    createdAt: new Date(row.created_at),
    email: row.email,
    name: row.name,
  }));
}

/** Records who a Keycloak subject is, so member lists can show names and emails. */
export async function upsertUser(
  db: Db,
  user: { id: string; email: string; name: string },
): Promise<void> {
  await db
    .insert(users)
    .values({ ...user, email: normalizeEmail(user.email) })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: normalizeEmail(user.email), name: user.name, updatedAt: new Date() },
    });
}
