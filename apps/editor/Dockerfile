# The editor: a static single-page app served by unprivileged nginx on :8080.
# Build from the repository root:
#   docker build -f apps/editor/Dockerfile -t builder-editor .
# Runtime settings come from the environment and land in /config.js at start:
#   CONTENT_API_URL   the Content API's public URL (required)

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@builder/editor

FROM nginxinc/nginx-unprivileged:1.30.5-alpine
COPY apps/editor/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/editor/docker/40-builder-config.sh /docker-entrypoint.d/40-builder-config.sh
# The start script rewrites config.js, so nginx's user owns the web root.
COPY --from=build --chown=101:101 /repo/apps/editor/dist /usr/share/nginx/html
EXPOSE 8080
