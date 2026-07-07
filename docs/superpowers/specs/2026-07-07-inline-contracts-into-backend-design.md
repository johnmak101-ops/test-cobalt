# Inline `@cobalt/contracts` into the backend (track repo)

- **Date:** 2026-07-07
- **Repo:** `cobalt_track_system` (customer-facing tracking app)
- **Status:** Design approved, pending spec review → implementation plan

---

## 🧒 一句話（ELI5）

把那份「資料庫藍圖」(`@cobalt/contracts`) 從獨立抽屜 (`packages/contracts`) **搬進 backend 自己的 `src/db/` 工具箱**，讓 track 變成一個自給自足、不再依賴獨立套件的專案。搬家時**原封不動保住藍圖的修改歷史（14 個 migration）**，這樣線上資料庫不會被當成全新的重建。獨立套件那個會一直長出重複 `drizzle-orm` 的坑（shadow-store）從此永久消失。之後交接時，再把它乾淨地重新抽成「queue + track 共用」的正式版。

---

## Context / current state

`@cobalt/contracts` is a pnpm **workspace package** at `packages/contracts`, consumed only by the backend:

| Fact | Value |
|---|---|
| Package name | `@cobalt/contracts` (`workspace:*`) |
| Public surface (`src/index.ts`) | `export * from './schema/index'` + `export * from './zod'` |
| Schema files | `src/schema/{tracking,queue,alerts,audit,evidence,enums,index}.ts` |
| Validators | `src/zod.ts` |
| Migrations | `drizzle/0000…0013` (14) + `drizzle/meta/_journal.json` + snapshots |
| Drizzle config | `drizzle.config.ts` (`schemaFilter: ['public','queue','evidence','tracking','audit','alerts']`) |
| Backend consumers | ~22 `backend/src/**` files + ~11 `backend/test/**` files, **all** the bare specifier `from '@cobalt/contracts'` (no subpaths) |
| Frontend consumers | **0** |
| Migrations run via | `docker-entrypoint.sh` → `pnpm --filter @cobalt/contracts exec drizzle-kit migrate` (`RUN_MIGRATIONS=1`) |
| Docker | `Dockerfile` builds contracts→dist FIRST, then backend/frontend consume it; `.dockerignore` guards the nested shadow-store |

**Pain being removed:** `packages/contracts` carries a nested `node_modules` + stray `pnpm-workspace.yaml`. A stray `pnpm install` inside it creates a **second `drizzle-orm` instance** → all query results come back `{}` and ~1000 phantom `tsc` errors. Collapsing the package boundary eliminates this failure mode entirely.

## Goal

Make the track backend **self-contained** (own its DB schema locally, like `cobalt-queue` does with `src/db/schema.ts`), delete the `packages/contracts` package, and preserve migration history and all behavior — with the backend fully building, testing, and running throughout.

## Non-goals (out of scope)

- **The cross-repo unified `@cobalt/contracts` (original Phase 2).** That is the "redo later" step — re-extract a shared package consumed by BOTH `cobalt-queue` and `cobalt-track` during handover. This spec only collapses the *track-local* package.
- Any schema change, migration, or data change. This is a pure code-move refactor; the DB is untouched.
- Any frontend change (frontend does not import contracts).

## Decision

**Option A — inline into the backend.** Chosen over:
- **Option B (only fix the shadow-store, keep the package):** smallest change but does not remove the package, which was the explicit ask.
- **Option C (delete now, wire back later):** leaves the backend non-building until the redo — unacceptable for a live system.

---

## Detailed design

### 1. File moves (verbatim; no regeneration)

| From | To |
|---|---|
| `packages/contracts/src/schema/*` | `backend/src/db/schema/*` |
| `packages/contracts/src/zod.ts` | `backend/src/db/zod.ts` |
| `packages/contracts/drizzle/` (all `.sql` + `meta/`) | `backend/drizzle/` |
| `packages/contracts/drizzle.config.ts` | `backend/drizzle.config.ts` (edited, see §4) |

### 2. Public surface (barrel)

Create `backend/src/db/contracts.ts` mirroring the old package root exactly:

```ts
export * from './schema';
export * from './zod';
```

This is the single import target that replaces `@cobalt/contracts`, preserving the identical public surface consumers already use (schema tables + zod validators from one module).

### 3. Import rewrite (~33 sites → relative paths)

Rewrite every `from '@cobalt/contracts'` to a **relative path** to `backend/src/db/contracts`.

**Why relative, not a path alias:** the backend builds with `nest build` (tsc) and runs `node dist/main.js`. There are **no tsconfig `paths` defined**, and `tsconfig-paths` is not registered at runtime (no `-r tsconfig-paths/register`). tsc does not rewrite aliases into output, so an alias would resolve in neither dev nor prod without new build/runtime tooling. Relative paths are bulletproof and match the repo's current no-alias style.

