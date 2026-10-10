#!/usr/bin/env bash
# Creates (or finds) a verified user in the local builder realm and prints its id.
#   scripts/local/keycloak-user.sh <email> <password> [first name] [last name]
set -euo pipefail
cd "$(dirname "$0")/../.."

email="$1"
password="$2"
first="${3:-Local}"
last="${4:-Admin}"

kcadm() { docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@"; }
kcadm config credentials --server http://localhost:8080 --realm master \
  --user admin --password admin >/dev/null

id=$(kcadm get users -r builder -q "email=$email" -q exact=true --fields id --format csv --noquotes)
if [[ -z "$id" ]]; then
  id=$(kcadm create users -r builder -i \
    -s "username=$email" -s "email=$email" -s emailVerified=true -s enabled=true \
    -s "firstName=$first" -s "lastName=$last")
  kcadm set-password -r builder --userid "$id" --new-password "$password" >/dev/null
  echo "keycloak: created $email" >&2
else
  echo "keycloak: $email exists" >&2
fi
echo "$id"
