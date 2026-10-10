# Pilot deployment

Phase 3's gate is a first pilot tenant serving live pages. The pilot is the sample host on
Vercel. This runbook covers every piece it needs, and the decisions still open.

## What runs where

| Piece | Runs on | Public URL (example) |
| --- | --- | --- |
| Postgres 16 | Managed Postgres (Neon, Supabase, RDS, …) | — |
| Content API | Container (`Dockerfile`, `SERVICE=content-api`) | `https://content.builder.example` |
| Delivery API | Container (`SERVICE=delivery-api`), behind Cloudflare | `https://delivery.builder.example` |
| Worker | Container (`SERVICE=worker`), one or more replicas | none needed (health on `:4002`) |
| Editor | Vercel (`apps/editor`, static) | `https://editor.builder.example` |
| Sample host | Vercel (`apps/sample-host`) | `https://pilot.example.com` |

The three services are plain Node processes, so any container host works (Fly.io, Render,
Railway, ECS, Cloud Run). The worker can also run without a long-lived process: set
`WORKER_POLL_MS=0` and call `POST /run` with `Authorization: Bearer $WORKER_RUN_SECRET` from a
scheduler. Publishes then reach the site on the scheduler's interval rather than in about a
second.

## 1. Database

1. Create a Postgres 16 database. The connection user must own the tables, because migrations
   create the `builder_app` role and row-level security policies.
2. Run migrations before each deploy:
   `docker build --target migrate -t builder-migrate . && docker run -e DATABASE_URL=… builder-migrate`
   (or `DATABASE_URL=… pnpm db:migrate` from a checkout).

## 2. Platform services

Build one image per service: `docker build --build-arg SERVICE=<name> -t builder-<name> .`

| Variable | Content API | Delivery API | Worker | Notes |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | ✓ | ✓ | ✓ | Pooled connection string is fine |
| `PORT` | 4000 | 4001 | 4002 | |
| `CONTENT_API_JWT_SECRET` | ✓ | | | 32+ random characters |
| `CONTENT_API_PUBLIC_URL` | ✓ | | | Its own public URL; the issuer hosts check |
| `EDIT_TOKEN_PRIVATE_JWK` | ✓ | | | `pnpm --filter @builder/content-api keys:generate` |
| `EDITOR_ORIGIN` | ✓ | | | The editor's origin, for CORS |
| `CONTENT_API_DEV_LOGIN` | **unset** | | | Never enable outside development |
| `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` | | | ✓ | Token with "Cache Purge" on the zone |
| `WORKER_RUN_SECRET` | | | ✓ | Only if a scheduler calls `/run` |
| `WEBHOOK_ALLOW_PRIVATE` | | | **unset** | Production webhooks must be public HTTPS |

## 3. Cloudflare in front of the Delivery API

1. Proxy `delivery.builder.example` through Cloudflare.
2. Add a Cache Rule for that hostname: eligible for cache, Edge TTL "use cache-control header
   if present". Cloudflare does not cache JSON by default.
3. Responses carry `Cache-Tag` (`builder:page:…`, `builder:slug:…`, `builder:site:…`). The
   worker purges those tags on every publish. Check that your Cloudflare plan allows purge by
   tag.
4. Every Delivery API URL includes the site id (`/v1/sites/<site>/pages?…`). That keeps cache
   entries per site, because Cloudflare ignores `Vary: Authorization`. Cached responses are
   published pages, which are public on the live site anyway. Previews are never cached.

## 4. Editor on Vercel

- Project root directory `apps/editor`; `apps/editor/vercel.json` sets the monorepo build.
- Environment: `VITE_CONTENT_API_URL=https://content.builder.example`.

## 5. Tenant data for the pilot

From a checkout with `DATABASE_URL` set to production:

```sh
pnpm --filter @builder/db bootstrap --org "Pilot" --site "pilot.example.com" \
  --host-url https://pilot.example.com --env prod
```

The output holds the host app's environment: site id, delivery key and webhook secret. Store it
in the host's Vercel project right away; the secrets are not shown again. The command also
registers the webhook at `https://pilot.example.com/api/builder/revalidate`.

## 6. Sample host on Vercel

- Project root directory `apps/sample-host`; `apps/sample-host/vercel.json` sets the monorepo
  build.
- Environment:

| Variable | Value |
| --- | --- |
| `BUILDER_DELIVERY_URL` | `https://delivery.builder.example` |
| `BUILDER_CONTENT_API_URL` | `https://content.builder.example` (must equal `CONTENT_API_PUBLIC_URL`) |
| `BUILDER_SITE_ID`, `BUILDER_ENV`, `BUILDER_LOCALE` | From the bootstrap output |
| `BUILDER_DELIVERY_KEY`, `BUILDER_WEBHOOK_SECRET` | From the bootstrap output |
| `BUILDER_EDITOR_ORIGIN` | `https://editor.builder.example` (CSP `frame-ancestors` and edit-mode origin checks) |

## 7. Gate checklist

- [ ] `https://pilot.example.com/` returns 404 before any page is published.
- [ ] In the editor, create the home page, drag in components, publish.
- [ ] The live page shows the change within seconds, without a redeploy. Check the worker log
      for a succeeded webhook, and the webhook's delivery log in the editor's site settings.
- [ ] A preview link opens the draft for someone signed out; the live page stays unchanged.
- [ ] Revoking the link makes it fail.
- [ ] Response headers: `Cache-Tag` on Delivery API responses; `cf-cache-status: HIT` on repeat
      requests; `MISS` again after a publish.

## Open before the pilot

- **Editor sign-in.** The editor's only sign-in today is the development login, which must stay
  off in production. The pilot needs real sign-in for its editors (see the roadmap: auth and
  roles are phase 4).
- **Where the services and database run**, and who owns those accounts and the Cloudflare zone.
- **Domains** for the Content API, Delivery API, editor and pilot host.
