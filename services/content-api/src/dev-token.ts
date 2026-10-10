/**
 * Prints a session token for local development until the auth service exists.
 *   pnpm --filter @builder/content-api token --org org_demo --role admin --user dev
 */
import { parseArgs } from "node:util";
import { type Role, roles } from "@builder/db";
import { signSessionToken } from "./auth";

const { values } = parseArgs({
  // pnpm forwards the "--" separator; drop it so the flags still parse.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    org: { type: "string", default: "org_demo" },
    role: { type: "string", default: "admin" },
    user: { type: "string", default: "dev" },
  },
});

const secret = process.env.CONTENT_API_JWT_SECRET;
if (!secret) throw new Error("CONTENT_API_JWT_SECRET is not set");
if (!roles.includes(values.role as Role))
  throw new Error(`Role must be one of ${roles.join(", ")}`);

console.log(
  await signSessionToken(
    { orgId: values.org, role: values.role as Role, userId: values.user },
    secret,
  ),
);
