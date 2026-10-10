import { defineConfig } from "tsup";

const shared = {
  format: ["esm" as const],
  dts: true,
  sourcemap: true,
  target: "es2022",
  external: ["react", "@builder/core"],
};

export default defineConfig([
  { ...shared, entry: { index: "src/index.ts" }, clean: true },
  // The edit bridge runs only in the browser, inside the editor's iframe.
  { ...shared, entry: { edit: "src/edit/index.ts" }, banner: { js: '"use client";' } },
]);
