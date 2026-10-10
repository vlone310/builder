import { can, type Permission } from "@builder/core";
import type { Role } from "@builder/db";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

export interface Auth {
  userId: string;
  orgId: string;
  role: Role;
}

export type AppEnv = { Variables: { auth: Auth } };

export class ApiError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(status, { message });
  }
}

export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);

export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "bad_request", "Body must be JSON");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(
      400,
      "bad_request",
      "Invalid request body",
      result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    );
  }
  return result.data;
}

/** The caller's auth, if their role grants the permission (see @builder/core permissions). */
export function requirePermission(c: Context<AppEnv>, permission: Permission): Auth {
  const auth = c.get("auth");
  if (!can(auth.role, permission)) {
    throw new ApiError(403, "forbidden", `Role ${auth.role} cannot do this (${permission})`);
  }
  return auth;
}

/** Postgres unique_violation, unwrapped from Drizzle's query error. */
export function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === "23505" || (error as { code?: string } | null)?.code === "23505";
}
