# Agent guide — Cobalt ShipTrack

Orientation for AI coding agents working in this repo.

> This replaces an earlier scaffold that described a **Cloudflare Workers / Hono / D1 (SQLite)** stack.
> None of that applies here — see the real stack below.

## Stack (the real one)

- **Monorepo**: pnpm workspace — `backend/` (NestJS 11, Node) + `frontend/` (React 19 + Vite).
- **Backend**: NestJS 11 on the standard **Node** runtime + **Kysely over SQL Server** (local
  `mssql-2022` container in dev/CI; **Microsoft Fabric SQL** is the deploy target). `fs`, `process.env`,
  native modules, and long-running work are all fine (this is not an edge/Workers runtime).
  Serves the REST API under `/api`, and the built SPA when `STATIC_ROOT` is set (single origin).
- **Frontend**: React 19 + TypeScript + Vite + Zustand + TanStack Query + Tailwind.
- **Auth**: JWT in an httpOnly `session` cookie; `Authorization: Bearer` for service/agent accounts.
  Global guards run in order `JwtAuthGuard → MustResetGuard → RolesGuard` (+ `PageAccessGuard`).
- **Upstream**: the AI agent (**cobalt-queue**, a separate service) posts scored decisions to
  `POST /api/decisions` over HTTP. This app is the system of record + UI; it does not parse email.

## Where things live

- Schema source of truth: the T-SQL migrations in `backend/src/db/kysely-migrations/*.ts` (applied by
  Kysely's Migrator; `pnpm --filter backend run db:migrate` also creates the DB if missing). Generated row
  types: `backend/src/db/kysely/db.generated.ts` (`pnpm --filter backend run db:codegen`), curated
  JSON/enum overrides in `backend/src/db/kysely/db.ts` (import `DB` from there, never from the generated file).
  Shared enum value arrays: `backend/src/db/enums.ts`.
- Runtime config/tunables: the `app_settings` table + the Settings UI (review policy, page access, …).
- Decisions ingest → commit: `backend/src/decisions/` + `backend/src/reconcile/committer.service.ts`.
  Optional advisory `criticReview` on `POST /api/decisions` lands in `shipments.critic_review`
  (migration `0012`); shapes in `backend/src/decisions/critic-review.types.ts`. Does **not** change
  routing — gate `autoApply` / `disposition` still own provisional vs confirmed.
- Review Queue UI: Active / Rejected / Approved tabs; band badge + conflict-only card
  (`frontend/src/components/review/`, `frontend/src/lib/critic-review.ts`). Agent golden fixture:
  cobalt-queue `test/fixtures/critic-review.sample.json` (`conflicts[]` for contested fields).
- Presentation/adapters (flat UI shapes): `backend/src/presentation/`.
- Frontend API client: `frontend/src/lib/api.ts` (relative `/api`, same-origin).

## Master data

- `customers` / `vendors` / `forwarders` are a **read-only mirror** of the Cobalt Mesh ERP, upserted by code
  and **never deleted**. Config: `MESH_*` in `.env` (see `.env.example`; secret is confidential).
  - **Nest (preferred):** `MastersSyncSchedulerService` — default every 24h (`MESH_SYNC_INTERVAL_MS`, `0` = off);
    boot pulls only if last success is older than ~23h (`mesh_sync_last_ok_at` in app_settings); `MESH_SYNC_ON_BOOT=0|1` overrides.
    Manual: `POST /api/masters/sync` (ADMIN). Fail soft — API stays up if Mesh errors.
  - **CLI still valid:** `node dist/db/sync-masters.js` (dev: `npx tsx src/db/sync-masters.ts`) under host cron if desired.
  - Mesh→local: `customers`→customers, `factories`+`gmtsuppliers`→vendors (factory wins on code clash), `forwarders`→forwarders.
- **`ports`** have **no ERP/Mesh home**. Offline seed keeps ~40 curated rows for empty DB / demo.
  Full master: free **UN/LOCODE** (sea function `1` + air `4`) + **OurAirports** IATA cross-check,
  upsert-never-delete via `PortsSyncService` (shiptrack#159). Nest schedule monthly
  (`PORTS_SYNC_INTERVAL_MS`, default ~30d; `0` = off). Manual: `pnpm --filter backend ports:sync` or
  `POST /api/masters/ports/sync` (ADMIN). Last success: `app_settings.ports_sync_last_ok_at`.
- **consignees / brands / carriers are NOT Mesh-synced** — no local master
  (brand/SCAC are free-text) or no Mesh endpoint (consignees); left for later (a `carriers` master could
  later back the free-text SCAC).
- The seed is `ports + admin config` by default; `SEED_DEMO=1 pnpm --filter backend seed` adds the demo dataset.
- **Planned next:** an LLM name→master matcher (retrieve-then-match: `pg_trgm`/embeddings candidates → LLM pick
  + confidence → review), replacing the code-bound name tables + `vendor_alias`/`forwarder_ref`/`customer_canonical`
  facts. Lives cobalt-queue-side; the daily sync is its fresh candidate set.

## Build / test / lint

- Install: `pnpm install --frozen-lockfile` — ONE workspace install at the repo root. Never
  `pnpm -C <pkg> ...` (it nests divergent deps and breaks the backend typecheck).
- Typecheck: `pnpm --filter backend exec tsc --noEmit -p tsconfig.json` (and the frontend equivalent).
- Test: `pnpm --filter backend run test` / `pnpm --filter frontend run test` (vitest). Backend
  integration specs need **SQL Server** on `localhost:1433` (the `mssql-2022` container, sa /
  `YourStrong!Passw0rd`); `backend/test/setup-db.ts` creates + migrates a `cobalt_test` database on
  first connect (override with `SQL_SERVER_TEST_URL`). SQL Server gotchas (TOP-not-LIMIT, OUTPUT,
  check-then-insert upserts, JSON nvarchar, uppercase GUIDs, single-NULL uniques) are catalogued in
  `TODO.md` under "Fabric SQL migration".
- Lint: `pnpm lint` (ESLint flat config, `eslint.config.mjs`) — enforced in CI, keep it at 0 errors.
  `pnpm format` (Prettier) is advisory (the repo isn't fully Prettier-formatted).
- CI (`.github/workflows/ci.yml`) runs all of the above on push to `main` and every PR.

## Conventions

- Match the surrounding style (no semicolons, single quotes, 2-space indent). ESLint must pass.
- Masters (customers/vendors/ports) are ERP-owned and **read-only** in-app; resolution facts are managed
  at runtime (Settings → Resolution Rules). Don't hard-code business facts — extend the data model.
- Keep the app ↔ agent contract stable: `POST /api/decisions` (+ optional `criticReview`) +
  `GET /api/masters/resolution`.
- In plans/task breakdowns, list phases and items — no time estimates (e.g. no "Week 1-2").
