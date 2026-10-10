#!/usr/bin/env bash
# Renders each Vault path secret/builder/<deployable> into .local/env/<deployable>.env
# for docker compose's env_file. This stands in for External Secrets Operator,
# which turns the same paths into Kubernetes Secrets in the cluster.
set -euo pipefail
cd "$(dirname "$0")/../.."

mkdir -p .local/env
chmod 700 .local
for name in content-api delivery-api worker sample-host keycloak; do
  docker compose exec -T -e VAULT_TOKEN=dev-root vault \
    vault kv get -format=json "secret/builder/$name" |
    node -e '
      let input = "";
      process.stdin.on("data", (chunk) => (input += chunk));
      process.stdin.on("end", () => {
        const data = JSON.parse(input).data.data;
        for (const [key, value] of Object.entries(data)) {
          if (String(value).includes("\x27")) throw new Error(`${key} contains a single quote`);
          // Single quotes: docker compose takes the value literally.
          console.log(`${key}=\x27${value}\x27`);
        }
      });
    ' >".local/env/$name.env"
  chmod 600 ".local/env/$name.env"
  echo "env: .local/env/$name.env"
done
