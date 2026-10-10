import { type User, UserManager, WebStorageStateStore } from "oidc-client-ts";

/** Set while signed in, so a new tab goes straight to Keycloak (its SSO session signs it in). */
const SIGNED_IN_FLAG = "builder.signedIn";

/** The hash route to restore after the round trip to Keycloak. */
const RETURN_TO = "builder.returnTo";

/** Where Keycloak sends people back: the editor's root; the hash route rides in the state. */
const redirectUri = () => `${window.location.origin}${window.location.pathname}`;

export interface Oidc {
  /** The current Keycloak access token, refreshed when about to expire; null when signed out. */
  accessToken(): Promise<string | null>;
  /** Off to Keycloak; returns to the current hash route. */
  signIn(options?: { loginHint?: string; register?: boolean }): Promise<void>;
  signOut(): Promise<void>;
  /** True when this tab was signed in before or another tab is (worth trying a redirect). */
  wasSignedIn(): boolean;
}

/** Finishes a redirect from Keycloak if this load is one; throws Keycloak's error if any. */
async function completeRedirect(manager: UserManager): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("state") || !(params.has("code") || params.has("error"))) return;
  const returnTo = sessionStorage.getItem(RETURN_TO) ?? "#/";
  sessionStorage.removeItem(RETURN_TO);
  // Drop ?code=… from the address bar whatever happens next, and put the route back.
  // replaceState fires no hashchange, so tell the router.
  window.history.replaceState(null, "", `${redirectUri()}${returnTo}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await manager.signinRedirectCallback(`${redirectUri()}?${params.toString()}`);
  setFlag(true);
}

function setFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(SIGNED_IN_FLAG, "1");
    else localStorage.removeItem(SIGNED_IN_FLAG);
  } catch {
    // Without storage, a new tab asks to sign in again.
  }
}

/**
 * Authorization code flow with PKCE against Keycloak. Tokens stay in this
 * tab's sessionStorage; refresh tokens renew them without a redirect.
 */
export async function createOidc(config: { issuer: string; clientId: string }): Promise<Oidc> {
  const manager = new UserManager({
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    post_logout_redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid profile email",
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    automaticSilentRenew: false,
    monitorSession: false,
  });
  await completeRedirect(manager);

  let renewing: Promise<User | null> | null = null;
  return {
    async accessToken() {
      const user = await manager.getUser();
      if (!user) return null;
      if ((user.expires_in ?? 0) > 30) return user.access_token;
      // Expiring: renew with the refresh token (no redirect, no iframe).
      renewing ??= manager
        .signinSilent()
        .catch(async () => {
          await manager.removeUser();
          return null;
        })
        .finally(() => {
          renewing = null;
        });
      return (await renewing)?.access_token ?? null;
    },
    async signIn(options = {}) {
      sessionStorage.setItem(RETURN_TO, window.location.hash || "#/");
      await manager.signinRedirect({
        ...(options.loginHint ? { login_hint: options.loginHint } : {}),
        ...(options.register ? { prompt: "create" } : {}),
      });
    },
    async signOut() {
      setFlag(false);
      const user = await manager.getUser();
      await manager.removeUser();
      if (user) {
        await manager.signoutRedirect({ id_token_hint: user.id_token });
      }
    },
    wasSignedIn() {
      try {
        return localStorage.getItem(SIGNED_IN_FLAG) === "1";
      } catch {
        return false;
      }
    },
  };
}
