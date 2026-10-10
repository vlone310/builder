import type { PageDocument, PageNode, PageSeo, Role } from "@builder/core";

export const CONTENT_API_URL = (
  import.meta.env.VITE_CONTENT_API_URL ?? "http://localhost:4000"
).replace(/\/+$/, "");

export type { Role };

export interface Session {
  token: string;
  /** When the token expires; dev-login tokens leave it out (they last 12 hours). */
  expiresAt?: string;
  userId: string;
  role: Role;
  org: { id: string; name: string };
  user?: { email: string; name: string };
  /** "sign-in" sessions refresh their token with the sign-in cookie. */
  via: "dev" | "sign-in";
}

export interface OrgChoice {
  id: string;
  name: string;
  role: Role;
}

export interface Member {
  userId: string;
  role: Role;
  createdAt: string;
  email: string | null;
  name: string | null;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
}

export interface Site {
  id: string;
  name: string;
  defaultLocale: string;
}

export interface Environment {
  id: string;
  siteId: string;
  name: string;
  hostUrl: string;
  allowedOrigin: string;
}

export interface PageSummary {
  id: string;
  siteId: string;
  kind: "page" | "region";
  slug: string | null;
  name: string | null;
  locale: string;
  publishedRevisionId: string | null;
  lock: { holder: string; expiresAt: string } | null;
  updatedAt: string;
  latestRevisionId?: string | null;
}

export interface PreviewLink {
  id: string;
  revisionId: string;
  expiresAt: string;
  url: string | null;
  token: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  payload: { type?: string; page?: { slug?: string | null; name?: string | null } };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const SESSION_KEY = "builder.session";

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    return { ...session, via: session.via ?? "dev" };
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be unavailable (private mode); the session then lasts for this tab only.
  }
}

async function request<T>(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
  credentials: RequestCredentials = "omit",
): Promise<T> {
  const response = await fetch(`${CONTENT_API_URL}${path}`, {
    method,
    credentials,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return undefined as T;
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const error = json?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? "error",
      error.message ?? response.statusText,
      error.details,
    );
  }
  return json as T;
}

export function devLogin(input: { orgId: string; userId: string; role: Role }) {
  return request<{ token: string; org: { id: string; name: string }; userId: string; role: Role }>(
    null,
    "POST",
    "/auth/dev-login",
    input,
  );
}

/**
 * Sign-in calls. They carry the Content API's sign-in cookie (same site as the
 * editor), never a bearer token.
 */
const withCookie = <T>(method: string, path: string, body?: unknown) =>
  request<T>(null, method, path, body, "include");

