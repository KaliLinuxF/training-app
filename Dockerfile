# syntax=docker/dockerfile:1
#
# «Легко» — one image serving the API and the built PWA on :3000.
#   build:   pnpm workspace → apps/web/dist (static) + apps/server/dist (bundled, no node_modules)
#   runtime: plain node:24-alpine running as the unprivileged `node` user (uid 1000)
#
#   docker build --build-arg APP_VERSION="$(git rev-parse --short HEAD)" -t training-app:latest .

############################
# Build stage
############################
FROM node:24-alpine AS build

ARG PNPM_VERSION=9.15.9
ENV CI=true

# pnpm straight from npm, so the build does not depend on corepack being bundled with Node.
RUN npm install --global --no-fund --no-audit --no-update-notifier "pnpm@${PNPM_VERSION}"

WORKDIR /repo

# Manifests first: the dependency layer is reused until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN --mount=type=cache,id=legko-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# Only what the builds need, so edits to docs/e2e/deploy do not invalidate the build layers.
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/

# The server bundles are ESM, like apps/server itself ("type": "module"); the generated
# dist/package.json keeps them ESM once copied out of the workspace.
RUN pnpm --filter @legko/web build \
 && pnpm --filter @legko/server build \
 && test -f apps/web/dist/index.html \
 && test -f apps/server/dist/index.js \
 && test -f apps/server/dist/cli.js \
 && { test -f apps/server/dist/package.json || printf '{ "type": "module" }\n' > apps/server/dist/package.json; }

############################
# Runtime stage
############################
FROM node:24-alpine AS runtime

# Source maps ship next to the bundles, so production stack traces point at the TypeScript sources.
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    STATIC_DIR=/app/public \
    TRUST_PROXY=1 \
    NODE_OPTIONS=--enable-source-maps

WORKDIR /app

# Code stays root-owned (read-only for the app); only /data is writable by `node`.
COPY --from=build /repo/apps/server/dist /app/server
COPY --from=build /repo/apps/web/dist /app/public
RUN mkdir -p /data && chown node:node /data

# Declared last so a new version only changes metadata, not the cached layers above.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="legko" \
      org.opencontainers.image.description="«Легко» — personal weight-loss tracker PWA (API + static web app)" \
      org.opencontainers.image.url="https://fit.triple-a.dev" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${APP_VERSION}" \
      org.opencontainers.image.base.name="docker.io/library/node:24-alpine"

USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD wget -q -T 4 -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "/app/server/index.js"]
