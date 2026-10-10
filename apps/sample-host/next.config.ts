import type { NextConfig } from "next";

const editorOrigin = process.env.BUILDER_EDITOR_ORIGIN ?? "http://localhost:5173";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        // Only the builder editor may frame this app (edit mode lands in phase 2).
        headers: [
          { key: "Content-Security-Policy", value: `frame-ancestors 'self' ${editorOrigin}` },
        ],
      },
    ];
  },
};

export default nextConfig;
