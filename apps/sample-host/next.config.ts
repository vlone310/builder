import { editRouteHeaders } from "@builder/next";
import type { NextConfig } from "next";

const editorOrigin = process.env.BUILDER_EDITOR_ORIGIN ?? "http://localhost:5173";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        // Only the builder editor may frame this app.
        headers: [
          { key: "Content-Security-Policy", value: `frame-ancestors 'self' ${editorOrigin}` },
        ],
      },
      { source: "/builder-edit/:path*", headers: editRouteHeaders },
      { source: "/builder-edit", headers: editRouteHeaders },
    ];
  },
};

export default nextConfig;
