# Kubernetes

Everything runs in Kubernetes: six images, one Postgres, and Vault for secrets.
External Secrets Operator (ESO) syncs each Vault path into a Kubernetes Secret, and
the pods load it with `envFrom`. The apps read only environment variables; none of
them talks to Vault.

This page is the contract each image offers. Manifests (Helm or kustomize) are not
written yet.

## Images

| Deployable | Dockerfile | Build context | Port | Runs as |
| --- | --- | --- | --- | --- |
| Content API | `Dockerfile` with `--build-arg SERVICE=content-api` | repo root | 4000 (`PORT`) | `node` |
| Delivery API | `Dockerfile` with `--build-arg SERVICE=delivery-api` | repo root | 4001 (`PORT`) | `node` |
| Worker | `Dockerfile` with `--build-arg SERVICE=worker` | repo root | 4002 (`PORT`, health only) | `node` |
| Editor | `apps/editor/Dockerfile` | repo root | 8080 | nginx (uid 101) |
| Sample host | `apps/sample-host/Dockerfile` | repo root | 3000 (`PORT`) | `node` |
| Keycloak | `infra/keycloak/Dockerfile` | `infra/keycloak` | 8080, management 9000 | `keycloak` |

```sh
docker build --build-arg SERVICE=content-api -t builder/content-api .
docker build -f apps/editor/Dockerfile -t builder/editor .
docker build -t builder/keycloak infra/keycloak
```

CI builds every image on each merge request, starts each one, and pushes the images that
answered to Harbor as `<harbor>/<project>/<name>:<commit sha>` (`images` job in `.gitlab-ci.yml`,
see `docs/gitlab-ci.md`).

## Probes

| Deployable | Readiness and liveness | Notes |
| --- | --- | --- |
| Content API, Delivery API, Worker | `GET /health` on `PORT` | |
| Editor | `GET /healthz` on 8080 | |
| Sample host | `GET /` or any page on 3000 | Tenant apps define their own |
| Keycloak | readiness `GET /realms/builder/.well-known/openid-configuration` on 8080; liveness `GET /health/live` on 9000 | `/health/ready` turns UP while Keycloak is still bootstrapping and answering 503, so gate traffic on the realm |

Keycloak takes 20–60 s to start; give it a `startupProbe` with room for that.

## Migrations

Every service image contains `dist/migrate.js` and the SQL migrations. Run them before a
release, as a Job or an init container, with the Content API image:

```yaml
command: ["node", "dist/migrate.js"]
envFrom: [{ secretRef: { name: builder-content-api } }]
```

Concurrent runs are safe: an advisory lock makes them take turns. Keep migrations backward
compatible (add, then remove in a later release), because old pods keep serving during a
rollout. The database user must own the tables: migrations create the `builder_app` role and
row-level security policies.

## Configuration and secrets

Plain settings go in the Deployment (or a ConfigMap). Secrets live in Vault under
`secret/builder/<deployable>` (KV v2), and ESO turns each path into a Secret of the same name.

