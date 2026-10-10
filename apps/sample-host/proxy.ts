import { rewriteEditRequest } from "@builder/next";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  return rewriteEditRequest(request);
}

// Runs only for requests carrying ?builder.edit=<token>; live traffic skips it.
export const config = {
  matcher: [{ source: "/:path*", has: [{ type: "query", key: "builder.edit" }] }],
};
