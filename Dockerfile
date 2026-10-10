# Platform services: content-api, delivery-api, worker. One image per service:
#   docker build --build-arg SERVICE=content-api -t builder-content-api .
# Migrations (run before deploying a new version):
#   docker build --target migrate -t builder-migrate . && docker run -e DATABASE_URL=... builder-migrate

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG SERVICE
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@builder/${SERVICE}
RUN pnpm --filter @builder/${SERVICE} deploy --legacy --prod /out

FROM base AS migrate
COPY . .
RUN pnpm install --frozen-lockfile --filter @builder/db...
CMD ["pnpm", "--filter", "@builder/db", "migrate"]

FROM node:22-slim AS service
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
USER node
CMD ["node", "dist/server.js"]
