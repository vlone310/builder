# Builder

A headless website builder. The platform stores and edits pages as JSON; each tenant renders
them in its own host app with its own React components. The platform never executes tenant code.

The design lives in the doc "Website Builder — Design Doc: Headless Builder + Tenant Host App".
This repo is the monorepo for every package in it.

## Layout

| Path | Package | What it is |
| --- | --- | --- |
| `packages/core` | `@builder/core` | `defineComponent`, `fields.*`, page document types and schemas, JSON Schema manifests, migrations, validation, Delivery API client. No framework dependency. |
| `packages/react` | `@builder/react` | `<PageRenderer>`, `resolvePage` (loader runner), `<RichText>` |
| `packages/db` | `@builder/db` | Drizzle schema for the ten v1 tables, migrations with row-level security, tenancy helpers, demo seed |
| `services/content-api` | `@builder/content-api` | Write API: sites, environments, API keys, pages, drafts, revisions, soft locks, publish |
| `services/delivery-api` | `@builder/delivery-api` | Read-only API for published pages and regions, CDN cache headers |
| `apps/sample-host` | `@builder/sample-host` | Next.js host app with sample `core/*` and `igaming/*` components |

Tooling: pnpm workspaces, Turborepo, TypeScript, Vitest, Biome, Hono, Drizzle, Postgres 16.

## Getting started

Requires Node 22.12+, pnpm 10 and Postgres 16 (or Docker).

```sh
pnpm install
docker compose up -d                      # Postgres on localhost:5432 (builder/builder)

cp packages/db/.env.example packages/db/.env
cp services/delivery-api/.env.example services/delivery-api/.env
cp services/content-api/.env.example services/content-api/.env   # set CONTENT_API_JWT_SECRET
cp apps/sample-host/.env.example apps/sample-host/.env.local

pnpm db:migrate
pnpm db:seed                              # demo org, site, delivery key and two published pages
pnpm build
pnpm --filter @builder/delivery-api start # :4001
pnpm --filter @builder/content-api start  # :4000
pnpm --filter @builder/sample-host start  # :3000
```

Open http://localhost:3000 and http://localhost:3000/sports/football. The football page includes
an `acme/not-installed@1` node: it renders nothing on the live site and logs a warning, as the
page model requires.

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

## Tests

```sh
pnpm lint
pnpm typecheck
TEST_DATABASE_URL=postgres://builder:builder@localhost:5432/builder_test pnpm test
```

Database-backed tests (RLS, Content API, Delivery API) are skipped when `TEST_DATABASE_URL`
is unset. CI runs everything against a Postgres service.

## Roadmap

1. **Foundations** (this): contract, page model, core and react packages, Content and Delivery
   APIs, sample host. Gate: the sample host renders a stored JSON page with SSR.
2. **Editor MVP**: iframe canvas, protocol v1, overlays, props panel from JSON Schema, layers,
   drag-and-drop. Gate: drag-and-drop spike review.
3. **Publish**: preview links, signed webhooks, CDN purge, `@builder/next` with draft mode and
   tag revalidation. Gate: a first pilot tenant serves live pages.
4. **Safety and scale**: `builder push` / `builder check` in CI, Registry, regions, assets,
   roles. Gate: a second tenant from another vertical.
