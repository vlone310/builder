#!/usr/bin/env bash
# Stops the local environment. --volumes also deletes the Postgres data.
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose --profile app down "$@"
