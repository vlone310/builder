import { createPreviewHandler } from "@builder/next";
import { builderConfig } from "@/builder/config";

export const dynamic = "force-dynamic";

let handler: ReturnType<typeof createPreviewHandler> | undefined;

export function GET(request: Request) {
  handler ??= createPreviewHandler(builderConfig());
  return handler.GET(request);
}
