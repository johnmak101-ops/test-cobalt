# Agent guide — Cobalt ShipTrack

Docs hub: `docs/README.md`.

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
  Global guards run in order `ThrottlerGuard → JwtAuthGuard → MustResetGuard → RolesGuard → PageAccessGuard`.
  `@Roles(...)` is a MINIMUM role, not an exact match. Full reference: `docs/reference/api.md`.
- **Upstream**: the AI agent (**cobalt-queue**, a separate service) posts scored decisions to
  `POST /api/decisions` over HTTP. This app is the system of record + UI; it does not parse email.

## Where things live

- Schema source of truth: the T-SQL migrations in `backend/src/db/kysely-migrations/*.ts` (applied by
  Kysely's Migrator; `pnpm --filter backend run db:migrate` also creates the DB if missing). Generated row
  types: `backend/src/db/kysely/db.generated.ts` (`pnpm --filter backend run db:codegen`), curated
  JSON/enum overrides in `backend/src/db/kysely/db.ts` (import `DB` from there, never from the generated file).
  Shared enum value arrays: `backend/src/db/enums.ts`.
- Runtime config/tunables: the `app_settings` table + the Settings UI. Its tabs today are **Alert Rules**
  (page-access gated), **Lifecycle**, **Users**, **Access Control**, **Mesh Misses** (the last four
  SUPERADMIN). `/settings` alone has no content — it redirects to the first tab the user can open, and
  the retired `/settings/resolution`, `/settings/review-policy`, `/settings/vendors` routes redirect too.
- Decisions ingest → commit: `backend/src/decisions/` + `backend/src/reconcile/committer.service.ts`.
  Optional advisory `criticReview` on `POST /api/decisions` lands in `shipments.critic_review`
  (migration `0012`); shapes in `backend/src/decisions/critic-review.types.ts`. Does **not** change
  routing — gate `autoApply` / `disposition` still own provisional vs confirmed. Reference:
  `docs/reference/critic-review.md`.
- Review Queue UI: Active / Waiting / Rejected / Approved views (`active|waiting|rejected|approved`
  in the UI → `pending|waiting|dismissed|approved` on the API); band badge + conflict-only card
  (`frontend/src/components/review/`, `frontend/src/lib/critic-review.ts`). Agent golden fixture:
  cobalt-queue `test/fixtures/critic-review.sample.json` (`conflicts[]` for contested fields).
- Human review corrections are pushed back to the queue's learning feed (the Iterator's TRAIN signal)
  by `backend/src/review/queue-learning.client.ts` + `prior-correction.service.ts` — best effort,
  `QUEUE_API_BASE` / `QUEUE_API_PASSWORD`. Unset = the TRAIN signal is off (logged loudly, once).
- Reconcile/rebuild replays the decision log (migration `0032`) — there is no second brain to drift.
  Never run it against the demo database.
- ERP export (PO-grained read-only feed for Mesh + the "where is PO X?" chatbot):
  `backend/src/erp-export/`, `field-catalog.ts` is the single source of truth for exportable fields.
- Presentation/adapters (flat UI shapes): `backend/src/presentation/`.
- Frontend API client: `frontend/src/lib/api.ts` (relative `/api`, same-origin).
- **Full endpoint reference: `docs/reference/api.md`.** Backend env: `backend/.env.example`.

## Master data

- `customers` / `vendors` / `forwarders` are a **read-only mirror** of the Cobalt Mesh ERP, upserted by code
  and **never deleted**. Config: `MESH_*` (see `backend/.env.example`; the secret is confidential).
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
- **consignees and carriers are NOT Mesh-synced** — no Mesh endpoint (consignees) / no ERP home
  (carriers, keyed by SCAC). Both are now **ops-maintained local masters** with ADMIN CRUD
  (`POST`/`PATCH /api/masters/consignees|carriers`); the carriers master is the SCAC data home.
  Brand stays free text.
- The seed is `ports + admin config` by default; `SEED_DEMO=1 pnpm --filter backend seed` adds the demo dataset.
- **LLM name→master matcher — SHIPPED** (2026-07-10). Retrieve-then-match: this app serves the
  deterministic, recall-oriented candidate set (`POST /api/masters/candidates`, `CandidatesService` +
  `trigram.ts` + `cjk-fold.ts`; types `customer|vendor|forwarder|consignee|port`, optional
  co-occurrence `context` that boosts and never filters), and the queue's LLM picks + scores. The
  committer's own linkers are shadow-metered fallbacks. The daily Mesh sync is the fresh candidate set.
- **`PartyRelinkService`** runs after each successful Mesh sync: a leg whose raw party name now has an
  exact master gets its null FK filled (audited `sourceType='system'`). This is a lookup with one
  answer, not a correction — no value is rewritten, only a null FK moves.

