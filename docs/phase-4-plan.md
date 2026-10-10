# Phase 4 plan: safety and scale

Phase 4 lands in four pull requests. The pilot comes first, because the Phase 3 gate (a first pilot
tenant serving live pages) is still open. Each sub-phase ends at a gate.

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
| Assets | Cloudflare R2 with presigned uploads; Cloudflare Images URL transformations |
| Second tenant | An in-repo affiliate host (`apps/affiliate-host`) |

## 4a: Pilot (PR #4)

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
5. **Pilot gate.** Run the checklist against a local stack shaped like production, then on the
   real stack once accounts and the domain exist.

## 4b: Component safety (PR #5)

Gate: a breaking component change fails in tenant CI.

1. **Registry.** `builder push` sends manifests with the git SHA using a site-scoped `cli` key.
   The Registry validates them, stores the manifest hash, and rejects a major bump without a
   migration from the previous major, or a removed component that pages still use and that was
   not deprecated first.
2. **`@builder/cli`.** `push` loads the tenant's registry module through jiti. `check` pulls
   every draft and published tree through an export endpoint, runs the tenant's migrations and
   validation locally, and lists failing pages and nodes. A GitHub Actions template runs check,
   deploy, then push.
3. **Editor.** The palette comes from the Registry before the iframe loads; a banner warns on a
   `manifestHash` mismatch; deprecated components leave the palette but still render.
4. **Migrated props.** A new `migrated` message (host → editor) reports props the host upgraded
   at render, and the editor saves them on the next edit.

## 4c: Regions and assets (PR #6)

1. **Regions.** `<BuilderRegion name>` and `fetchRegion` with cache tags, an edit route for
   regions, a region list and region editing in the editor, a region on a hand-coded page in the
   sample host.
2. **Assets.** A new `services/assets`: presigned uploads to R2, rows in `assets`, a media
   library in the editor wired to the `image` field, an SDK image URL helper using Cloudflare
   Images transformations, MinIO for local development.

## 4d: Follow-ups and second tenant (PR #7)

Gate: a second tenant from another vertical is onboarded.

1. Firefox and WebKit Playwright projects in CI.
2. Memoised edit rendering and layout diffs, benchmarked above 150 nodes against the Phase 2
   spike thresholds.
3. A drag-and-drop review build with drop-feel telemetry and a session script; the review
   itself needs someone who edits pages daily.
4. `apps/affiliate-host`: an offer table, a comparison block, a tracking-link field and a region
   on a hand-coded page, onboarded through bootstrap and the push/check CI template, with e2e
   tests across both tenants including an isolation check.

## Not in phase 4

`builder codegen`, `builder dev`, Kubernetes manifests (Helm or kustomize), and identity
brokering in Keycloak (company SSO).

## Inputs needed

These block only the real deploy and the gate run, not the build:

- The dedicated domain's name.
- The cluster, its Vault and External Secrets setup, the Postgres offering and the image
  registry.
- Who owns the Cloudflare zone and the SMTP account.
