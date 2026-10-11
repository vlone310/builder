# Phase 4 plan: safety and scale

Phase 4a (sign-in, roles, images) is merged. The rest is replanned so development never waits on
infrastructure: the cluster, Vault, domain, Registry service and Helm charts are built in parallel
by the platform owner, and every PR below runs on the local environment alone.

## Decisions

| Area | Decision |
| --- | --- |
| Editor sign-in | Keycloak (OIDC). The editor is a public client using authorization code with PKCE. The Content API exchanges the Keycloak token for its 15-minute org token |
| Accounts and roles | Accounts live in Keycloak (self-registration with email verification). Org membership and roles live in our database, granted by invites |
| Email | SMTP for invites; Keycloak's own SMTP for verification and resets; Mailpit locally |
| Hosting | Kubernetes, one image per deployable (services, editor, sample host, Keycloak) |
| Secrets | Vault (KV v2, `secret/builder/<deployable>`), synced to Kubernetes Secrets by External Secrets Operator; the apps read env only |
| Local environment | docker compose: Postgres, Keycloak, Vault (dev), Mailpit, plus an `app` profile running every image |
| Domains | A new dedicated domain on Cloudflare, with subdomains per service |
| CDN | Cloudflare in front of the Delivery API; purge by tag |
| CLI | Loads the tenant's registry module locally; `check` runs tenant migrations in tenant CI |
| CI | Self-hosted GitLab (Docker executor), images pushed to Harbor (`docs/gitlab-ci.md`) |
| Assets | Inside the Content API (no new deployable). Any S3-compatible store: MinIO locally, R2 or in-cluster MinIO in production. Image transformations optional, behind a URL helper |
| Registry | Built by the platform owner. This repo owns its contract (types and an in-memory stub in `@builder/core`) |
| Second tenant | Deferred until after the prototype |

## 4a: Pilot (PR #4, merged)

Gate: the pilot gate checklist in `docs/pilot-deployment.md` passes.

1. **Sign-in.** The editor signs in with Keycloak and exchanges the Keycloak access token for the
   existing org-scoped session JWT (`POST /auth/token`, with an org picker when a user has several
   memberships). Existing middleware and row-level security stay as they are. The dev login stays
   behind its flag.
2. **Roles and permissions.** One permission matrix for admin, developer, editor and viewer,
   enforced on every Content API route; the editor hides actions a role can't take. Invites by
   email with a role, and a Members screen. The bootstrap script creates the first admin's
   invite.
3. **Deploy.** Dockerfiles for every deployable, a local environment in docker compose with
   Keycloak, Vault and Mailpit (`docs/local-environment.md`), and the image contract for
   Kubernetes (`docs/kubernetes.md`). Kubernetes manifests follow later.
4. **CI.** Build every image, migrate a fresh database from the service images, and start each
   image to check it answers.
5. **Pilot gate.** Moved to 4e: it needs the real stack.

## Who builds what

| Track | Owner | Needs from the other track |
| --- | --- | --- |
| Cluster, Vault, ESO, Postgres, image registry, domain, Cloudflare, SMTP | Platform owner | The image contract in `docs/kubernetes.md`, including the S3 settings below |
| Helm charts | Platform owner | Same; no new deployables in 4b–4d |
| Registry service | Platform owner | The Registry contract (4b) |
| 4b–4d below | This repo | Nothing: each runs on `pnpm local:up` |
| 4e pilot gate | Both | The deployed stack |

The charts can be written today. The only setting not in `docs/kubernetes.md` yet is the Content
API's object storage, added there ahead of 4d: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
`S3_PUBLIC_URL`, `S3_FORCE_PATH_STYLE` (Deployment env) and `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY` (Vault `secret/builder/content-api`). The bucket needs CORS allowing `PUT`
from the editor origin.

## 4b: Registry contract (PR #5, small, first)

Unblocks the Registry service. Gate: the platform owner signs off on the contract.

1. Types and zod schemas in `@builder/core`: a pushed manifest (components, versions, deprecations,
   manifest hash, git SHA), the push result with rejection reasons, and the read API the editor
   and CLI use (current manifest per site and environment).
2. The rules as a pure function: a major bump needs a migration from the previous major; a
   component pages still use can only be removed after it was deprecated. The Registry service
   calls the same function, so both sides agree.
3. An in-memory stub implementing the contract, used by tests and the local environment until
   the real Registry is deployed. One setting (`BUILDER_REGISTRY_URL`) switches to the real one.

## 4c: Component safety, client side (PR #6)

Gate: a breaking component change fails `builder check` in a tenant's CI.

1. **Export endpoint.** A site-scoped `cli` key reads every draft and published tree.
2. **`@builder/cli`.** `push` loads the tenant's registry module through jiti and sends it to the
   Registry. `check` pulls the trees, runs the tenant's migrations and validation locally, and
   lists failing pages and nodes. A GitLab CI template for tenant repositories runs check, deploy,
   then push.
3. **Editor.** The palette comes from the Registry before the iframe loads; a banner warns on a
   `manifestHash` mismatch; deprecated components leave the palette but still render.
4. **Migrated props.** A `migrated` message (host → editor) reports props the host upgraded at
   render, and the editor saves them on the next edit.

## 4d: Regions and assets (PR #7)

Gate: an editor builds a page with an uploaded image and edits a shared region, locally.

1. **Regions.** `<BuilderRegion name>` and `fetchRegion` with cache tags, an edit route for
   regions, a region list and region editing in the editor, a region on a hand-coded page in the
   sample host.
2. **Assets.** Presigned uploads from the Content API to the S3 store, rows in `assets` (RLS per
   org), a media library in the editor wired to the `image` field, and an SDK image URL helper
   with a pluggable transformer (none by default, Cloudflare Images optional). MinIO joins the
   local environment.

## 4e: Pilot gate (PR #8)

Gate: the checklist in `docs/pilot-deployment.md` passes on the real stack.

Starts once the cluster, domain and charts exist. Expected work: fixes found while deploying,
and the Registry URL and S3 settings in place.

## After the prototype

1. Second tenant from another vertical (`apps/affiliate-host`), onboarded through bootstrap and
   the CI template, with a cross-tenant isolation e2e test. This was Phase 4's original final
   gate.
2. Firefox and WebKit Playwright projects in CI.
3. Memoised edit rendering and layout diffs, benchmarked above 150 nodes against the Phase 2
   spike thresholds.
4. A drag-and-drop review build with drop-feel telemetry; the review needs someone who edits
   pages daily.

## Not in phase 4

`builder codegen`, `builder dev`, and identity brokering in Keycloak (company SSO).

## Inputs needed

These block only 4e, not the build:

- The dedicated domain's name.
- The cluster, its Vault and External Secrets setup, the Postgres offering, the image registry
  and the object storage.
- Who owns the Cloudflare zone and the SMTP account.
