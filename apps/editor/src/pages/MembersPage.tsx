import { roles } from "@builder/core";
import { Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { Role } from "../lib/api";
import { useApi } from "../lib/session";
import { Button, Input, Label, Select } from "../ui";
import { AppHeader } from "./AppHeader";
import { useAsync } from "./useAsync";

const ROLE_HELP: Record<Role, string> = {
  admin: "Everything, including members",
  developer: "Edit and publish; environments, keys, webhooks",
  editor: "Edit and publish pages",
  viewer: "Read only",
};

const roleOptions = roles.map((role) => ({ value: role, label: `${role} — ${ROLE_HELP[role]}` }));

export function MembersPage() {
  const { api, session, can } = useApi();
  const manage = can("members.manage");
  const members = useAsync(() => api.members(), [api]);
  const invites = useAsync(
    () => (manage ? api.invites() : Promise.resolve({ items: [] })),
    [api, manage],
  );
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    members.reload();
    invites.reload();
  }

  return (
    <div className="min-h-full">
      <AppHeader>
        <span className="text-muted">/</span>
        <span>Members</span>
      </AppHeader>
      <main className="mx-auto max-w-3xl space-y-8 p-4 sm:p-8">
        <section>
          <h1 className="mb-1 text-lg font-semibold">Members</h1>
          <p className="mb-3 text-xs text-muted">
            Role changes apply when the person's session refreshes, within 15 minutes.
          </p>
          {error && <p className="mb-2 text-xs text-danger">{error}</p>}
          {members.error && <p className="text-danger">{members.error.message}</p>}
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
            {members.data?.items.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="mr-auto min-w-0">
                  <div className="truncate font-medium">
                    {member.name || member.email || member.userId}
                    {member.userId === session.userId && (
                      <span className="ml-1 text-xs text-muted">(you)</span>
                    )}
                  </div>
                  {member.email && (
                    <div className="truncate text-xs text-muted">{member.email}</div>
                  )}
                </div>
                {manage ? (
                  <>
                    <div className="w-36">
                      <Select
                        value={member.role}
                        onValueChange={(role) =>
                          run(() => api.setMemberRole(member.userId, role as Role))
                        }
                        options={roles.map((role) => ({ value: role, label: role }))}
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="danger"
                      aria-label={`Remove ${member.email ?? member.userId}`}
                      onClick={() => run(() => api.removeMember(member.userId))}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-muted">{member.role}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
        {manage && (
          <InvitesSection onChange={() => invites.reload()} invites={invites.data?.items} />
        )}
      </main>
    </div>
  );
}

function InvitesSection({
  invites,
  onChange,
}: {
  invites: { id: string; email: string; role: Role; expiresAt: string }[] | undefined;
  onChange: () => void;
}) {
  const { api } = useApi();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [sent, setSent] = useState<{ email: string; url: string; emailed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await api.createInvite(email, role);
      setSent({ email: created.email, url: created.url, emailed: created.emailed });
      setEmail("");
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">Invite people</h2>
      <p className="mb-3 text-xs text-muted">
        Only invited emails can create an account. Invites expire after 7 days.
      </p>
      <form onSubmit={invite} className="mb-3 flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="w-64">
          <Label htmlFor="invite-role">Role</Label>
          <Select
            id="invite-role"
            value={role}
            onValueChange={(v) => setRole(v as Role)}
            options={roleOptions}
          />
        </div>
        <Button type="submit" variant="primary">
          Send invite
        </Button>
      </form>
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      {sent && (
        <div role="status" className="mb-3 rounded-md bg-blue-50 p-3 text-xs text-blue-900">
          {sent.emailed
            ? `Invite emailed to ${sent.email}. You can also send them this link:`
            : `Email isn't set up, so send ${sent.email} this link yourself:`}
          <code className="mt-1 block break-all font-mono">{sent.url}</code>
        </div>
      )}
      {invites && invites.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
          {invites.map((pending) => (
            <li key={pending.id} className="flex items-center gap-3 px-4 py-2 text-xs">
              <span className="mr-auto font-medium">{pending.email}</span>
              <span className="text-muted">{pending.role}</span>
              <span className="text-muted">
                expires {new Date(pending.expiresAt).toLocaleDateString()}
              </span>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  await api.revokeInvite(pending.id).catch(() => {});
                  onChange();
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
