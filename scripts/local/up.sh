#!/usr/bin/env bash
# Starts the local environment.
#   scripts/local/up.sh          infra in docker; run the apps with `pnpm dev`
#   scripts/local/up.sh --app    infra and every app in docker, built from their Dockerfiles
# Needs Docker, Node 22 and `pnpm install` (for migrations, the seed and key generation).
set -euo pipefail
cd "$(dirname "$0")/../.."

app=0
[[ "${1:-}" == "--app" ]] && app=1
pg_port="${BUILDER_PG_PORT:-5432}"
db_url="postgres://builder:builder@localhost:$pg_port/builder"
admin_email="admin@builder.local"
admin_password="builder"

echo "==> Infra: Postgres, Keycloak, Vault, Mailpit"
docker compose up -d --build --wait postgres keycloak vault mailpit

echo "==> Vault: seed secrets, render .local/env"
scripts/local/vault-seed.sh
scripts/local/vault-env.sh

echo "==> Keycloak: local admin user"
admin_id=$(scripts/local/keycloak-user.sh "$admin_email" "$admin_password")

echo "==> Database: migrate and seed the demo org"
DATABASE_URL="$db_url" pnpm -s db:migrate
webhook="http://localhost:3000/api/builder/revalidate"
[[ $app == 1 ]] && webhook="http://sample-host:3000/api/builder/revalidate"
DATABASE_URL="$db_url" BUILDER_DEMO_WEBHOOK_URL="$webhook" \
  BUILDER_DEMO_ADMINS="$admin_id:$admin_email" pnpm -s db:seed

if [[ $app == 1 ]]; then
  echo "==> Apps: build and start"
  docker compose --profile app up -d --build --wait
fi

cat <<SUMMARY

Local environment is up.
  Editor         http://localhost:5173   sign in as $admin_email / $admin_password
  Sample host    http://localhost:3000
  Content API    http://localhost:4000
  Delivery API   http://localhost:4001
  Keycloak       http://localhost:8080   admin console: admin / admin
  Vault          http://localhost:8200   token: dev-root
  Mailpit        http://localhost:8025   every email Keycloak and the API send
  Postgres       localhost:$pg_port       builder / builder
SUMMARY
[[ $app == 1 ]] || echo "Apps are not running: start them with \`pnpm dev\` (see docs/local-environment.md)."
