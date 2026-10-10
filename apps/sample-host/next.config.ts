import { fileURLToPath } from "node:url";
import { editRouteHeaders } from "@builder/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the container image (see Dockerfile).
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  async headers() {
    return [
      {
        source: "/:path*",
        // Nobody frames live pages. Edit requests get the editor's origin from the
        // proxy at request time, so one image serves every environment.
        missing: [{ type: "query", key: "builder.edit" }],
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      },
      { source: "/builder-edit/:path*", headers: editRouteHeaders },
      { source: "/builder-edit", headers: editRouteHeaders },
    ];
  },
};

export default nextConfig;
