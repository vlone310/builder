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
  type Session,
  saveSession,
} from "./api";

/** Refresh the org token this long before it expires. */
const REFRESH_MARGIN_MS = 60_000;
const LAST_ORG_KEY = "builder.lastOrg";

/** Who the sign-in cookie says is signed in, before an org is chosen. */
export interface Identity {
  user: { id: string; email: string; name: string };
  orgs: OrgChoice[];
}

interface SessionContext {
  session: Session | null;
  api: Api | null;
  identity: Identity | null;
  /** True until the first check for a sign-in cookie finishes. */
  restoring: boolean;
  /** Dev login: a ready-made session. */
  signIn(session: Session): void;
  /** Exchanges the sign-in cookie for a token in this org. */
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [restoring, setRestoring] = useState(session === null);
  const current = useRef(session);
  current.current = session;
  const refreshing = useRef<Promise<string> | null>(null);

  const update = useCallback((next: Session | null) => {
    current.current = next;
    saveSession(next);
    setSession(next);
  }, []);

  const chooseOrg = useCallback(
    async (orgId: string) => {
      const result = await auth.token(orgId);
      rememberOrg(orgId);
      update({ ...result, via: "sign-in" });
    },
    [update],
  );

  const refreshIdentity = useCallback(async () => {
    try {
      const next = await auth.orgs();
      setIdentity(next);
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setIdentity(null);
        return null;
      }
      throw error;
    }
  }, []);

  // First load without a stored token: a sign-in cookie may still be there
  // (another tab, or the redirect back from a magic link).
  useEffect(() => {
    if (current.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const found = await refreshIdentity();
        if (cancelled || !found) return;
        const remembered = found.orgs.find((org) => org.id === lastOrg());
        const only = found.orgs.length === 1 ? found.orgs[0] : undefined;
        const pick = remembered ?? only;
        if (pick && !window.location.hash.startsWith("#/invite/")) await chooseOrg(pick.id);
      } catch {
        // The Content API is unreachable or sign-in is off; the login page says more.
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

  /** The current token, refreshed first when it is about to expire. */
  const getToken = useCallback(async (): Promise<string> => {
    const active = current.current;
    if (!active) throw new ApiError(401, "unauthorized", "Signed out");
    const due =
      active.via === "sign-in" &&
      active.expiresAt !== undefined &&
      Date.parse(active.expiresAt) - Date.now() < REFRESH_MARGIN_MS;
    if (!due) return active.token;
    refreshing.current ??= auth
      .token(active.org.id)
      .then((result) => {
        update({ ...result, via: "sign-in" });
        return result.token;
      })
      .catch((error) => {
        // The sign-in ended or the membership is gone: back to the login page.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          signOutLocally();
        }
        throw error;
      })
      .finally(() => {
        refreshing.current = null;
      });
    return refreshing.current;
  }, [update, signOutLocally]);

  const orgKey = session ? `${session.org.id}:${session.userId}` : null;
  // One client per org and user: token refreshes must not reload the pages using it.
  const api = useMemo(() => (orgKey ? createApi(getToken) : null), [orgKey, getToken]);

  const value = useMemo<SessionContext>(
    () => ({
      session,
      api,
      identity,
      restoring,
      signIn: (next) => update(next),
      chooseOrg,
      refreshIdentity,
      async signOut() {
        const via = current.current?.via;
        signOutLocally();
        if (via !== "dev") await auth.signOut().catch(() => {});
      },
    }),
    [session, api, identity, restoring, update, chooseOrg, refreshIdentity, signOutLocally],
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
