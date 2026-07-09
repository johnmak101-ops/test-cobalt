# Cobalt ShipTrack

Shipment-tracking app for Cobalt Knitwear. An upstream AI agent reads logistics email and posts scored
decisions to this app, which turns them into a tracked **PO → Booking → Shipment** picture with alerts and
a human review queue.

## Stack

- **Frontend**: React 19 + TypeScript + Vite + Zustand + TanStack Query + Tailwind
- **Backend**: NestJS 11 (Node) + TypeScript + Kysely (T-SQL query builder)
- **Database**: SQL Server (local `mssql-2022` container in dev/CI; Microsoft Fabric SQL in production)
- **Auth**: JWT in an httpOnly cookie (Bearer accepted for service accounts)
- **Package manager**: pnpm (workspace)

The backend exposes a REST API under `/api` and, in a single-image deploy (`STATIC_ROOT` set), also serves
the built SPA from the same origin. The upstream AI agent (**cobalt-queue**, a separate service) posts to
`POST /api/decisions` over HTTP — this app is the system of record + UI and does **not** parse email itself.

## Getting started

```bash
pnpm install                      # one clean workspace install
# start SQL Server on :1433, e.g.:
#   docker run -d --name mssql-2022 -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=YourStrong!Passw0rd' -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest
pnpm --filter backend db:migrate  # create the `cobalt` DB (if missing) + apply the T-SQL schema
pnpm dev                          # frontend (:5173) + backend (:3000)
```

- Frontend: <http://localhost:5173> (Vite dev server; proxies `/api` → backend)
- Backend API: <http://localhost:3000/api>

Backend env (`backend/.env`): `SQL_SERVER_URL`, `JWT_SECRET` (≥ 32 chars), plus optional `CORS_ORIGINS`,
`SESSION_TTL_HOURS`, `STATIC_ROOT` (prod SPA serving), and `GRAPH_*` (Microsoft Graph email ingestion).

## Project structure

```
.
├── frontend/            # React SPA (Vite)
│   └── src/
├── backend/             # NestJS API (serves /api; serves the SPA in prod)
│   └── src/
│       └── db/kysely-migrations/   # T-SQL migrations (Kysely Migrator modules)
├── .github/workflows/   # CI: lint + typecheck + tests + build
└── package.json         # pnpm workspace root
```

## Scripts

- `pnpm dev` — frontend + backend
- `pnpm build` — build both
- `pnpm lint` — ESLint (workspace, enforced in CI)
- `pnpm format` / `pnpm format:check` — Prettier
- `pnpm --filter backend run test` / `pnpm --filter frontend run test` — vitest
- `pnpm --filter backend db:migrate` — create DB (if missing) + apply the T-SQL migrations
- `pnpm --filter backend db:codegen` — regenerate Kysely row types from the live schema

## Tests & CI

Vitest. The backend integration specs (`backend/test/*.int.spec.ts`) need SQL Server on `localhost:1433` —
they create and migrate a `cobalt_test` database on first connect (`backend/test/setup-db.ts`). CI runs
lint + both typechecks + both suites + both builds on push to `main` and every PR
(`.github/workflows/ci.yml`, with an `mssql-2022` service container).
