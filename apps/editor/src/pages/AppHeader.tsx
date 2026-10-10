import { type ReactNode, useEffect } from "react";
import { navigate } from "../lib/router";
import { useApi, useSession } from "../lib/session";
import { Button, Select } from "../ui";

export function AppHeader({ children }: { children?: ReactNode }) {
  const { session, signOut } = useApi();
  const { identity, refreshIdentity, chooseOrg } = useSession();
  const signedIn = session.via === "sign-in";

  useEffect(() => {
    if (signedIn && !identity) void refreshIdentity().catch(() => {});
  }, [signedIn, identity, refreshIdentity]);

  const orgs = signedIn ? (identity?.orgs ?? []) : [];

  return (
    <header className="flex h-12 items-center gap-3 border-b border-line bg-white px-4">
      <a href="#/" className="font-semibold">
        Builder
      </a>
      <span className="text-muted">/</span>
      {orgs.length > 1 ? (
        <div className="w-44">
          <Select
            value={session.org.id}
            onValueChange={(orgId) => {
              if (orgId === session.org.id) return;
              void chooseOrg(orgId).then(() => navigate("/"));
            }}
            options={orgs.map((org) => ({ value: org.id, label: org.name }))}
          />
        </div>
      ) : (
        <span className="text-muted">{session.org.name}</span>
      )}
      <div className="flex flex-1 items-center gap-2">{children}</div>
      <a href="#/members" className="text-xs text-muted hover:text-ink">
        Members
      </a>
      <span className="text-xs text-muted">
        {session.user?.email ?? session.userId} · {session.role}
      </span>
      <Button size="sm" variant="ghost" onClick={() => void signOut()}>
        Sign out
      </Button>
    </header>
  );
}