## Build / test / lint

- Install: `pnpm install --frozen-lockfile` — ONE workspace install at the repo root. Never
  `pnpm -C <pkg> ...` (it nests divergent deps and breaks the backend typecheck).
- Typecheck: `pnpm --filter backend exec tsc --noEmit -p tsconfig.json` (and the frontend equivalent).
- Test: `pnpm --filter backend run test` / `pnpm --filter frontend run test` (vitest). Backend
  integration specs need **SQL Server** on `localhost:1433` (the `mssql-2022` container, sa /
  `YourStrong!Passw0rd`); `backend/test/setup-db.ts` creates + migrates a `cobalt_test` database on
  first connect (override with `SQL_SERVER_TEST_URL`). SQL Server gotchas (TOP-not-LIMIT, OUTPUT,
  check-then-insert upserts, JSON nvarchar, uppercase GUIDs, single-NULL uniques, type precedence)
  are catalogued in `docs/reference/sql-server-gotchas.md`.
- Lint: `pnpm lint` (ESLint flat config, `eslint.config.mjs`) — enforced in CI, keep it at 0 errors.
  `pnpm format` (Prettier) is advisory (the repo isn't fully Prettier-formatted).
- CI (`.github/workflows/ci.yml`) runs all of the above on push to `main` and every PR.
- Docker smoke: `docker compose up --build` → `GET /api/health` → SPA login. Checklist:
  `docs/ops/docker-deploy.md`. Demo walkthrough: `docs/demo/DEMO-SCRIPT.md` (gold = **5** spines).

## Invariants (do not break)

1. **Decision ingest is the only write path from the agent.** No shared DB with cobalt-queue.
2. **Packing-line POs are noise.** `backend/src/reconcile/non-customer-po.ts` demotes `ASNE*`,
   `DF*`, and pure **9+ digit** tokens — keep in lockstep with queue `non-customer-po.ts`.
3. **Incomplete shells** (no strong key ∧ no master) are filterable in the UI; do not hide them silently.
4. **Sibling HAWB PO exclusivity** — same PO on two air HAWBs links to one leg only (Set6 air).
5. **De-correction: a fix is a freeze.** This app must not silently correct the LLM/matcher — quietly
   patching a reading judgement breaks the agent's soul/Iterator loop, because the wrong parse never
   surfaces as a correction to learn from. Surface it as a review flag instead: *surface, do not
   decide*. Grep `de-correction` before adding **any** value-correcting code in the ingest/committer
   path — the rule and its exceptions are annotated at the call sites (`reconcile/committer.service.ts`,
   `presentation/po-shared-legs.ts`, `masters/party-relink.service.ts`, `db/enums.ts` shadow rows).
   Filling a **null FK** from an exact master match is not a correction (no value is rewritten).
6. **Field locks are contested-wins, not human-wins.** A newer email that disagrees with a locked leg
   field is APPLIED and the field flagged CONTESTED (column ≠ lockedValue), surfaced on the detail page
   with Keep/Restore (`POST /api/shipments/:id/locks/:field/keep-new|restore`). Don't reintroduce a
   hard human-wins block.

## Conventions

- Match the surrounding style (no semicolons, single quotes, 2-space indent). ESLint must pass.
- **Master ownership is per-master, not a blanket rule:**
  - `customers` / `vendors` — Mesh-owned mirror, **read-only** in-app (no write DTOs exist).
  - `ports` / `forwarders` / `consignees` / `carriers` — ops-maintained here, ADMIN CRUD.
  - Party **raw twins** (`customerRaw` / `vendorRaw`) are editable stand-ins on a leg, because the Mesh
    mirror lags ~2 months. Every human raw write must re-resolve-or-unlink the master FK — the display
    class prefers the FK over the raw value, so a stale FK silently shows the old name.
  - `master_resolution` facts are backend/API/seed-managed. **The Settings → Resolution Rules page was
    removed** (2026-07-19) and `resolution_rules` is retired from the page-access matrix; the endpoints
    remain (`/api/masters/resolution*`, SUPERADMIN or the `@AgentPageRead` EDITOR+ carve-out).
  - Don't hard-code business facts — extend the data model.
- Keep the app ↔ agent contract stable: `POST /api/decisions` (+ optional `criticReview`) +
  `GET /api/masters/resolution` + `POST /api/masters/candidates`. Contract changes are cross-repo.
- Anything not declared on a DTO is **stripped** by the global whitelist `ValidationPipe` — a new agent
  field that "silently vanishes" is missing from `CreateDecisionDto`.
- Naive Hong Kong wall-clock date strings everywhere; the backend's `TZ` (pinned `Asia/Hong_Kong`)
  mints the instant.
- In plans/task breakdowns, list phases and items — no time estimates (e.g. no "Week 1-2").
