import { createDeliveryClient, normalizeSlug } from "@builder/core";
import { cookies, draftMode } from "next/headers.js";
import { PREVIEW_COOKIE } from "./pages";

export interface PreviewHandlerConfig {
  deliveryUrl: string;
  deliveryKey: string;
  siteId: string;
}

/**
 * Route handler that turns a preview link into a draft-mode session, e.g.
 * app/api/builder/preview/route.ts. `?token=` enters preview of that link's
 * page; `?exit=1&slug=/a` leaves it.
 */
export function createPreviewHandler(config: PreviewHandlerConfig) {
  const client = createDeliveryClient({
    baseUrl: config.deliveryUrl,
    siteId: config.siteId,
    deliveryKey: config.deliveryKey,
  });

  async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const jar = await cookies();
    const draft = await draftMode();

    if (url.searchParams.has("exit")) {
      draft.disable();
      jar.delete(PREVIEW_COOKIE);
      // normalizeSlug keeps the redirect on this host: "//evil.test" becomes "/evil.test".
      return redirect(url, normalizeSlug(url.searchParams.get("slug")));
    }

    const token = url.searchParams.get("token") ?? "";
    const preview = token ? await client.getPreview(token) : null;
    if (!preview) {
      return new Response("This preview link is invalid or has expired.", {
        status: 401,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    draft.enable();
    jar.set(PREVIEW_COOKIE, token, {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      path: "/",
      expires: new Date(preview.preview.expiresAt),
    });
    // Go to the page the link was made for, never to a URL from the query.
    return redirect(url, preview.page.slug ?? "/");
  }

  return { GET };
}

function redirect(from: URL, path: string): Response {
  return new Response(null, {
    status: 307,
    headers: { location: new URL(path, from.origin).toString(), "cache-control": "no-store" },
  });
}
