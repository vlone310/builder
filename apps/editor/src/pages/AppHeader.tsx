import type { ReactNode } from "react";
import { useApi } from "../lib/session";
import { Button } from "../ui";

export function AppHeader({ children }: { children?: ReactNode }) {
  const { session, signOut } = useApi();
  return (
    <header className="flex h-12 items-center gap-3 border-b border-line bg-white px-4">
      <a href="#/" className="font-semibold">
        Builder
      </a>
      <span className="text-muted">/</span>
      <span className="text-muted">{session.org.name}</span>
      <div className="flex flex-1 items-center gap-2">{children}</div>
      <span className="text-xs text-muted">
        {session.userId} · {session.role}
      </span>
      <Button size="sm" variant="ghost" onClick={signOut}>
        Sign out
      </Button>
    </header>
  );
}
