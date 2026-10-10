import { type Db, orgs, roles, withOrg } from "@builder/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { signSessionToken } from "./auth";
import { notFound, parseJson } from "./http";

const devLoginSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().regex(/^[a-zA-Z0-9_.@-]{1,64}$/),
  role: z.enum(roles),
});

/**
 * Issues session tokens without a password. Mounted only when
 * CONTENT_API_DEV_LOGIN=1; real sign-in belongs to the auth service.
 */
export function devLoginRoute(db: Db, jwtSecret: string) {
  const app = new Hono();
  app.post("/auth/dev-login", async (c) => {
    const input = await parseJson(c, devLoginSchema);
    const [org] = await withOrg(db, input.orgId, (tx) =>
      tx.select().from(orgs).where(eq(orgs.id, input.orgId)),
    );
    if (!org) throw notFound("Org");
    const token = await signSessionToken(input, jwtSecret);
    return c.json({
      token,
      org: { id: org.id, name: org.name },
      userId: input.userId,
      role: input.role,
    });
  });
  return app;
}
