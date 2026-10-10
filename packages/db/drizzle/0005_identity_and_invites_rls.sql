-- Identity tables belong to the platform, not a tenant: builder_app (which
-- serves tenant queries) gets no access. The default privileges from the rls
-- migration granted it, so take them back.
REVOKE ALL ON users, auth_sessions, auth_accounts, auth_verifications FROM builder_app;
--> statement-breakpoint
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON invites
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
-- The orgs a signed-in user belongs to, before any org is chosen.
CREATE FUNCTION builder_user_memberships(p_user_id text)
RETURNS TABLE (org_id text, org_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.org_id, o.name, m.role
  FROM memberships m JOIN orgs o ON o.id = m.org_id
  WHERE m.user_id = p_user_id
  ORDER BY o.name, m.org_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION builder_user_memberships(text) FROM PUBLIC;
--> statement-breakpoint
-- An invite is opened by someone who is not yet a member: it resolves by the
-- token's hash alone, and only while it is live.
CREATE FUNCTION builder_resolve_invite(p_hash text)
RETURNS TABLE (id text, org_id text, org_name text, email text, role text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.org_id, o.name, i.email, i.role, i.expires_at
  FROM invites i JOIN orgs o ON o.id = i.org_id
  WHERE i.hash = p_hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION builder_resolve_invite(text) FROM PUBLIC;
--> statement-breakpoint
-- Sign-up is open only to emails with a live invite.
CREATE FUNCTION builder_email_invited(p_email text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM invites i
    WHERE i.email = lower(p_email) AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      AND i.expires_at > now()
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION builder_email_invited(text) FROM PUBLIC;
--> statement-breakpoint
-- Members of the current org with their name and email. builder_app cannot read
-- users, so this joins them for exactly one org.
CREATE FUNCTION builder_org_members()
RETURNS TABLE (user_id text, role text, created_at timestamptz, email text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id, m.role, m.created_at, u.email, u.name
  FROM memberships m LEFT JOIN users u ON u.id = m.user_id
  WHERE m.org_id = builder_current_org()
  ORDER BY m.created_at, m.user_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION builder_org_members() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION builder_org_members() TO builder_app;
