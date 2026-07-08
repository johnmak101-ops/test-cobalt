# Agent guide — Cobalt ShipTrack

Orientation for AI coding agents working in this repo.

> This replaces an earlier scaffold that described a **Cloudflare Workers / Hono / D1 (SQLite)** stack.
> None of that applies here — see the real stack below.

## Stack (the real one)

- **Monorepo**: pnpm workspace — `backend/` (NestJS 11, Node) + `frontend/` (React 19 + Vite).
- **Backend**: NestJS 11 on the standard **Node** runtime + Drizzle ORM over **PostgreSQL**. `fs`,
  `process.env`, native modules, and long-running work are all fine (this is not an edge/Workers runtime).
  Serves the REST API under `/api`, and the built SPA when `STATIC_ROOT` is set (single origin).
- **Frontend**: React 19 + TypeScript + Vite + Zustand + TanStack Query + Tailwind.
- **Auth**: JWT in an httpOnly `session` cookie; `Authorization: Bearer` for service/agent accounts.
  Global guards run in order `JwtAuthGuard → MustResetGuard → RolesGuard` (+ `PageAccessGuard`).
- **Upstream**: the AI agent (**cobalt-queue**, a separate service) posts scored decisions to
  `POST /api/decisions` over HTTP. This app is the system of record + UI; it does not parse email.

## Where things live

- Drizzle schema (source of truth): `backend/src/db/schema/*.ts`; migrations: `backend/drizzle/*.sql`.
- Runtime config/tunables: the `app_settings` table + the Settings UI (review policy, page access, …).
- Decisions ingest → commit: `backend/src/decisions/` + `backend/src/reconcile/committer.service.ts`.
- Presentation/adapters (flat UI shapes): `backend/src/presentation/`.
- Frontend API client: `frontend/src/lib/api.ts` (relative `/api`, same-origin).

## Build / test / lint

- Install: `pnpm install --frozen-lockfile` — ONE workspace install at the repo root. Never
  `pnpm -C <pkg> ...` (it nests a divergent `drizzle-orm` and breaks the backend typecheck).
- Typecheck: `pnpm --filter backend exec tsc --noEmit -p tsconfig.json` (and the frontend equivalent).
- Test: `pnpm --filter backend run test` / `pnpm --filter frontend run test` (vitest). Backend
  integration specs need **Postgres** on `localhost:5432`; `backend/test/setup-db.ts` creates + migrates
  a `cobalt_test` database on first connect.
- Lint: `pnpm lint` (ESLint flat config, `eslint.config.mjs`) — enforced in CI, keep it at 0 errors.
  `pnpm format` (Prettier) is advisory (the repo isn't fully Prettier-formatted).
- CI (`.github/workflows/ci.yml`) runs all of the above on push to `main` and every PR.

## Conventions

- Match the surrounding style (no semicolons, single quotes, 2-space indent). ESLint must pass.
- Masters (customers/vendors/ports) are ERP-owned and **read-only** in-app; resolution facts are managed
  at runtime (Settings → Resolution Rules). Don't hard-code business facts — extend the data model.
- Keep the app ↔ agent contract stable: `POST /api/decisions` + `GET /api/masters/resolution`.
- In plans/task breakdowns, list phases and items — no time estimates (e.g. no "Week 1-2").
