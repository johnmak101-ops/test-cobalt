# Cobalt ShipTrack

Shipment-tracking app for Cobalt Knitwear. An upstream AI agent reads logistics email and posts scored
decisions to this app, which turns them into a tracked **PO → Booking → Shipment** picture with alerts and
a human review queue.

This app is the **system of record + UI**. It does not parse email — the agent (**cobalt-queue**, a
separate service on its own VM) does, and posts to `POST /api/decisions` over HTTP. There is no shared
database between the two.

## Stack

- **Frontend**: React 19 + TypeScript + Vite + Zustand + TanStack Query + Tailwind
- **Backend**: NestJS 11 (Node) + TypeScript + Kysely (T-SQL query builder)
- **Database**: SQL Server (local `mssql-2022` container in dev/CI; Microsoft Fabric SQL in production)
- **Auth**: JWT in an httpOnly `session` cookie (Bearer accepted for service accounts)
- **Package manager**: pnpm (workspace)

The backend exposes a REST API under `/api` and, in a single-image deploy (`STATIC_ROOT` set), also serves
the built SPA from the same origin.

## Getting started (dev)

```bash
pnpm install                      # ONE clean workspace install at the repo root
```

Start SQL Server on `:1433`:

```bash
docker run -d --name mssql-2022 -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=YourStrong!Passw0rd' -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest
```

Then create the database, seed it, and run both halves:

```bash
cp backend/.env.example backend/.env   # then fill JWT_SECRET (>= 32 chars) — boot fails without it
pnpm --filter backend db:migrate       # creates the `cobalt` DB (if missing) + applies T-SQL migrations
pnpm --filter backend seed             # ports + alert rules + the 3 accounts (SEED_DEMO=1 adds demo data)
pnpm dev                               # frontend (:5173) + backend (:3000)
```

- Frontend: <http://localhost:5173> (Vite; proxies `/api` → backend)
- Backend API: <http://localhost:3000/api> · health: `/api/health`

**Seeded accounts** — the two human accounts are seeded with `mustReset`, so the first login forces a
password change:

| Account | Role | Password | Notes |
|---|---|---|---|
| `super@cobalt.hk` | SUPERADMIN | `SEED_INITIAL_PASSWORD` (dev default `cobalt-change-me`) | Must reset on first login |
| `admin@cobalt.hk` | ADMIN | same | Must reset on first login |
| `agent@cobalt.hk` | EDITOR | `TRACKING_AGENT_PASSWORD` (dev default `cobalt`) | cobalt-queue service account; no forced reset |

Backend config lives in `backend/.env` — see **[backend/.env.example](backend/.env.example)** for every
variable and its default. Only `JWT_SECRET` (≥ 32 chars) is required; boot fails without it.

## Docker (test deploy)

Full checklist: **[docs/ops/docker-deploy.md](docs/ops/docker-deploy.md)**.

```bash
docker compose up --build -d
# App:    http://localhost:3000  (API + SPA on one origin)
# Health: curl -sf http://127.0.0.1:3000/api/health
```

Compose starts **SQL Server + app** (migrate + seed on boot). Compose reads the **repo-root** `.env`
(see [.env.example](.env.example)), not `backend/.env`. The boot seed is prod-shape — users, ports and
alert rules only, `SEED_DEMO=0`, no demo emails. Pass `MESH_*` for the daily masters sync, and point
cobalt-queue's `TRACKING_API_BASE=http://host.docker.internal:3000/api` at this stack.

**DEMO gold (with queue rematch):** expect **5** shipment spines (Set1 sea, two Set5 air HAWBs,
Set6 sea + Set6 air). Packing-line ids (`31900…`) must not appear as incomplete shells.
See [docs/demo/DEMO-SCRIPT.md](docs/demo/DEMO-SCRIPT.md).

## Documentation

| You want | Read |
|---|---|
| The full docs index | [docs/README.md](docs/README.md) |
| **REST API reference** (every endpoint, auth, roles, errors) | [docs/reference/api.md](docs/reference/api.md) |
| The agent contract (`POST /api/decisions`) | [docs/reference/api.md](docs/reference/api.md#decisions--the-agent-write-path) |
| ERP export feed for Mesh + the PO chatbot | [docs/reference/erp-export-api.md](docs/reference/erp-export-api.md) |
| Alert thresholds and the live message text | [docs/reference/alert-rules-and-messages.md](docs/reference/alert-rules-and-messages.md) |
| Deploying with Docker | [docs/ops/docker-deploy.md](docs/ops/docker-deploy.md) |
| Working here as a coding agent | [AGENTS.md](AGENTS.md) |
| Open / deferred work | [TODO.md](TODO.md) |

## Project structure

```
.
├── frontend/                        # React SPA (Vite)
├── backend/                         # NestJS API (+ SPA when STATIC_ROOT is set)
│   ├── src/db/kysely-migrations/    # T-SQL migrations — the schema source of truth
│   └── .env.example                 # every backend env var
├── docs/
│   ├── reference/                   # API, ERP export, alert rules, PO style enrichment
│   ├── ops/                         # Docker deploy, booking-ingestion gap
│   ├── architecture/                # ADRs + the Fabric SQL migration diary
│   ├── demo/                        # customer DEMO walkthrough
│   └── prd/                         # product requirements
├── docker-compose.yml               # SQL Server + app image
└── package.json                     # pnpm workspace root
```

## Scripts

- `pnpm dev` — frontend + backend
- `pnpm build` — build both
- `pnpm lint` — ESLint (workspace, enforced in CI)
- `pnpm format` / `pnpm format:check` — Prettier (advisory; the repo isn't fully Prettier-formatted)
- `pnpm --filter backend run test` / `pnpm --filter frontend run test` — vitest
- `pnpm --filter backend db:migrate` — create the DB + apply migrations
- `pnpm --filter backend seed` — seed (`SEED_DEMO=1` for the demo dataset)
- `pnpm --filter backend db:codegen` — regenerate Kysely types from the live schema

Never run `pnpm -C <pkg> ...` — it nests divergent dependencies and breaks the backend typecheck.

## Tests & CI

Vitest, ~2,570 tests: **backend 1,440** (160 files) + **frontend 1,129** (68 files) as of 2026-08-05.
Backend integration specs need SQL Server on `localhost:1433`; `backend/test/setup-db.ts` creates and
migrates a `cobalt_test` database on first connect (override with `SQL_SERVER_TEST_URL`).

CI runs lint → backend typecheck → backend tests → frontend typecheck → frontend tests → build, on
`main` and every PR (`.github/workflows/ci.yml`, with an `mssql-2022` service container).
