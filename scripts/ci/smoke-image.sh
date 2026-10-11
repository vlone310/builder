#!/bin/sh
# Starts a freshly built image inside the job's Docker daemon and checks it answers.
# Service images migrate a fresh database first. Used by the `images` job in .gitlab-ci.yml.
#
# Env: IMAGE_REF (image to test), SERVICE (set for content-api, delivery-api, worker),
#      APP_PORT and CHECK (skip the start when APP_PORT is empty), NAME.
set -eu

DB_URL=postgres://builder:builder@localhost:5432/builder_images
# Containers share the Docker daemon's network; the job reaches them through it.
DAEMON_HOST=${DAEMON_HOST:-docker}

if [ -n "${SERVICE:-}" ]; then
  docker run -d --name pg --network host \
    -e POSTGRES_USER=builder -e POSTGRES_PASSWORD=builder -e POSTGRES_DB=builder_images \
    "${POSTGRES_IMAGE:-postgres:16.15}"
  for _ in $(seq 1 30); do
    docker exec pg pg_isready -U builder -d builder_images >/dev/null 2>&1 && break
    sleep 1
  done
  echo "Migrating from the image"
  docker run --rm --network host -e DATABASE_URL="$DB_URL" "$IMAGE_REF" node dist/migrate.js
fi

if [ -z "${APP_PORT:-}" ]; then
  echo "No port to check for $NAME"
  exit 0
fi

docker run -d --name app --network host -e DATABASE_URL="$DB_URL" -e PORT="$APP_PORT" \
  -e CONTENT_API_JWT_SECRET=ci-secret-that-is-at-least-32-characters-long \
  -e CONTENT_API_URL=https://content.example.test \
  -e BUILDER_DELIVERY_KEY=bk_dlv_ci -e BUILDER_WEBHOOK_SECRET=whsec_ci "$IMAGE_REF"

url="http://$DAEMON_HOST:$APP_PORT$CHECK"
for _ in $(seq 1 30); do
  # Any answer below 500 means the server is up and routing.
  status=$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)
  if [ "$status" != "000" ] && [ "$status" -lt 500 ]; then
    echo "$CHECK → $status"
    if [ "$NAME" = "editor" ]; then
      curl -fsS "http://$DAEMON_HOST:$APP_PORT/config.js" | grep -F 'https://content.example.test'
    fi
    exit 0
  fi
  sleep 1
done
docker logs app
exit 1
