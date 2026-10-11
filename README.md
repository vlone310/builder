# Builder

A headless website builder. The platform stores and edits pages as JSON; each tenant renders
them in its own host app with its own React components. The platform never executes tenant code.

The design lives in the doc "Website Builder — Design Doc: Headless Builder + Tenant Host App".
This repo is the monorepo for every package in it.

## Layout

| Path | Package | What it is |
| --- | --- | --- |
| `packages/core` | `@builder/core` | `defineComponent`, `fields.*`, page document types and schemas, JSON Schema manifests, migrations, validation, Delivery API client. No framework dependency. |
| `packages/core` (editing) | `@builder/core` | JSON Patch (RFC 6902) with inverses, tree operations, editor ↔ host protocol and messenger |
| `packages/react` | `@builder/react` | `<PageRenderer>`, `resolvePage` (loader runner), `<RichText>`; `@builder/react/edit`: the edit bridge (`<EditCanvas>`) |
| `packages/next` | `@builder/next` | `createBuilderPages` (tagged fetches, draft mode), revalidate and preview route handlers, `builderProxy`, edit-mode helpers |
| `packages/db` | `@builder/db` | Drizzle schema for the ten v1 tables, migrations with row-level security, tenancy helpers, demo seed |
| `services/content-api` | `@builder/content-api` | Write API: sites, environments, API keys, pages, drafts, revisions, soft locks, publish |
| `services/delivery-api` | `@builder/delivery-api` | Read-only API for published pages, regions and preview links, CDN cache headers |
| `services/worker` | `@builder/worker` | Delivers the publish outbox: HMAC-signed webhooks with retries, CDN purge by cache tag |
| `apps/sample-host` | `@builder/sample-host` | Next.js host app with sample `core/*` and `igaming/*` components and an edit route |
| `apps/editor` | `@builder/editor` | The editor: page manager, canvas with overlays, palette, layers, props panel, drag-and-drop |
| `e2e` | `@builder/e2e` | Playwright tests of the whole loop, including the drag-and-drop spike |

Tooling: pnpm workspaces, Turborepo, TypeScript, Vitest, Playwright, Biome, Hono, Drizzle,
Postgres 16. The editor uses Vite, Tailwind, Radix, Zustand and TipTap.

## Getting started

Requires Node 22.12+, pnpm 10 and Docker. The full guide is
[docs/local-environment.md](docs/local-environment.md).

```sh
pnpm install
pnpm local:up --app      # Postgres, Keycloak, Vault, Mailpit and every app, in Docker
```

Open the editor at http://localhost:5173 and sign in as `admin@builder.local` / `builder`, an
admin of the demo org. Pick the demo site and a page: the host app loads in the canvas, and you
can drag components in, edit props, undo, and publish. Publishing reaches http://localhost:3000
within about a second, because the worker sends the demo webhook to the host, which revalidates
the page.

http://localhost:3000/sports/football includes an `acme/not-installed@1` node. It renders
nothing on the live site and logs a warning, as the page model requires.

To work on the apps, start only the infra and run them on the host:

```sh
pnpm local:up            # infra, Vault secrets, Keycloak user, migrations, demo data

cp services/delivery-api/.env.example services/delivery-api/.env
cp services/content-api/.env.example services/content-api/.env
cp services/worker/.env.example services/worker/.env
cp apps/sample-host/.env.example apps/sample-host/.env.local
cp apps/editor/.env.example apps/editor/.env
pnpm dev
```

`pnpm db:seed` on its own recreates the demo org without the Keycloak admin; run
`pnpm local:up` again to restore it. The development sign-in (`CONTENT_API_DEV_LOGIN=1` in the
example env) works too, with org `org_demo` and any user id. Never enable it in production.

For development, `pnpm dev` runs all packages in watch mode.

### Calling the Content API

For scripts, get a session token from the dev script (signed with `CONTENT_API_JWT_SECRET`):

```sh
TOKEN=$(pnpm -s --filter @builder/content-api token --org org_demo --role editor --user me)

curl -X POST localhost:4000/v1/sites/st_demo/pages \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"kind":"page","locale":"en","slug":"/promo","content":{"root":{"id":"n1","type":"core/section@1","props":{},"slots":{"children":[{"id":"n2","type":"core/heading@1","props":{"text":"Hello"}}]}}}}'
# → { page: { id }, revisionId }

curl -X POST localhost:4000/v1/pages/<page id>/publish \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"revisionId":"<revision id>"}'
```