Relative depth by location:
- `backend/src/db/**` (e.g. `drizzle.provider.ts`, `seed.ts`, `repositories/*`, backfill/fix scripts) → `./contracts` or `../contracts`
- `backend/src/<feature>/**` (`reconcile`, `alerts`, `purchase-orders`, `presentation/adapters`) → `../db/contracts` (adjust depth)
- `backend/test/**` → `../src/db/contracts`

The exact per-file path is mechanical; the plan will enumerate all sites (grep is authoritative: `grep -rl "@cobalt/contracts" backend/{src,test}`).

### 4. `drizzle.config.ts` + backend scripts

`backend/drizzle.config.ts` (moved + edited):
```ts
schema: './src/db/schema/index.ts',   // was ./src/schema/index.ts
out: './drizzle',
schemaFilter: ['public','queue','evidence','tracking','audit','alerts'],  // PRESERVE — custom PG schemas are skipped without this
dbCredentials: { url: process.env.DATABASE_URL! },
```

Add to `backend/package.json` scripts (previously lived in the contracts package):
```
"db:generate": "drizzle-kit generate",
"db:migrate":  "drizzle-kit migrate",
"db:push":     "drizzle-kit push",
"db:studio":   "drizzle-kit studio"
```

### 5. `backend/package.json` deps

- **Remove:** `"@cobalt/contracts": "workspace:*"`.
- **Add** `zod` (dep — the moved `zod.ts` now lives in backend) and `drizzle-kit@^0.31.8` (devDep — for the moved `db:*` scripts).
- **Already present, no action:** `drizzle-orm@^0.45.1` (matches contracts exactly → no version skew; collapsing removes the double-instance risk) and `pg@^8.13.1`.

### 6. Workspace

- Root `pnpm-workspace.yaml`: drop `packages/*`, leaving `frontend`, `backend`.
- Root `package.json`: `db:generate` / `db:push` already delegate to `--filter backend` — now valid since backend owns those scripts.

### 7. Docker

- `docker-entrypoint.sh`: `pnpm --filter @cobalt/contracts exec drizzle-kit migrate` → `pnpm --filter backend exec drizzle-kit migrate`.
- `Dockerfile`: remove `COPY packages/contracts/package.json …` and the `pnpm --filter @cobalt/contracts build` step; ensure `backend/drizzle/` ships into the final stage (needed for `drizzle-kit migrate` at runtime).
- `.dockerignore`: remove the two `packages/contracts/*` lines.

### 8. Delete the package

Delete `packages/contracts/` entirely (including its shadow-store `node_modules`). Then `pnpm install` at root to relink and regenerate `pnpm-lock.yaml`.

### 9. "Redo later" marker

Add a short ADR (`docs/adr/…-inline-contracts.md`) or `TODO.md` note: track now owns its schema locally; the shared `@cobalt/contracts` (consumed by both queue + track) is deferred to handover and will be re-extracted fresh at that time.

---

## Verification plan (evidence required before "done")

1. `pnpm install` at root — clean, no `packages/contracts`, no nested shadow store.
2. `pnpm --filter backend build` → **0 errors** (also confirms the phantom double-drizzle `tsc` errors are gone).
3. `pnpm --filter backend test` → the full backend suite (~310 tests) green, including the `backend/test/*.int.spec.ts` files whose imports were rewritten.
4. `drizzle-kit migrate` against a **scratch** Postgres → applies **14 migrations, 0 pending**; `meta/_journal.json` intact (proves history preserved, no accidental from-scratch rebuild).
5. `node dist/main.js` (or `nest start`) boots + one authenticated API smoke probe returns real rows (not `{}`).
6. Optional: `docker build` + compose up with `RUN_MIGRATIONS=1` to confirm the entrypoint + image path.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Migration history corrupted → DB treated as new | Move `drizzle/` incl. `meta/_journal.json` **verbatim**; verify step 4 shows 0 pending |
| Import resolution breaks in prod | Use relative paths (no alias/runtime-register magic); verify via step 2/5 on built `dist` |
| Custom PG schemas skipped by drizzle-kit | Preserve `schemaFilter` in the moved config |
| Docker loses contracts build step but backend can't build / drizzle missing | Verify step 6; ensure `backend/drizzle/` copied into image |
| A consumer imported a contracts internal path | Confirmed: all 33 sites use the bare specifier only — single uniform target |

## Rollback

Pure code move on a clean `main` working tree; every change is git-tracked. `git revert`/branch-abandon restores the package. The live DB is never touched, so rollback is code-only.