export const auth = {
  providers: () =>
    request<{ emailLink: boolean; google: boolean; devLogin: boolean }>(
      null,
      "GET",
      "/auth/providers",
    ),
  sendLink: (email: string, callbackURL: string) =>
    withCookie<{ status: boolean }>("POST", "/auth/sign-in/magic-link", {
      email,
      callbackURL,
      errorCallbackURL: callbackURL,
    }),
  google: (callbackURL: string) =>
    withCookie<{ url: string }>("POST", "/auth/sign-in/social", {
      provider: "google",
      callbackURL,
      errorCallbackURL: callbackURL,
    }),
  /** The signed-in user and their orgs; 401 when signed out. */
  orgs: () =>
    withCookie<{ user: { id: string; email: string; name: string }; orgs: OrgChoice[] }>(
      "GET",
      "/auth/orgs",
    ),
  token: (orgId: string) =>
    withCookie<{
      token: string;
      expiresAt: string;
      userId: string;
      role: Role;
      org: { id: string; name: string };
      user: { email: string; name: string };
    }>("POST", "/auth/token", { orgId }),
  invite: (token: string) =>
    request<{ org: { id: string; name: string }; email: string; role: Role; expiresAt: string }>(
      null,
      "GET",
      `/auth/invites/${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string) =>
    withCookie<{ org: { id: string; name: string }; role: Role }>("POST", "/auth/invites/accept", {
      token,
    }),
  signOut: () => withCookie<unknown>("POST", "/auth/sign-out", {}),
};

/** An API client; getToken returns a valid org token (refreshing it when due). */
export function createApi(getToken: () => Promise<string>) {
  const call = async <T>(method: string, path: string, body?: unknown) =>
    request<T>(await getToken(), method, path, body);
  return {
    sites: () => call<{ items: Site[] }>("GET", "/v1/sites"),
    site: (siteId: string) => call<Site>("GET", `/v1/sites/${siteId}`),
    environments: (siteId: string) =>
      call<{ items: Environment[] }>("GET", `/v1/sites/${siteId}/environments`),
    pages: (siteId: string) => call<{ items: PageSummary[] }>("GET", `/v1/sites/${siteId}/pages`),
    createPage: (
      siteId: string,
      input: { kind: "page" | "region"; locale: string; slug?: string; name?: string },
    ) =>
      call<{ page: PageSummary; revisionId: string | null }>(
        "POST",
        `/v1/sites/${siteId}/pages`,
        input,
      ),
    page: (pageId: string) => call<PageSummary>("GET", `/v1/pages/${pageId}`),
    draft: (pageId: string) =>
      call<{ revisionId: string; status: string; document: PageDocument }>(
        "GET",
        `/v1/pages/${pageId}/draft`,
      ),
    saveDraft: (
      pageId: string,
      baseRevisionId: string | null,
      content: { root: PageNode; seo?: PageSeo },
    ) =>
      call<{ revisionId: string; document: PageDocument }>("PUT", `/v1/pages/${pageId}/draft`, {
        baseRevisionId,
        content,
      }),
    lock: (pageId: string, force = false) =>
      call<PageSummary>("POST", `/v1/pages/${pageId}/lock`, { force }),
    unlock: (pageId: string) => call<void>("DELETE", `/v1/pages/${pageId}/lock`),
    publish: (pageId: string, revisionId: string) =>
      call<PageSummary>("POST", `/v1/pages/${pageId}/publish`, { revisionId }),
    createPreviewLink: (
      pageId: string,
      input: { revisionId?: string; envId?: string; expiresInHours?: number },
    ) => call<PreviewLink>("POST", `/v1/pages/${pageId}/preview-links`, input),
    revokePreviewLink: (linkId: string) => call<void>("POST", `/v1/preview-links/${linkId}/revoke`),
    webhooks: (siteId: string) => call<{ items: Webhook[] }>("GET", `/v1/sites/${siteId}/webhooks`),
    createWebhook: (siteId: string, url: string) =>
      call<Webhook & { secret: string }>("POST", `/v1/sites/${siteId}/webhooks`, { url }),
    deleteWebhook: (webhookId: string) => call<void>("DELETE", `/v1/webhooks/${webhookId}`),
    webhookDeliveries: (webhookId: string) =>
      call<{ items: WebhookDelivery[] }>("GET", `/v1/webhooks/${webhookId}/deliveries`),
    editToken: (siteId: string, envId: string) =>
      call<{ token: string; expiresAt: string; environment: Environment }>(
        "POST",
        "/v1/edit-tokens",
        {
          siteId,
          envId,
        },
      ),
    members: () => call<{ items: Member[] }>("GET", "/v1/members"),
    setMemberRole: (userId: string, role: Role) =>
      call<{ userId: string; role: Role }>("PATCH", `/v1/members/${encodeURIComponent(userId)}`, {
        role,
      }),
    removeMember: (userId: string) =>
      call<void>("DELETE", `/v1/members/${encodeURIComponent(userId)}`),
    invites: () => call<{ items: Invite[] }>("GET", "/v1/invites"),
    createInvite: (email: string, role: Role) =>
      call<Invite & { url: string; emailed: boolean }>("POST", "/v1/invites", { email, role }),
    revokeInvite: (inviteId: string) => call<void>("POST", `/v1/invites/${inviteId}/revoke`),
  };
}

export type Api = ReturnType<typeof createApi>;
