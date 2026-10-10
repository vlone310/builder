import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { type Api, createApi, loadSession, type Session, saveSession } from "./api";

interface SessionContext {
  session: Session | null;
  api: Api | null;
  signIn(session: Session): void;
  signOut(): void;
}

const Context = createContext<SessionContext | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const value = useMemo<SessionContext>(
    () => ({
      session,
      api: session ? createApi(session.token) : null,
      signIn(next) {
        saveSession(next);
        setSession(next);
      },
      signOut() {
        saveSession(null);
        setSession(null);
      },
    }),
    [session],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession(): SessionContext {
  const context = useContext(Context);
  if (!context) throw new Error("useSession outside SessionProvider");
  return context;
}

/** For pages behind sign-in. */
export function useApi(): { api: Api; session: Session; signOut(): void } {
  const { api, session, signOut } = useSession();
  if (!api || !session) throw new Error("Not signed in");
  return { api, session, signOut };
}
