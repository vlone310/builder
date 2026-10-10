import { normalizeSlug } from "@builder/core";
import { type NextRequest, NextResponse } from "next/server.js";

/** Query parameter the editor adds: host-url/<slug>?builder.edit=<token>. */
export const EDIT_PARAM = "builder.edit";

/**
 * For proxy.ts (middleware): sends edit requests to the host's edit route and
 * leaves everything else alone. Pair it with a matcher on the query parameter so
 * live traffic never runs it:
 *
 *   export const config = {
 *     matcher: [{ source: "/:path*", has: [{ type: "query", key: "builder.edit" }] }],
 *   };
 */
export function rewriteEditRequest(request: NextRequest, editPath = "/builder-edit"): NextResponse {
  const token = request.nextUrl.searchParams.get(EDIT_PARAM);
  if (!token) return NextResponse.next();
  const url = new URL(editPath, request.url);
  url.searchParams.set("token", token);
  url.searchParams.set("slug", normalizeSlug(request.nextUrl.pathname));
  return NextResponse.rewrite(url);
}

/** Headers for the edit route: never cached, indexed, or leaking the token as a referrer. */
export const editRouteHeaders = [
  { key: "Cache-Control", value: "private, no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];