The worker delivers the publish webhook, so the host shows the page within about a second.

## Content API (v1)

All routes need `Authorization: Bearer <session token>` with claims `sub`, `org`, `role`. The
editor gets that token from sign-in (below). Every member can read; writes need a permission
from the matrix in `packages/core/src/permissions.ts`:

| Permission | Roles | Covers |
| --- | --- | --- |
| `content.edit` | admin, developer, editor | Pages, drafts, locks, preview links, edit tokens |
| `content.publish` | admin, developer, editor | Publish and unpublish |
| `site.configure` | admin, developer | Environments, API keys, webhooks |
| `site.create` | admin | New sites |
| `members.manage` | admin | Invites, roles, removing members |

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/v1/org` | Current org |
| GET, POST | `/v1/sites` | |
| GET | `/v1/sites/:siteId` | |
| GET, POST | `/v1/sites/:siteId/environments` | `allowedOrigin` defaults to the host URL's origin |
| GET, POST | `/v1/sites/:siteId/api-keys` | Plaintext key returned once on create |
| POST | `/v1/api-keys/:keyId/revoke` | |
| GET, POST | `/v1/sites/:siteId/pages` | Filter with `?kind=` and `?locale=`; create with optional initial `content` |
| GET, PATCH, DELETE | `/v1/pages/:pageId` | PATCH changes the slug |
| POST, DELETE | `/v1/pages/:pageId/lock` | Soft lock for 2 minutes; `{"force": true}` takes over |
| GET, PUT | `/v1/pages/:pageId/draft` | PUT `{ baseRevisionId, content: { root, seo? } }`; 409 if the base is stale, 423 if locked by someone else |
| GET | `/v1/pages/:pageId/revisions` | Newest first |
| GET | `/v1/revisions/:revisionId` | |
| POST | `/v1/pages/:pageId/publish` | `{ revisionId }`; the previous published revision is archived |
| POST | `/v1/pages/:pageId/unpublish` | |
| POST | `/v1/edit-tokens` | `{ siteId, envId }` → a 10-minute ES256 token for that host environment |
| GET, POST | `/v1/sites/:siteId/webhooks` | `{ url, events? }`; the signing secret is returned once |
| DELETE | `/v1/webhooks/:webhookId` | |
| GET | `/v1/webhooks/:webhookId/deliveries` | The last 50 deliveries with status, attempts and errors |
| GET, POST | `/v1/pages/:pageId/preview-links` | `{ revisionId?, envId?, expiresInHours? }` → a share URL with a token, returned once |
| POST | `/v1/preview-links/:linkId/revoke` | |
| GET | `/v1/members` | Members with email and name |
| PATCH, DELETE | `/v1/members/:userId` | `{ role }`; the last admin can be neither demoted nor removed |
| GET, POST | `/v1/invites` | `{ email, role }`; emails the link and returns it; replaces a live invite to the same address |
| POST | `/v1/invites/:inviteId/revoke` | |

Publishing, unpublishing, moving a published page's slug and deleting a published page each
queue a signed webhook per endpoint and a CDN purge, in the same transaction.

Outside `/v1`: `GET /.well-known/jwks.json` (public keys for edit tokens) and, only with
`CONTENT_API_DEV_LOGIN=1`, `POST /auth/dev-login { orgId, userId, role }`.

### Sign-in

Keycloak owns accounts; the builder database owns org membership and roles.

1. The editor signs in with Keycloak: realm `builder`, public client `builder-editor`,
   authorization code with PKCE (`oidc-client-ts`). An audience mapper puts
   `builder-content-api` in the access token.
2. `GET /auth/orgs` (with `Authorization: Bearer <Keycloak access token>`) lists the user's orgs.
   The Content API verifies the token against the realm's JWKS (`KEYCLOAK_ISSUER`,
   `KEYCLOAK_AUDIENCE`, optional internal `KEYCLOAK_JWKS_URL`) and records the user's name and
   email in `users`.
3. `POST /auth/token { orgId }` returns a 15-minute org token for the API. The editor refreshes it
   in the background with a fresh Keycloak token, so role changes apply within 15 minutes.
4. An admin invites an email address with a role. The person opens the invite link
   (`<editor>/#/invite/<token>`), signs in or registers in Keycloak with that address (verified),
   and `POST /auth/invites/accept { token }` makes them a member.

