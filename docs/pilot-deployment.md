# Pilot deployment

Phase 3's gate is a first pilot tenant serving live pages. The platform services and Postgres
run on Railway, the editor and the pilot host run on Vercel, and Cloudflare holds a new
dedicated domain and caches the Delivery API. This runbook covers each piece in order.

`<domain>` below stands for the dedicated domain, which is not chosen yet.

## What runs where

| Piece | Runs on | Public URL |
| --- | --- | --- |
| Postgres 16 | Railway Postgres, same project, private network | none |
| Content API | Railway service (`services/content-api/railway.json`) | `https://content.<domain>` |
| Delivery API | Railway service (`services/delivery-api/railway.json`), proxied by Cloudflare | `https://delivery.<domain>` |
| Worker | Railway service (`services/worker/railway.json`), one replica | none (health on `/health`) |
| Editor | Vercel (`apps/editor`, static) | `https://editor.<domain>` |
| Pilot host | Vercel (`apps/sample-host`) | `https://pilot.<domain>` |

The editor and the Content API must share the registrable domain (`editor.<domain>` and
`content.<domain>`). The sign-in cookie is set by the Content API and sent on the editor's calls
only when both are on the same site. A Vercel preview URL (`*.vercel.app`) for the editor
therefore cannot sign in; use the dev login there or a preview subdomain of `<domain>`.

## Accounts

| Account | Holds | Owner |
| --- | --- | --- |
| Railway | Project with Postgres and the three services | open |
| Cloudflare | Zone for `<domain>`, Cache Rule, purge API token | open |
| Vercel | Editor and pilot host projects | open |
| Resend | Verified sending domain `<domain>` | open |
| Google Cloud (optional) | OAuth client for "Continue with Google" | open |
| Registrar | `<domain>`, nameservers pointed at Cloudflare | open |

## 1. Railway project

1. Create a project and add **Postgres** (version 16). The default `postgres` user owns the
   tables, which migrations need: they create the `builder_app` role and row-level security
   policies.
2. Add three services from this GitHub repo, all with the repository root as root directory:

   | Service | Config file path | `SERVICE` variable |
   | --- | --- | --- |
   | content-api | `services/content-api/railway.json` | `content-api` |
   | delivery-api | `services/delivery-api/railway.json` | `delivery-api` |
   | worker | `services/worker/railway.json` | `worker` |

   Each config builds the root `Dockerfile`. Railway passes the `SERVICE` service variable to
   the build as the `SERVICE` build argument, which picks the service. Each config runs
   `node dist/migrate.js` as the pre-deploy command, so migrations apply before the new version
   starts. The three services may run it at once; an advisory lock makes them take turns. Keep
   migrations backward compatible (add, then remove in a later release), because the old version
   keeps serving while the new one deploys.
3. Set the variables below. Reference Postgres with `${{Postgres.DATABASE_URL}}` so traffic stays
   on the private network.
4. Generate public domains for content-api and delivery-api, then add the custom domains
   `content.<domain>` and `delivery.<domain>` (step 3 covers DNS). The worker needs none.

| Variable | Content API | Delivery API | Worker | Notes |
| --- | --- | --- | --- | --- |
| `SERVICE` | `content-api` | `delivery-api` | `worker` | Build argument |
| `DATABASE_URL` | ✓ | ✓ | ✓ | `${{Postgres.DATABASE_URL}}` |
| `PORT` | | | | Railway sets it |
| `CONTENT_API_JWT_SECRET` | ✓ | | | 32+ random characters; signs org tokens |
| `CONTENT_API_PUBLIC_URL` | ✓ | | | `https://content.<domain>`; edit token issuer, magic-link base |
| `EDIT_TOKEN_PRIVATE_JWK` | ✓ | | | `pnpm --filter @builder/content-api keys:generate` |
| `EDITOR_ORIGIN` | ✓ | | | `https://editor.<domain>`; CORS and sign-in callbacks |
| `BETTER_AUTH_SECRET` | ✓ | | | 32+ random characters, different from the JWT secret |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✓ | | | `Builder <no-reply@<domain>>` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | | | Redirect URI `https://content.<domain>/auth/callback/google` |
| `CONTENT_API_DEV_LOGIN`, `EMAIL_OUTBOX_FILE` | **unset** | | | Development only |
| `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` | | | ✓ | Token with "Cache Purge" on the zone |
| `WORKER_RUN_SECRET` | | | optional | Only if a scheduler calls `/run` |
| `WEBHOOK_ALLOW_PRIVATE` | | | **unset** | Production webhooks must be public HTTPS |

Without `RESEND_API_KEY` the Content API prints sign-in links to its log. That is acceptable for a
first smoke test only.

## 2. Email (Resend)

1. Add `<domain>` as a sending domain in Resend and create its DNS records (SPF, DKIM) in
   Cloudflare, DNS only.
2. Create an API key with sending access and set `RESEND_API_KEY` and `EMAIL_FROM` on the Content
   API.

## 3. Cloudflare

1. Add `<domain>` as a zone and point the registrar's nameservers at Cloudflare.
2. DNS records:

   | Name | Target | Proxy |
   | --- | --- | --- |
   | `delivery` | Railway's target for the custom domain | Proxied |
   | `content` | Railway's target for the custom domain | DNS only |
   | `editor` | `cname.vercel-dns.com` | DNS only |
   | `pilot` | `cname.vercel-dns.com` | DNS only |

   With `delivery` proxied, set SSL/TLS to **Full (strict)**.
