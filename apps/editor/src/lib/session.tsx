import { can, type Permission } from "@builder/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Api,
  ApiError,
  auth,
  createApi,
  loadSession,
  type OrgChoice,
  type Providers,
  type Session,
  saveSession,
} from "./api";
import { createOidc, type Oidc } from "./oidc";

/** Refresh the org token this long before it expires. */
const REFRESH_MARGIN_MS = 60_000;
const LAST_ORG_KEY = "builder.lastOrg";

/** Who Keycloak says is signed in, before an org is chosen. */
export interface Identity {
  user: { id: string; email: string; name: string };
  orgs: OrgChoice[];
}

interface SessionContext {
  session: Session | null;
  api: Api | null;
  identity: Identity | null;
  providers: Providers | null;
  /** Keycloak sign-in; null when the Content API has it off. */
  oidc: Oidc | null;
  /** True until sign-in state is known (Keycloak redirect handled, tokens checked). */
  restoring: boolean;
  /** Set when the Content API is unreachable or Keycloak sent back an error. */
  error: string | null;
  /** Dev login: a ready-made session. */
  signIn(session: Session): void;
  /** Exchanges the Keycloak token for a token in this org. */
  chooseOrg(orgId: string): Promise<void>;
  /** Re-reads the signed-in user's orgs (after accepting an invite). */
  refreshIdentity(): Promise<Identity | null>;
  signOut(): Promise<void>;
}

const Context = createContext<SessionContext | null>(null);

function rememberOrg(orgId: string) {
  try {
    localStorage.setItem(LAST_ORG_KEY, orgId);
  } catch {
    // Not remembering the org only costs a click next time.
  }
}

function lastOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [oidc, setOidc] = useState<Oidc | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(session);
  current.current = session;
  const oidcRef = useRef<Oidc | null>(null);
  const refreshing = useRef<Promise<string> | null>(null);

  const update = useCallback((next: Session | null) => {
    current.current = next;
    saveSession(next);
    setSession(next);
  }, []);

  const keycloakToken = useCallback(async () => {
    const token = await oidcRef.current?.accessToken();
    if (!token) throw new ApiError(401, "unauthorized", "Signed out of Keycloak");
    return token;
  }, []);

  const chooseOrg = useCallback(
    async (orgId: string) => {
      const result = await auth.token(await keycloakToken(), orgId);
      rememberOrg(orgId);
      update({ ...result, via: "sign-in" });
    },
    [keycloakToken, update],
  );

  const refreshIdentity = useCallback(async () => {
    const token = await oidcRef.current?.accessToken();
    if (!token) {
      setIdentity(null);
      return null;
    }
    const next = await auth.orgs(token);
    setIdentity(next);
    return next;
  }, []);

  // Start-up: learn how to sign in, finish a Keycloak redirect if this is one,
  // and pick up an existing sign-in.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await auth.providers();
        if (cancelled) return;
        setProviders(found);
        if (!found.oidc) return;
        const client = await createOidc(found.oidc);
        if (cancelled) return;
        oidcRef.current = client;
        setOidc(client);
        if (current.current?.via === "dev") return;
        const signedIn = await refreshIdentity();
        if (cancelled || !signedIn) return;
        if (current.current) return;
        const remembered = signedIn.orgs.find((org) => org.id === lastOrg());
        const only = signedIn.orgs.length === 1 ? signedIn.orgs[0] : undefined;
        const pick = remembered ?? only;
        if (pick && !window.location.hash.startsWith("#/invite/")) await chooseOrg(pick.id);
      } catch (e) {
        if (!cancelled) setError(message(e));
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshIdentity, chooseOrg]);

  const signOutLocally = useCallback(() => {
    update(null);
    setIdentity(null);
  }, [update]);

  /** The current org token, refreshed first when it is about to expire. */
  const getToken = useCallback(async (): Promise<string> => {
    const active = current.current;
    if (!active) throw new ApiError(401, "unauthorized", "Signed out");
    const due =
      active.via === "sign-in" &&
      active.expiresAt !== undefined &&
      Date.parse(active.expiresAt) - Date.now() < REFRESH_MARGIN_MS;
    if (!due) return active.token;
    refreshing.current ??= keycloakToken()
      .then((kc) => auth.token(kc, active.org.id))
      .then((result) => {
        update({ ...result, via: "sign-in" });
        return result.token;
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          // The Keycloak session ended: back to the sign-in page.
          signOutLocally();
        } else if (e instanceof ApiError && e.status === 403) {
          // Removed from this org: back to the org picker, still signed in.
          update(null);
          void refreshIdentity().catch(() => {});
        }
        throw e;
      })
      .finally(() => {
        refreshing.current = null;
      });
    return refreshing.current;
  }, [keycloakToken, update, signOutLocally, refreshIdentity]);

  const orgKey = session ? `${session.org.id}:${session.userId}` : null;
  // One client per org and user: token refreshes must not reload the pages using it.
  const api = useMemo(() => (orgKey ? createApi(getToken) : null), [orgKey, getToken]);

  const value = useMemo<SessionContext>(
    () => ({
      session,
      api,
      identity,
      providers,
      oidc,
      restoring,
      error,
      signIn: (next) => update(next),
      chooseOrg,
      refreshIdentity,
      async signOut() {
        const via = current.current?.via;
        signOutLocally();
        if (via !== "dev") await oidcRef.current?.signOut();
      },
    }),
    [
      session,
      api,
      identity,
      providers,
      oidc,
      restoring,
      error,
      update,
      chooseOrg,
      refreshIdentity,
      signOutLocally,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession(): SessionContext {
  const context = useContext(Context);
  if (!context) throw new Error("useSession outside SessionProvider");
  return context;
}

/** For pages behind sign-in. */
export function useApi(): {
  api: Api;
  session: Session;
  signOut(): Promise<void>;
  can(permission: Permission): boolean;
} {
  const { api, session, signOut } = useSession();
  if (!api || !session) throw new Error("Not signed in");
  return { api, session, signOut, can: (permission) => can(session.role, permission) };
}
