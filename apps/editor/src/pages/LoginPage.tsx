import { type FormEvent, useState } from "react";
import { devLogin, type Role } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Input, Label, Select } from "../ui";

const ROLES: Role[] = ["admin", "developer", "editor", "viewer"];

/** Dev sign-in: the Content API issues a session token when CONTENT_API_DEV_LOGIN=1. */
export function LoginPage() {
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
      signIn({ token: result.token, userId: result.userId, role: result.role, org: result.org });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-base font-semibold">Sign in to Builder</h1>
          <p className="mt-1 text-xs text-muted">
            Development sign-in. Real sign-in arrives with the auth service.
          </p>
        </div>
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
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