3. Add a Cache Rule for `delivery.<domain>`: eligible for cache, Edge TTL "use cache-control
   header if present". Cloudflare does not cache JSON by default.
4. Responses carry `Cache-Tag` (`builder:page:…`, `builder:slug:…`, `builder:site:…`) and the
   worker purges those tags on every publish. Purge by tag is available on every plan, with lower
   rate limits on Free; check the zone's purge quota covers the expected publish rate.
5. Create an API token with **Zone → Cache Purge → Purge** on this zone and set it, with the zone
   id, on the worker.
6. Every Delivery API URL includes the site id (`/v1/sites/<site>/pages?…`), so cache entries stay
   per site even though Cloudflare ignores `Vary: Authorization`. Cached responses are published
   pages, which are public on the live site anyway. Previews are never cached.

## 4. Editor on Vercel

- Project root directory `apps/editor`; `apps/editor/vercel.json` sets the monorepo build.
- Environment: `VITE_CONTENT_API_URL=https://content.<domain>`.
- Domain: `editor.<domain>`.

## 5. Tenant data and the first admin

From a checkout, with `DATABASE_URL` set to the Railway database's public connection string:

```sh
pnpm --filter @builder/db bootstrap --org "Pilot" --site "pilot.<domain>" \
  --host-url https://pilot.<domain> --env prod \
  --admin-email <first admin's email> --editor-url https://editor.<domain>
```

The output holds:

- the host app's environment: site id, delivery key and webhook secret. Store it in the host's
  Vercel project right away; the secrets are not shown again;
- the admin's invite link, valid for 7 days. Send it to them. They sign in with an email link,
  join the org, and invite everyone else from the editor's Members page.

The command also registers the webhook at `https://pilot.<domain>/api/builder/revalidate`.

## 6. Pilot host on Vercel

- Project root directory `apps/sample-host`; `apps/sample-host/vercel.json` sets the monorepo
  build.
- Domain: `pilot.<domain>`.
- Environment:

| Variable | Value |
| --- | --- |
| `BUILDER_DELIVERY_URL` | `https://delivery.<domain>` |
| `BUILDER_CONTENT_API_URL` | `https://content.<domain>` (must equal `CONTENT_API_PUBLIC_URL`) |
| `BUILDER_SITE_ID`, `BUILDER_ENV`, `BUILDER_LOCALE` | From the bootstrap output |
| `BUILDER_DELIVERY_KEY`, `BUILDER_WEBHOOK_SECRET` | From the bootstrap output |
| `BUILDER_EDITOR_ORIGIN` | `https://editor.<domain>` (CSP `frame-ancestors` and edit-mode origin checks) |

## Sign-in and roles

- People sign in with an email link (Better Auth in the Content API), or Google when configured.
  Only addresses with a live invite can create an account.
- After sign-in the editor exchanges the sign-in cookie for a 15-minute org token and refreshes it
  in the background. Role changes and removals apply at the next refresh, within 15 minutes.
- Roles: **admin** (everything, including members), **developer** (edit and publish;
  environments, API keys, webhooks), **editor** (edit and publish), **viewer** (read only). The
  matrix lives in `packages/core/src/permissions.ts`; an org always keeps at least one admin.

## 7. Gate checklist

Sign-in:

- [ ] The bootstrap invite link signs the first admin in by email and lands on the Sites page.
- [ ] The admin invites an editor from Members; the email arrives from `<domain>`; the editor
      joins and sees the editor role.
- [ ] An address without an invite gets no email and no account.
- [ ] `POST https://content.<domain>/auth/dev-login` returns 404.

Publishing:

- [ ] `https://pilot.<domain>/` returns 404 before any page is published.
- [ ] In the editor, create the home page, drag in components, publish.
- [ ] The live page shows the change within seconds, without a redeploy. Check the worker log
      for a succeeded webhook, and the webhook's delivery log in the editor's site settings.
- [ ] A preview link opens the draft for someone signed out; the live page stays unchanged.
- [ ] Revoking the link makes it fail.
- [ ] Response headers: `Cache-Tag` on Delivery API responses; `cf-cache-status: HIT` on repeat
      requests; `MISS` again after a publish.

## Local rehearsal

The stack was rehearsed locally on 2026-10-10, without Cloudflare and the real domain:

| Check | How | Result |
| --- | --- | --- |
| Images build, migrate a fresh database twice, and pass `/health` | `docker build` per service, `node dist/migrate.js`, container start | Passed for all three |
| Invite → email link → join → sign out | e2e `auth.spec.ts` | Passed |
| Uninvited address and used link refused | e2e `auth.spec.ts` | Passed |
| 404 before publish, publish reaches the live page, preview links, revoke | e2e `publishing.spec.ts` | Passed |
| Cloudflare `Cache-Tag` purge and `cf-cache-status` | Needs the zone | Not run |
| Real email delivery from `<domain>` | Needs Resend and DNS | Not run |

## Still open

- The domain's name.
- Who owns each account in the table above, and who sets the secrets.
- A Google OAuth client, if Google sign-in is wanted.
