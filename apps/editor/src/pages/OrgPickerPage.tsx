import { useState } from "react";
import { useSession } from "../lib/session";
import { Button } from "../ui";
import { Card } from "./LoginPage";

/** Signed in, no org chosen yet: pick one, or learn there is none. */
export function OrgPickerPage() {
  const { identity, chooseOrg, signOut } = useSession();
  const [error, setError] = useState<string | null>(null);
  if (!identity) return null;
  return (
    <Card title={identity.orgs.length > 0 ? "Choose an organization" : "No access yet"}>
      <p className="text-xs text-muted">Signed in as {identity.user.email}.</p>
      {identity.orgs.length === 0 ? (
        <p className="text-xs">
          You're not a member of any organization. Ask an admin to invite this email address.
        </p>
      ) : (
        <ul className="space-y-2">
          {identity.orgs.map((org) => (
            <li key={org.id}>
              <Button
                className="w-full justify-between"
                onClick={() =>
                  chooseOrg(org.id).catch((e) =>
                    setError(e instanceof Error ? e.message : String(e)),
                  )
                }
              >
                <span>{org.name}</span>
                <span className="text-xs text-muted">{org.role}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button variant="ghost" size="sm" onClick={() => void signOut()}>
        Sign out
      </Button>
    </Card>
  );
}
