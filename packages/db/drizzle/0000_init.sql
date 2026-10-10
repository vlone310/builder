CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text NOT NULL,
	"kind" text NOT NULL,
	"hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"url" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "component_manifests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text NOT NULL,
	"env_id" text NOT NULL,
	"component_id" text NOT NULL,
	"version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"git_sha" text NOT NULL,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"host_url" text NOT NULL,
	"allowed_origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text NOT NULL,
	"kind" text NOT NULL,
	"slug" text,
	"name" text,
	"locale" text NOT NULL,
	"published_revision_id" text,
	"lock_holder" text,
	"lock_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_kind_key_ck" CHECK (("pages"."kind" = 'page' AND "pages"."slug" IS NOT NULL AND "pages"."name" IS NULL) OR ("pages"."kind" = 'region' AND "pages"."name" IS NOT NULL AND "pages"."slug" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"page_id" text NOT NULL,
	"tree" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_manifests" ADD CONSTRAINT "component_manifests_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_manifests" ADD CONSTRAINT "component_manifests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_manifests" ADD CONSTRAINT "component_manifests_env_id_environments_id_fk" FOREIGN KEY ("env_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_published_revision_id_revisions_id_fk" FOREIGN KEY ("published_revision_id") REFERENCES "public"."revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "assets_org_idx" ON "assets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "component_manifests_env_component_idx" ON "component_manifests" USING btree ("env_id","component_id","pushed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_site_name_uq" ON "environments" USING btree ("site_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_site_locale_slug_uq" ON "pages" USING btree ("site_id","locale","slug") WHERE "pages"."kind" = 'page';--> statement-breakpoint
CREATE UNIQUE INDEX "pages_site_locale_name_uq" ON "pages" USING btree ("site_id","locale","name") WHERE "pages"."kind" = 'region';--> statement-breakpoint
CREATE INDEX "revisions_page_created_idx" ON "revisions" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "sites_org_idx" ON "sites" USING btree ("org_id");