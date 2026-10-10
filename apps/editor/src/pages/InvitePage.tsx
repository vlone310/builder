import { useEffect, useState } from "react";
import { auth } from "../lib/api";
import { navigate } from "../lib/router";
import { useSession } from "../lib/session";
import { Button } from "../ui";
import { Card, SignInForm } from "./LoginPage";
import { useAsync } from "./useAsync";

/** #/invite/<token>: sign in as the invited email, then join the org. */
export function InvitePage({ token }: { token: string }) {
  const { identity, refreshIdentity, chooseOrg, signOut } = useSession();
  const invite = useAsync(() => auth.invite(token), [token]);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshIdentity()
      .catch(() => null)
      .finally(() => setChecked(true));
  }, [refreshIdentity]);

  if (invite.error) {
    return (
      <Card title="Invite not valid">
        <p className="text-xs text-muted">
          This invite link is invalid, was already used, or has expired. Ask an admin for a new one.
        </p>
        <Button size="sm" onClick={() => navigate("/")}>
          Go to Builder
        </Button>
      </Card>
    );
  }
  if (!invite.data || !checked) return <Card title="Invite">Loading…</Card>;
  const { org, email, role } = invite.data;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const joined = await auth.acceptInvite(token);
      await refreshIdentity();
      await chooseOrg(joined.org.id);
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Card title={`Join ${org.name}`}>
      <p className="text-xs">
        You're invited to <strong>{org.name}</strong> as <strong>{role}</strong>.
      </p>
      {!identity ? (
        <>
          <p className="text-xs text-muted">Sign in as {email} to accept.</p>
          <SignInForm defaultEmail={email} />
        </>
      ) : identity.user.email.toLowerCase() === email ? (
        <Button variant="primary" className="w-full" disabled={busy} onClick={accept}>
          {busy ? "Joining…" : `Join ${org.name}`}
        </Button>
      ) : (
        <>
          <p className="text-xs text-danger">
            This invite is for {email}, but you're signed in as {identity.user.email}.
          </p>
          <Button size="sm" onClick={() => void signOut()}>
            Sign out and use {email}
          </Button>
        </>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </Card>
  );
}