`GET /auth/providers` tells the editor the issuer and client id, and whether the dev login is on.
Invite emails go out over SMTP (`SMTP_URL`, `EMAIL_FROM`); without it they are printed to the log.

## Delivery API (v1)

`Authorization: Bearer <delivery key>`. Responses carry `ETag` (the revision id),
`Cache-Control: s-maxage=300` and `Cache-Tag: builder:page:<id>,builder:slug:<site>:<locale>:<slug>,builder:site:<id>`
for CDN purges.

| Route | Notes |
| --- | --- |
| `GET /v1/sites/:siteId/pages?slug=/a/b&locale=en` | Published page document |
| `GET /v1/sites/:siteId/regions/:name?locale=en` | Published region document |
| `GET /v1/sites/:siteId/preview?token=…` | The revision a preview link points at; `Cache-Control: private, no-store` |

The site id is in every URL so that CDN caches, which key on the URL, never mix sites. A key
only opens its own site's URLs. 404s are tagged with their address, so a first publish purges
them.

## Tenancy

Every table carries `org_id`. Services run tenant queries through `withOrg(db, orgId, fn)`,
which opens a transaction, switches to the `builder_app` role and sets `app.org_id`; Postgres
row-level security then limits every statement to that org. API keys are resolved before the
org is known through a `SECURITY DEFINER` function that matches only on the key hash.
`packages/db/src/rls.test.ts` checks that every tenant table has RLS on and that orgs cannot read or
write each other's rows.

## Editing (phase 2)

The editor and the host app talk only through postMessage (protocol v1 in
`packages/core/src/protocol.ts`), each pinned to the other's exact origin. The editor owns the
document; the host owns rendering.

1. The editor asks the Content API for an edit token and opens
   `<host>/<slug>?builder.edit=<token>` in an iframe.
2. The host's `proxy.ts` rewrites that request to its edit route (live traffic skips the proxy
   entirely). The route verifies the token's ES256 signature against the Content API's JWKS,
   and that it was issued for this site and environment, then loads the edit bridge.
3. The bridge announces `ready` with its component manifests. The editor builds its palette
   and props panels from them and sends `renderTree`.
4. Each edit is a JSON Patch: the editor applies it locally, sends it to the host, keeps the
   inverse for undo, and saves a draft after 800 ms of quiet. The host renders with the
   tenant's own components and reports layout boxes once per animation frame.
5. Loaders run on the host's server through its edit endpoint, cached by component type and
   props, so moving a node never refetches its data.
6. Drag-and-drop lives in the editor: an overlay takes the pointer, computes the drop target
   from the layout boxes (honouring slot allow-lists and constraints), and sends one patch.

To add edit mode to a Next.js host, see `apps/sample-host`: `proxy.ts`,
`app/builder-edit/page.tsx`, `app/builder-edit/api/route.ts` and `builder/edit-canvas.tsx`, plus
the `BUILDER_CONTENT_API_URL`, `BUILDER_SITE_ID`, `BUILDER_ENV` and `BUILDER_EDITOR_ORIGIN`
settings. Components must be able to render in the browser for edit mode; loaders stay
server-side.

The drag-and-drop gate review is in [docs/phase-2-spike.md](docs/phase-2-spike.md).

## Publishing (phase 3)

1. **Publish** marks the revision published and, in the same transaction, writes outbox jobs:
   one webhook per subscribed endpoint and one CDN purge (`packages/db/src/publishing.ts`).
2. **The worker** claims due jobs with `FOR UPDATE SKIP LOCKED`, so several replicas never send
   the same job twice. It POSTs each webhook with
   `builder-signature: t=<unix>,v1=<HMAC-SHA256 of "t.body">` and retries failures with
   backoff (10 s doubling to 1 h, 8 attempts). It purges Cloudflare by cache tag. It refuses
   webhook URLs that resolve to private addresses and never follows redirects.
3. **The host** verifies the signature (5-minute tolerance, two secrets during rotation) and
   calls `revalidateTag` for the page's tags with `{ expire: 0 }`, so the next visitor gets a
   fresh render. Fetches are tagged by address, so a slug that used to be a 404 refreshes too.
