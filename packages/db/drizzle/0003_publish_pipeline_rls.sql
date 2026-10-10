ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON jobs
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
ALTER TABLE preview_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON preview_links
  USING (org_id = builder_current_org())
  WITH CHECK (org_id = builder_current_org());
--> statement-breakpoint
-- Preview links are opened by people outside the org (the Delivery API sees only
-- the token). Like API keys, they resolve by hash alone, and only while live.
CREATE FUNCTION builder_resolve_preview_link(p_hash text)
RETURNS TABLE (id text, org_id text, site_id text, page_id text, revision_id text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.org_id, l.site_id, l.page_id, l.revision_id, l.expires_at
  FROM preview_links l
  WHERE l.hash = p_hash AND l.revoked_at IS NULL AND l.expires_at > now()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION builder_resolve_preview_link(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION builder_resolve_preview_link(text) TO builder_app;
