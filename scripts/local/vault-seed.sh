#!/usr/bin/env bash
# Writes the local secrets into Vault (KV v2 at secret/builder/<deployable>), the
# same layout the Kubernetes ExternalSecrets read (docs/kubernetes.md). Paths that
# already exist are left alone; pass --force to regenerate them all.
set -euo pipefail
cd "$(dirname "$0")/../.."

force=0
[[ "${1:-}" == "--force" ]] && force=1

vault() { docker compose exec -T -e VAULT_TOKEN=dev-root vault vault "$@"; }
random() { node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"; }

# Values that point at other containers use compose service names.
DATABASE_URL="postgres://builder:builder@postgres:5432/builder"

put() {
  local path="$1"
  shift
  if [[ $force == 0 ]] && vault kv get "secret/builder/$path" >/dev/null 2>&1; then
    echo "vault: secret/builder/$path exists, kept"
    return
  fi
  vault kv put "secret/builder/$path" "$@" >/dev/null
  echo "vault: secret/builder/$path written"
}

put content-api \
  DATABASE_URL="$DATABASE_URL" \
  CONTENT_API_JWT_SECRET="$(random)" \
  EDIT_TOKEN_PRIVATE_JWK="$(pnpm -s --filter @builder/content-api keys:generate)" \
  SMTP_URL="smtp://mailpit:1025"

put delivery-api \
  DATABASE_URL="$DATABASE_URL"

put worker \
  DATABASE_URL="$DATABASE_URL" \
  WORKER_RUN_SECRET="$(random)" \
  CLOUDFLARE_ZONE_ID="" \
  CLOUDFLARE_API_TOKEN=""

# The demo org's delivery key and webhook secret (packages/db/src/seed.ts).
put sample-host \
  BUILDER_DELIVERY_KEY="bk_dlv_local_dev_only_000000000000" \
  BUILDER_WEBHOOK_SECRET="whsec_local_dev_only_00000000000000"

# Keycloak's own secrets. Locally docker-compose.yml sets them inline because
# Keycloak starts before Vault is seeded; in Kubernetes they come from here.
put keycloak \
  KC_DB_PASSWORD="keycloak" \
  KC_BOOTSTRAP_ADMIN_PASSWORD="admin"
