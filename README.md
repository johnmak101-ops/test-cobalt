# Cobalt ShipTrack

Shipment-tracking app for Cobalt Knitwear. An upstream AI agent reads logistics email and posts scored
decisions to this app, which turns them into a tracked **PO → Booking → Shipment** picture with alerts and
a human review queue.

## Critic Review (Phase 1-UI, advisory)

Optional agent payload on decisions; **does not change** confirmed/provisional routing (`autoApply` / gate disposition).

| Piece | Where |
|-------|--------|
| Column | `shipments.critic_review` nvarchar(max) NULL — migration `0012_shipment_critic_review` (register in `migrate-cli.ts`) |
| Ingest | `POST /api/decisions` optional `criticReview?: object` (`CreateDecisionDto`) → persisted on the leg |
| Queue UI | Review Queue tabs **Active** / **Rejected** / **Approved**; **Band** badge (Low/Medium); expandable **conflict-only** card (Existing / Proposed / Recommended / Resolution); no **Why review?** column |
| Fixture (agent) | cobalt-queue `test/fixtures/critic-review.sample.json` (`CRITIC_REVIEW=deterministic\|openpave`); includes `conflicts[]` for contested fields |

Legacy decisions without `criticReview` render as before (no band, no conflict expand). Design: `docs/superpowers/specs/2026-07-14-critic-review-ui-design.md`.

## Stack

- **Frontend**: React 19 + TypeScript + Vite + Zustand + TanStack Query + Tailwind
- **Backend**: NestJS 11 (Node) + TypeScript + Kysely (T-SQL query builder)
- **Database**: SQL Server (local `mssql-2022` container in dev/CI; Microsoft Fabric SQL in production)
- **Auth**: JWT in an httpOnly cookie (Bearer accepted for service accounts)
- **Package manager**: pnpm (workspace)

The backend exposes a REST API under `/api` and, in a single-image deploy (`STATIC_ROOT` set), also serves
the built SPA from the same origin. The upstream AI agent (**cobalt-queue**, a separate service) posts to
`POST /api/decisions` over HTTP — this app is the system of record + UI and does **not** parse email itself.

## Getting started (dev)

```bash
pnpm install                      # one clean workspace install at repo root
# SQL Server on :1433, e.g.:
#   docker run -d --name mssql-2022 -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=YourStrong!Passw0rd' -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest
pnpm --filter backend db:migrate  # create the `cobalt` DB (if missing) + apply T-SQL migrations
pnpm dev                          # frontend (:5173) + backend (:3000)
```

- Frontend: <http://localhost:5173> (Vite; proxies `/api` → backend)
- Backend API: <http://localhost:3000/api>
- Default login (seed): `admin@cobalt.hk` / `cobalt` (or agent service account used by cobalt-queue)

Backend env (`backend/.env`): `SQL_SERVER_URL`, `JWT_SECRET` (≥ 32 chars), optional `CORS_ORIGINS`,
`SESSION_TTL_HOURS`, `STATIC_ROOT`, `MESH_*`, `GRAPH_*` (optional mailbox helpers).

## Docker (test deploy)

Full checklist: **[docs/ops is gitignored for client materials — use `backend/docs/docker-deploy.md`](backend/docs/docker-deploy.md)**.

```bash
docker compose up --build -d
# App: http://localhost:3000  (API + SPA)
# Health: curl -sf http://127.0.0.1:3000/api/health
# Login: admin@cobalt.hk / cobalt  (SEED_ON_START=1 on first volume)
```

Compose starts **SQL Server + app** (migrate + optional seed on boot). Point cobalt-queue
`TRACKING_API_BASE=http://host.docker.internal:3000/api` at this stack.

**DEMO gold (with queue rematch):** expect **5** shipment spines (Set1 sea, two Set5 air HAWBs,
Set6 sea + Set6 air). Packing-line ids (`31900…`) must not appear as incomplete shells.
See [DEMO-SCRIPT.md](DEMO-SCRIPT.md).

## Project structure

```
.
├── frontend/            # React SPA (Vite)
├── backend/             # NestJS API (+ SPA when STATIC_ROOT set)
│   ├── src/db/kysely-migrations/
│   └── docs/            # ops notes (Fabric SQL, booking gap, docker)
├── DEMO-SCRIPT.md       # customer walkthrough
├── docker-compose.yml   # SQL + app image
└── package.json         # pnpm workspace root
```

## Scripts

- `pnpm dev` — frontend + backend
- `pnpm build` — build both
- `pnpm lint` — ESLint (workspace, enforced in CI)
- `pnpm format` / `pnpm format:check` — Prettier
- `pnpm --filter backend run test` / `pnpm --filter frontend run test` — vitest
- `pnpm --filter backend db:migrate` — create DB + apply migrations
- `pnpm --filter backend db:codegen` — regenerate Kysely types from live schema

## Tests & CI

Vitest. Backend integration specs need SQL Server on `localhost:1433` (`cobalt_test` via
`backend/test/setup-db.ts`). CI: lint + typecheck + tests + build on `main` and every PR
(`.github/workflows/ci.yml`, `mssql-2022` service).
