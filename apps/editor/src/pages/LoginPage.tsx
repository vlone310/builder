import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { devLogin, type Role } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Input, Label, Select } from "../ui";

const ROLES: Role[] = ["admin", "developer", "editor", "viewer"];
/** One automatic trip to Keycloak per tab, so an error page never loops. */
const AUTO_TRIED = "builder.autoSignIn";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-base font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** Keycloak sign-in and registration; returns to the current page afterwards. */
export function SignInForm({ email }: { email?: string }) {
  const { providers, oidc, error } = useSession();
  const [busy, setBusy] = useState(false);

  // Someone signed in elsewhere in this browser: Keycloak's session signs this tab in too.
  useEffect(() => {
    if (!oidc || error || !oidc.wasSignedIn()) return;
    try {
      if (sessionStorage.getItem(AUTO_TRIED)) return;
      sessionStorage.setItem(AUTO_TRIED, "1");
    } catch {
      return;
    }
    setBusy(true);
    void oidc.signIn(email ? { loginHint: email } : {});
  }, [oidc, error, email]);

  if (!providers) {
    return <p className="text-xs text-danger">{error ?? "Loading…"}</p>;
  }

  const go = (register: boolean) => {
    setBusy(true);
    void oidc?.signIn({ ...(email ? { loginHint: email } : {}), register });
  };

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-danger">{error}</p>}
      {oidc && (
        <div className="space-y-2">
          <Button variant="primary" className="w-full" disabled={busy} onClick={() => go(false)}>
            {busy ? "Redirecting…" : "Sign in"}
          </Button>
          <Button className="w-full" disabled={busy} onClick={() => go(true)}>
            Create an account
          </Button>
        </div>
      )}
      {providers.devLogin && <DevLoginForm />}
      {!oidc && !providers.devLogin && (
        <p className="text-xs text-muted">Sign-in is not configured on the Content API.</p>
      )}
    </div>
  );
}

export function LoginPage() {
  return (
    <Card title="Sign in to Builder">
      <SignInForm />
    </Card>
  );
}

/** Dev sign-in: the Content API issues a session token when CONTENT_API_DEV_LOGIN=1. */
function DevLoginForm() {
  const { signIn } = useSession();
  const [orgId, setOrgId] = useState("org_demo");
  const [userId, setUserId] = useState("dev");
  const [role, setRole] = useState<Role>("editor");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await devLogin({ orgId, userId, role });
      signIn({
        token: result.token,
        userId: result.userId,
        role: result.role,
        org: result.org,
        via: "dev",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-line pt-4">
      <p className="text-xs text-muted">Development sign-in (never on in production).</p>
      <div>
        <Label htmlFor="org">Organization id</Label>
        <Input id="org" value={orgId} onChange={(e) => setOrgId(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="user">User id</Label>
        <Input id="user" value={userId} onChange={(e) => setUserId(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="role">Role</Label>
        <Select
          id="role"
          value={role}
          onValueChange={(v) => setRole(v as Role)}
          options={ROLES.map((r) => ({ value: r, label: r }))}
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Signing in…" : "Dev sign in"}
      </Button>
    </form>
  );
}