| Deployable | Settings (Deployment env) | Secrets (Vault `secret/builder/…`) |
| --- | --- | --- |
| Content API | `CONTENT_API_PUBLIC_URL`, `EDITOR_ORIGIN`, `EDITOR_URL`, `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`, `KEYCLOAK_EDITOR_CLIENT_ID`, `KEYCLOAK_JWKS_URL`, `EMAIL_FROM`, `DATABASE_POOL_SIZE` | `content-api`: `DATABASE_URL`, `CONTENT_API_JWT_SECRET`, `EDIT_TOKEN_PRIVATE_JWK`, `SMTP_URL` |
| Delivery API | `DATABASE_POOL_SIZE` | `delivery-api`: `DATABASE_URL` |
| Worker | `WORKER_POLL_MS` | `worker`: `DATABASE_URL`, `WORKER_RUN_SECRET`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` |
| Editor | `CONTENT_API_URL` | none |
| Sample host | `BUILDER_DELIVERY_URL`, `BUILDER_CONTENT_API_URL`, `BUILDER_CONTENT_API_JWKS_URL`, `BUILDER_SITE_ID`, `BUILDER_ENV`, `BUILDER_LOCALE`, `BUILDER_EDITOR_ORIGIN` | `sample-host`: `BUILDER_DELIVERY_KEY`, `BUILDER_WEBHOOK_SECRET` |
| Keycloak | `KC_DB_URL`, `KC_DB_USERNAME`, `KC_HOSTNAME`, `KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED=true`, `KC_BOOTSTRAP_ADMIN_USERNAME`, `BUILDER_EDITOR_URL`, `BUILDER_SMTP_*` | `keycloak`: `KC_DB_PASSWORD`, `KC_BOOTSTRAP_ADMIN_PASSWORD` (and `BUILDER_SMTP_PASSWORD` if SMTP needs auth) |

**Coming in phase 4d (assets):** the Content API also reads object storage settings. They are
optional until then; add them to the charts now so the release that ships assets needs no chart
change.

| Kind | Variables |
| --- | --- |
| Deployment env | `S3_ENDPOINT` (any S3-compatible API: R2, MinIO, S3), `S3_REGION` (`auto` for R2), `S3_BUCKET`, `S3_PUBLIC_URL` (where browsers fetch objects), `S3_FORCE_PATH_STYLE` (`true` for MinIO) |
| Vault `secret/builder/content-api` | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |

The bucket's CORS must allow `PUT` from the editor origin (browsers upload with presigned URLs).

Never set these in a cluster: `CONTENT_API_DEV_LOGIN`, `EMAIL_OUTBOX_FILE`,
`WEBHOOK_ALLOW_PRIVATE`.

Generate `EDIT_TOKEN_PRIVATE_JWK` with `pnpm --filter @builder/content-api keys:generate`, and the
random secrets with `openssl rand -base64 32`.

An ExternalSecret for one path, pulling every key:

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: builder-content-api
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: vault            # a store using Vault's Kubernetes auth, KV v2 mounted at secret/
  target:
    name: builder-content-api
  dataFrom:
    - extract:
        key: builder/content-api
```

Pods read Secrets at start, so restart them after a secret changes (or use a reloader).

## Public and internal addresses

Browsers and servers reach some services at different addresses. Each such service takes the
public URL (what tokens and links carry) plus an optional internal one:

| Setting | Public (in tokens and links) | Internal (pod to pod) |
| --- | --- | --- |
| Keycloak | `KEYCLOAK_ISSUER=https://auth.<domain>/realms/builder` | `KEYCLOAK_JWKS_URL=http://keycloak:8080/realms/builder/protocol/openid-connect/certs` |
| Content API keys for hosts | `BUILDER_CONTENT_API_URL=https://content.<domain>` | `BUILDER_CONTENT_API_JWKS_URL=http://content-api:4000/.well-known/jwks.json` |
| Delivery API for hosts | n/a | `BUILDER_DELIVERY_URL` (in-cluster for the sample host; public, behind Cloudflare, for tenants elsewhere) |

## Ingress

| Host | Service | Notes |
| --- | --- | --- |
| `editor.<domain>` | editor:8080 | Static app |
| `content.<domain>` | content-api:4000 | CORS allows only `EDITOR_ORIGIN` |
| `delivery.<domain>` | delivery-api:4001 | Behind Cloudflare (cache rule, purge by tag) |
| `auth.<domain>` | keycloak:8080 | Set `KC_HOSTNAME=https://auth.<domain>` and `KC_PROXY_HEADERS=xforwarded`; never expose port 9000 |
| `pilot.<domain>` | sample-host:3000 | The pilot tenant's host app |

The worker needs no ingress. To drive it from a CronJob instead of polling, set
`WORKER_POLL_MS=0` and `POST /run` with `Authorization: Bearer $WORKER_RUN_SECRET`.

## Keycloak

- The image imports `infra/keycloak/realm/builder-realm.json` on first start. `${VAR:default}`
  placeholders in it come from the environment: `BUILDER_EDITOR_URL` sets the editor client's
  redirect URIs and web origins, and `BUILDER_SMTP_*` sets the realm's email server. Later
  starts keep the realm as edited in the admin console.
- The editor is a public client (`builder-editor`, authorization code with PKCE). An audience
  mapper adds `builder-content-api` to its access tokens, which the Content API requires.
- Self-registration with email verification is on. Accounts live in Keycloak; org membership
  and roles live in the builder database and are granted by invites.
- Keycloak keeps its data in its own Postgres database and user (`KC_DB_URL`).
