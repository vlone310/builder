import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { auth, devLogin, type Role } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Input, Label, Select } from "../ui";
import { useAsync } from "./useAsync";

const ROLES: Role[] = ["admin", "developer", "editor", "viewer"];

/** Better Auth sends people back with ?error=… when a link or sign-up fails. */
const SIGN_IN_ERRORS: Record<string, string> = {
  INVALID_TOKEN: "That sign-in link is invalid or was already used. Request a new one.",
  EXPIRED_TOKEN: "That sign-in link has expired. Request a new one.",
  new_user_signup_disabled: "This email has no invite yet. Ask an admin of your org to invite you.",
  unable_to_create_user: "This email has no invite yet. Ask an admin of your org to invite you.",
  ATTEMPTS_EXCEEDED: "That sign-in link was already used. Request a new one.",
};

/** Reads and clears the ?error=… Better Auth left on the URL. */
function useSignInError(): string | null {
  const [error] = useState(() => new URLSearchParams(window.location.search).get("error"));
  useEffect(() => {
    if (!error) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState(null, "", url);
  }, [error]);
  if (!error) return null;
  return SIGN_IN_ERRORS[error] ?? `Sign-in failed (${error.replaceAll("_", " ").toLowerCase()}).`;
}

/** Where Better Auth returns after sign-in: this page, as it is now. */
const here = () =>
  `${window.location.origin}${window.location.pathname}${window.location.hash || "#/"}`;

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

/** Email link and Google sign-in; returns to the current page afterwards. */
export function SignInForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const providers = useAsync(() => auth.providers(), []);
  const [email, setEmail] = useState(defaultEmail);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const linkError = useSignInError();
  const [error, setError] = useState<string | null>(linkError);

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.sendLink(email, here());
      setSentTo(email);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    try {
      window.location.assign((await auth.google(here())).url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (providers.error) {
    return (
      <p className="text-xs text-danger">Can't reach the Content API: {providers.error.message}</p>
    );
  }
  if (!providers.data) return <p className="text-xs text-muted">Loading…</p>;
  const { emailLink, google: hasGoogle, devLogin: hasDevLogin } = providers.data;

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-danger">{error}</p>}
      {emailLink &&
        (sentTo ? (
          <p role="status" className="rounded-md bg-blue-50 p-3 text-xs text-blue-900">
            Check your inbox at <strong>{sentTo}</strong>. The link signs you in once and expires in
            15 minutes.{" "}
            <button type="button" className="underline" onClick={() => setSentTo(null)}>
              Use another email
            </button>
          </p>
        ) : (
          <form onSubmit={sendLink} className="space-y-3">
            <div>
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? "Sending…" : "Email me a sign-in link"}
            </Button>
          </form>
        ))}
      {hasGoogle && (
        <Button className="w-full" onClick={google}>
          Continue with Google
        </Button>
      )}
      {hasDevLogin && <DevLoginForm />}
      {!emailLink && !hasGoogle && !hasDevLogin && (
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
