# syntax=docker/dockerfile:1
# ShipTrack — one image that serves BOTH the API (/api) and the built SPA (/) on :3000.
# The frontend's api.ts already targets '/api' when served on port 3000 (see lib/api.ts), and the
# backend serves the SPA via ServeStaticModule when STATIC_ROOT is set (see app.module.ts).
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# 1) manifests first — cached until a package.json / lockfile changes
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile

# 2) source + build (backend + frontend)
COPY . .
RUN pnpm --filter backend build \
 && pnpm --filter frontend build

# runtime env: backend serves the SPA from the built frontend, DB/PORT come from compose
ENV NODE_ENV=production \
    STATIC_ROOT=/app/frontend/dist \
    PORT=3000
EXPOSE 3000

# Liveness: the app answers GET /api/health once it's up. Uses node (no curl/wget in the slim image).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "backend/dist/main.js"]
