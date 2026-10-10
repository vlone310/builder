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

/** Query parameter on preview links: host-url/<slug>?builder.preview=<token>. */
export const PREVIEW_PARAM = "builder.preview";

/**
 * For proxy.ts: routes edit links to the edit route and preview links to the
 * preview handler, and leaves everything else alone. Match only requests that
 * carry either parameter, so live traffic never runs the proxy:
 *
 *   export const config = {
 *     matcher: [
 *       { source: "/:path*", has: [{ type: "query", key: "builder.edit" }] },
 *       { source: "/:path*", has: [{ type: "query", key: "builder.preview" }] },
 *     ],
 *   };
 */
export function builderProxy(
  request: NextRequest,
  paths: { edit?: string; preview?: string } = {},
): NextResponse {
  const preview = request.nextUrl.searchParams.get(PREVIEW_PARAM);
  if (preview) {
    // A redirect, not a rewrite: the handler sets the draft-mode cookies, and the
    // token leaves the address bar.
    const url = new URL(paths.preview ?? "/api/builder/preview", request.url);
    url.searchParams.set("token", preview);
    return NextResponse.redirect(url, 307);
  }
  return rewriteEditRequest(request, paths.edit);
}

/** Headers for the edit route: never cached, indexed, or leaking the token as a referrer. */
export const editRouteHeaders = [
  { key: "Cache-Control", value: "private, no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];
