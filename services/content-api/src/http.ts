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

const WRITE_ROLES: Record<"edit" | "manage" | "admin", readonly Role[]> = {
  edit: ["admin", "developer", "editor"],
  manage: ["admin", "developer"],
  admin: ["admin"],
};

export function requireRole(c: Context<AppEnv>, level: keyof typeof WRITE_ROLES): Auth {
  const auth = c.get("auth");
  if (!WRITE_ROLES[level].includes(auth.role)) {
    throw new ApiError(403, "forbidden", `Role ${auth.role} cannot do this`);
  }
  return auth;
}

/** Postgres unique_violation, unwrapped from Drizzle's query error. */
export function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === "23505" || (error as { code?: string } | null)?.code === "23505";
}
