-- Tenant isolation. Services run tenant queries as builder_app inside a
-- transaction that sets app.org_id (see withOrg); RLS limits that role to rows
-- of one org. The table owner (migrations, SECURITY DEFINER lookups) is exempt.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'builder_app') THEN
    CREATE ROLE builder_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT builder_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO builder_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO builder_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO builder_app;
--> statement-breakpoint
CREATE FUNCTION builder_current_org() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')
$$;
--> statement-breakpoint
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON orgs
  USING (id = builder_current_org())
  WITH CHECK (id = builder_current_org());
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON memberships
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON sites
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON environments
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON pages
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON revisions
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
ALTER TABLE component_manifests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON component_manifests
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON assets
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON api_keys
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON webhooks
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
-- API keys are looked up before the org is known (Delivery API, CLI). This
-- function runs as the owner and returns only the one matching, unrevoked key.
CREATE FUNCTION builder_resolve_api_key(p_hash text)
RETURNS TABLE (id text, org_id text, site_id text, kind text, scopes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.id, k.org_id, k.site_id, k.kind, k.scopes
  FROM api_keys k
  WHERE k.hash = p_hash AND k.revoked_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION builder_resolve_api_key(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION builder_resolve_api_key(text) TO builder_app;
