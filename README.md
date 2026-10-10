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
| `packages/next` | `@builder/next` | Edit-token verification (ES256, JWKS), the edit endpoint for loaders and options, the edit-route proxy rewrite |
| `packages/db` | `@builder/db` | Drizzle schema for the ten v1 tables, migrations with row-level security, tenancy helpers, demo seed |
| `services/content-api` | `@builder/content-api` | Write API: sites, environments, API keys, pages, drafts, revisions, soft locks, publish |
| `services/delivery-api` | `@builder/delivery-api` | Read-only API for published pages and regions, CDN cache headers |
| `apps/sample-host` | `@builder/sample-host` | Next.js host app with sample `core/*` and `igaming/*` components and an edit route |
| `apps/editor` | `@builder/editor` | The editor: page manager, canvas with overlays, palette, layers, props panel, drag-and-drop |
| `e2e` | `@builder/e2e` | Playwright tests of the whole loop, including the drag-and-drop spike |

Tooling: pnpm workspaces, Turborepo, TypeScript, Vitest, Playwright, Biome, Hono, Drizzle,
Postgres 16. The editor uses Vite, Tailwind, Radix, Zustand and TipTap.

## Getting started

Requires Node 22.12+, pnpm 10 and Postgres 16 (or Docker).

```sh
pnpm install
docker compose up -d                      # Postgres on localhost:5432 (builder/builder)

cp packages/db/.env.example packages/db/.env
cp services/delivery-api/.env.example services/delivery-api/.env
cp services/content-api/.env.example services/content-api/.env   # set CONTENT_API_JWT_SECRET
cp apps/sample-host/.env.example apps/sample-host/.env.local
cp apps/editor/.env.example apps/editor/.env

pnpm db:migrate
pnpm db:seed                              # demo org, site, delivery key and two published pages
pnpm build
pnpm --filter @builder/delivery-api start # :4001
pnpm --filter @builder/content-api start  # :4000
pnpm --filter @builder/sample-host start  # :3000
pnpm --filter @builder/editor preview     # :5173
```

Open http://localhost:3000 and http://localhost:3000/sports/football. The football page includes
an `acme/not-installed@1` node: it renders nothing on the live site and logs a warning, as the
page model requires.

Open the editor at http://localhost:5173 and sign in with org `org_demo` and any user id (the
dev sign-in is on in `.env.example`; never enable it in production). Pick the demo site and a
page: the host app loads in the canvas, and you can drag components in, edit props, undo, and
publish.

For development, `pnpm dev` runs all packages in watch mode.

### Calling the Content API

Until the auth service exists, get a session token from the dev script (signed with
`CONTENT_API_JWT_SECRET`):

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

The host shows the page after its ISR window (60 s). Publish webhooks will make this immediate
in phase 3.

## Content API (v1)

All routes need `Authorization: Bearer <session token>` with claims `sub`, `org`, `role`.
Roles: `admin` manages sites; `admin` and `developer` manage environments and API keys;
`admin`, `developer` and `editor` edit and publish; `viewer` reads.

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

Outside `/v1`: `GET /.well-known/jwks.json` (public keys for edit tokens) and, only with
`CONTENT_API_DEV_LOGIN=1`, `POST /auth/dev-login { orgId, userId, role }`.

## Delivery API (v1)

`Authorization: Bearer <delivery key>`. Responses carry `ETag` (the revision id),
`Cache-Control: s-maxage=300` and `Cache-Tag: site:<id>,page:<id>` for CDN purges.

| Route | Notes |
| --- | --- |
| `GET /v1/pages?slug=/a/b&locale=en` | Published page document |
| `GET /v1/regions/:name?locale=en` | Published region document |

## Tenancy

Every table carries `org_id`. Services run tenant queries through `withOrg(db, orgId, fn)`,
which opens a transaction, switches to the `builder_app` role and sets `app.org_id`; Postgres
row-level security then limits every statement to that org. API keys are resolved before the
org is known through a `SECURITY DEFINER` function that matches only on the key hash.
`packages/db/src/rls.test.ts` checks that every table has RLS on and that orgs cannot read or
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
2. **Editor MVP** (built; gate under review): iframe canvas, protocol v1, overlays, props panel from JSON Schema, layers,
   drag-and-drop. Gate: drag-and-drop spike review.
3. **Publish**: preview links, signed webhooks, CDN purge, `@builder/next` with draft mode and
   tag revalidation. Gate: a first pilot tenant serves live pages.
4. **Safety and scale**: `builder push` / `builder check` in CI, Registry, regions, assets,
   roles. Gate: a second tenant from another vertical.