4. **Preview links** carry a random token, stored hashed and bound to one revision, with an
   expiry and revocation. The host's preview route checks the token with the Delivery API,
   turns on Next.js draft mode and redirects to the page; only that page shows the draft.

A Next.js host needs `proxy.ts` (`builderProxy`), `app/api/builder/revalidate/route.ts`,
`app/api/builder/preview/route.ts` and `createBuilderPages` for its data. `apps/sample-host`
has all four. Deploying the pilot is covered in [docs/pilot-deployment.md](docs/pilot-deployment.md).

## Decisions made while building phase 1

- **Migration keys**: `migrations: { N: fn }` upgrades props *from* major N to N + 1.
  `defineComponent` refuses a component whose major lacks a migration from any older major.
- **Rich text** is stored as a small JSON tree (paragraphs, headings, lists, marks, links), not
  HTML, so the renderer never has to sanitize markup. Link and image URLs are validated against
  an allow-list of schemes on save and again at render.
- **`constraints.placement`**: `"root"` (only as the page root), `"section"` (anywhere but the
  root) or `"any"`. `maxPerPage` limits instances.
- **Revisions** store the full page document; page meta (slug, name, locale) is taken from the
  `pages` row on read, so renames apply without republishing.
- **Draft saves** use optimistic concurrency (`baseRevisionId`) on top of the soft lock.

## Decisions made while building phase 2

- **Edit rendering is client-side**: the host renders the editor's document in the browser, and
  loaders run on the host's server through the edit endpoint. Prop edits show without a round
  trip; tenant components must be browser-compatible.
- **Edit tokens** are ES256 JWTs (10 minutes, audience `builder-host`, claims for org, site and
  environment). Hosts verify them locally against `/.well-known/jwks.json`; the editor sends
  fresh ones with `init` every 5 minutes. Set `EDIT_TOKEN_PRIVATE_JWK` in production
  (`pnpm --filter @builder/content-api keys:generate`); without it the key is ephemeral.
- **Protocol additions**: `nodeHover` (host → editor) and `scrollBy` (editor → host); see the
  spike report.
- **The palette comes from the host's `ready` message** until the Registry exists (phase 4), so
  the `manifestHash` check against the Registry is not wired yet.
- **A new page** starts with the first container component the host offers as its root.

## Decisions made while building phase 3

- **Outbox in Postgres** (`jobs` table) instead of a queue service: delivery rows double as the
  webhook log in the editor's site settings.
- **Preview tokens are opaque**, stored as SHA-256 hashes and checked by the Delivery API. A
  signed token would add nothing, since showing a draft needs that lookup anyway, and revoking
  is a single update.
- **CDN purge is pluggable**: a Cloudflare adapter and a no-op adapter for development.
- **Delivery API URLs include the site id** (breaking change from phase 1, before any external
  client existed).

## Tests

```sh
pnpm lint
pnpm typecheck
TEST_DATABASE_URL=postgres://builder:builder@localhost:5432/builder_test pnpm test
```

Database-backed tests (RLS, Content API, Delivery API) are skipped when `TEST_DATABASE_URL`
is unset. CI runs everything against a Postgres service.

End-to-end tests start all four apps from their builds and drive the editor in Chromium:

```sh
pnpm build
E2E_DATABASE_URL=postgres://builder:builder@localhost:5432/builder_e2e pnpm e2e
```

They migrate and seed `E2E_DATABASE_URL` themselves. The spike's numbers land in
`e2e/results/spike.json`.

## Roadmap

1. **Foundations** (done): contract, page model, core and react packages, Content and Delivery
   APIs, sample host. Gate: the sample host renders a stored JSON page with SSR.
2. **Editor MVP** (done): iframe canvas, protocol v1, overlays, props panel from JSON Schema, layers,
   drag-and-drop. Gate: drag-and-drop spike review.
3. **Publish** (built; gate needs the pilot deployment): preview links, signed webhooks, CDN purge, `@builder/next` with draft mode and
   tag revalidation. Gate: a first pilot tenant serves live pages.
4. **Safety and scale** (4a sign-in, roles and images done; plan in `docs/phase-4-plan.md`):
   Registry contract, `builder push` / `builder check` in CI, regions, assets, pilot gate on the
   real stack. A second tenant follows the prototype.
