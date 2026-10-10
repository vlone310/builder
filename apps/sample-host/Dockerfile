# The sample tenant host: Next.js standalone server on :3000.
# Build from the repository root:
#   docker build -f apps/sample-host/Dockerfile -t builder-sample-host .
# Settings are read at runtime (see apps/sample-host/.env.example); none are needed to build.

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@builder/sample-host

FROM node:22-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# The ISR cache under .next is written at runtime, so the node user owns the app.
COPY --from=build --chown=node:node /repo/apps/sample-host/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/sample-host/.next/static ./apps/sample-host/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/sample-host/server.js"]
