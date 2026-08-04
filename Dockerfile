# syntax=docker/dockerfile:1
# ShipTrack — multi-stage image: build workspace, run production deps + dist only.
# Serves BOTH the API (/api) and the built SPA (/) on :3000.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile

COPY . .

# Which port the browser should call the API on. Vite INLINES this at build time, so it cannot be
# changed by a runtime env var — it must be a build arg.
#
# Why it matters: frontend/src/lib/api.ts treats only ports 5173 and 3000 as "same origin as the
# backend"; served from any OTHER local port it emits an absolute http://localhost:<this>/api. So an
# image published on host port 3100 with the default 3000 makes the browser call the DEV backend on
# :3000, which fails CORS — and if CORS were widened it would silently read the DEV database instead
# of this container's. Set this to the HOST port the image is published on:
#     docker build --build-arg VITE_BACKEND_PORT=3100 -t shiptrack:demo ...
ARG VITE_BACKEND_PORT=3000
ENV VITE_BACKEND_PORT=$VITE_BACKEND_PORT

RUN pnpm --filter backend build \
 && pnpm --filter frontend build

# --- runtime: no source tree, no devDependencies ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
# Production dependency graph only (no vitest/ts-node/typescript).
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# TZ is LOAD-BEARING, not cosmetic: emails state HK wall-clock times and the edit form sends local
# wall-clock strings ("2026-03-02T18:00"); the backend interprets both in ITS OWN zone. A UTC
# container shifted every such value +8h on write (cut-offs read back as the small hours of the
# NEXT day). Override via compose only for a deployment that genuinely operates in another zone.
ENV NODE_ENV=production \
    STATIC_ROOT=/app/frontend/dist \
    PORT=3000 \
    TZ=Asia/Hong_Kong
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "backend/dist/main.js"]
