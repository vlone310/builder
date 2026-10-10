import { builderProxy } from "@builder/next";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  return builderProxy(request);
}

// Runs only for edit and preview links; live traffic skips the proxy.
export const config = {
  matcher: [
    { source: "/:path*", has: [{ type: "query", key: "builder.edit" }] },
    { source: "/:path*", has: [{ type: "query", key: "builder.preview" }] },
  ],
};
