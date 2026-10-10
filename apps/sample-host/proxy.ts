import { builderProxy } from "@builder/next";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  return builderProxy(request, {
    // Only the editor may frame the edit route.
    editorOrigin: process.env.BUILDER_EDITOR_ORIGIN ?? "http://localhost:5173",
  });
}

// Runs only for edit and preview links; live traffic skips the proxy.
export const config = {
  matcher: [
    { source: "/:path*", has: [{ type: "query", key: "builder.edit" }] },
    { source: "/:path*", has: [{ type: "query", key: "builder.preview" }] },
  ],
};
