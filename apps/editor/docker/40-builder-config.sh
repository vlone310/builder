#!/bin/sh
# Writes the editor's runtime settings from the container environment. Runs from
# nginx's /docker-entrypoint.d before the server starts.
set -eu

if [ -z "${CONTENT_API_URL:-}" ]; then
  echo "40-builder-config: CONTENT_API_URL must be set" >&2
  exit 1
fi

# JSON-escape backslashes and quotes.
escaped=$(printf '%s' "$CONTENT_API_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf 'window.__BUILDER_CONFIG__ = { "contentApiUrl": "%s" };\n' "$escaped" \
  > /usr/share/nginx/html/config.js
echo "40-builder-config: contentApiUrl=$CONTENT_API_URL"
