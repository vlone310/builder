# Local environment

One command starts what the platform needs: Postgres, Keycloak, Vault and Mailpit in Docker,
with the builder realm, secrets, a local admin and the demo org in place.

Requires Docker with Compose v2, Node 22.12+ and pnpm 10. Run `pnpm install` first.

```sh
pnpm local:up          # infra in Docker; run the apps yourself with `pnpm dev`
pnpm local:up --app    # infra and every app in Docker, built from their Dockerfiles
pnpm local:down        # stop (add --volumes to delete the Postgres data)
```

Then open the editor at http://localhost:5173 and sign in as **admin@builder.local** with
password **builder**. That user is an admin of the demo org.

## What runs

| Service | URL | Login |
| --- | --- | --- |
| Editor | http://localhost:5173 | `admin@builder.local` / `builder` |
| Sample host | http://localhost:3000 | |
| Content API | http://localhost:4000 | |
| Delivery API | http://localhost:4001 | |
| Keycloak | http://localhost:8080 | admin console: `admin` / `admin` |
| Vault | http://localhost:8200 | token `dev-root` |
| Mailpit | http://localhost:8025 | every email Keycloak and the Content API send |
| Postgres | `localhost:5432` | `builder` / `builder`; databases `builder`, `builder_test`, `builder_e2e`, `keycloak` |

Set `BUILDER_PG_PORT` if 5432 is taken.

## What `pnpm local:up` does

1. Starts Postgres, Keycloak (built from `infra/keycloak/Dockerfile`, realm imported), Vault in
   dev mode and Mailpit, and waits until each is healthy.
2. `scripts/local/vault-seed.sh` writes the secrets to Vault at `secret/builder/<deployable>`:
   random JWT and worker secrets, a fresh edit-token key, database URLs, the demo delivery key.
   Existing paths are kept; `--force` regenerates them.
3. `scripts/local/vault-env.sh` renders each path to `.local/env/<deployable>.env`. In a cluster
   External Secrets Operator does this step, turning the same paths into Kubernetes Secrets (see
   [kubernetes.md](kubernetes.md)). `.local/` is git- and docker-ignored.
4. `scripts/local/keycloak-user.sh` creates the verified `admin@builder.local` user.
5. Migrates the `builder` database and seeds the demo org, with that user as its admin.
6. With `--app`: builds the images and starts migrations, Content API, Delivery API, worker,
   sample host and editor, using the rendered env files for secrets.

Vault runs in dev mode, in memory: after it restarts, run `pnpm local:up` again to re-seed.

## Running the apps on the host

With `pnpm local:up` (no `--app`), copy each `.env.example` to `.env` as the README describes and
run `pnpm dev`. The examples point at the Docker infra: Keycloak at `localhost:8080`, Mailpit's
SMTP at `localhost:1025`. Host processes use those development values rather than Vault.

## Sign-in

- Keycloak realm `builder`, client `builder-editor` (public, authorization code with PKCE).
- "Create an account" in the editor opens Keycloak's registration. Keycloak sends the
  verification email to Mailpit.
- Anyone can create an account, but only an invite grants access to an org. Invite people from
  the editor's Members page. The invite email lands in Mailpit too.
- The development login (`CONTENT_API_DEV_LOGIN=1`) still works for host runs and tests.

More users: `scripts/local/keycloak-user.sh someone@example.com their-password`.

## Tests

- Unit and integration: `TEST_DATABASE_URL=postgres://builder:builder@localhost:5432/builder_test pnpm test`.
- End to end: `pnpm turbo run build`, then
  `E2E_DATABASE_URL=postgres://builder:builder@localhost:5432/builder_e2e pnpm e2e`. Playwright
  reuses the Keycloak on port 8080, or starts a throwaway one with `docker run` when none runs.
  Stop the `--app` containers first: the e2e suite starts its own apps on the same ports.
