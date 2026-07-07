# Inline `@cobalt/contracts` into the backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the `packages/contracts` workspace package into the backend so `cobalt_track_system` owns its DB schema locally, deleting the package and its drizzle shadow-store trap, with migration history and all behavior preserved.

**Architecture:** This is a **pure code-move refactor** — no schema, migration, or data change. The safety net is the existing backend test suite plus the compiler: every task ends **green** (`build` + `test`), so a broken import or type is caught immediately. Work proceeds copy-then-swap so the backend never has a broken commit: add local copies first, repoint imports, move migrations, then delete the now-unused package last.

**Tech Stack:** pnpm workspaces, NestJS (`nest build` → `node dist/main.js`), Drizzle ORM `^0.45.1` + drizzle-kit, Postgres, Vitest.

## Global Constraints

- **No DB touch.** The live/shared Postgres is never modified by this work. Verification uses a scratch DB only.
- **Migration history is sacred.** Move `drizzle/` (incl. `meta/_journal.json` + snapshots) **verbatim** — never regenerate. `drizzle-kit generate` must report **no schema changes** after the move.
- **Relative imports only** — no tsconfig path alias (backend runs compiled `dist` with no runtime alias resolver; an alias breaks prod). New import target is the barrel `backend/src/db/contracts`.
- **Preserve the public surface exactly.** The barrel re-exports `./schema` + `./zod`, identical to the old `packages/contracts/src/index.ts`, so consumers (incl. `drizzle.provider.ts`) behave unchanged.
- **Preserve `schemaFilter`:** `['public','queue','evidence','tracking','audit','alerts']` in the drizzle config (custom PG schemas are silently skipped without it).
- **drizzle-orm stays `^0.45.1`** (backend already has it — matches contracts, so no version skew; collapsing removes the double-instance risk).
- **Branch:** all work on `refactor/inline-contracts-into-backend` (already created; spec committed at `5fe4d0c`). Frequent commits, one per task.

---

## File Structure

**New (backend owns the schema):**
- `backend/src/db/schema/` — the drizzle schema (copied from contracts): `tracking.ts`, `queue.ts`, `alerts.ts`, `audit.ts`, `evidence.ts`, `enums.ts`, `index.ts`
- `backend/src/db/zod.ts` — runtime zod contracts (copied)
- `backend/src/db/contracts.ts` — barrel: `export * from './schema'; export * from './zod'` (the single import target replacing `@cobalt/contracts`)
- `backend/drizzle/` — the 14 migrations + `meta/` (moved via `git mv`)
- `backend/drizzle.config.ts` — moved + edited (schema path, `out`, `schemaFilter`)

**Modified:**
- `backend/package.json` — add `zod` + `drizzle-kit` deps, add `db:*` scripts, remove `@cobalt/contracts` dep
- 33 import sites (see Task 3) — `@cobalt/contracts` → relative barrel path
- `pnpm-workspace.yaml` — drop `packages/*`
- `docker-entrypoint.sh`, `Dockerfile`, `.dockerignore` — drop contracts references
- `TODO.md` (or new ADR) — "redo later" marker

**Deleted:**
- `packages/contracts/` (entire package, incl. shadow-store `node_modules`)

---

### Task 1: Prep — clean shadow-store, add deps, prove green baseline

**Files:**
- Modify: `backend/package.json` (dependencies + devDependencies)
- Local-only: remove `packages/contracts/node_modules` (gitignored — ensures single drizzle-orm for trustworthy intermediate test runs)

**Interfaces:**
- Produces: `zod@^3.24.1` and `drizzle-kit@^0.31.8` available to the backend workspace.

- [ ] **Step 1: Clean the shadow-store and establish a single-instance install**

```bash
cd /d/cobalt_track_system
rm -rf packages/contracts/node_modules
pnpm install
```

- [ ] **Step 2: Record the green baseline (this is the bar every later task must clear)**

```bash
pnpm --filter backend build      # Expected: exit 0, no tsc errors
pnpm --filter backend test       # Expected: all suites pass (~310 tests)
```
If either is NOT already green, STOP — the baseline is broken and must be understood before refactoring.

- [ ] **Step 3: Add `zod` + `drizzle-kit` to the backend**

In `backend/package.json`, add to `dependencies`:
```json
"zod": "^3.24.1",
```
and to `devDependencies`:
```json
"drizzle-kit": "^0.31.8",
```

- [ ] **Step 4: Install and re-verify build**

```bash
pnpm install
pnpm --filter backend build      # Expected: exit 0
```

- [ ] **Step 5: Commit**

```bash
git add backend/package.json pnpm-lock.yaml
git commit -m "chore(backend): add zod + drizzle-kit deps (prep for inlining contracts)"
```

---

### Task 2: Add local copies of schema + zod + the barrel

**Files:**
- Create: `backend/src/db/schema/*` (copied), `backend/src/db/zod.ts` (copied), `backend/src/db/contracts.ts` (new barrel)

**Interfaces:**
- Produces: module `backend/src/db/contracts` re-exporting all drizzle tables/enums (`./schema`) and zod contracts (`./zod`) — the drop-in replacement for `@cobalt/contracts`. `zod.ts` imports only `zod` (confirmed); schema files import only `drizzle-orm` + each other relatively, so relocation is safe.

- [ ] **Step 1: Copy schema dir and zod file into the backend**

```bash
cd /d/cobalt_track_system
cp -r packages/contracts/src/schema backend/src/db/schema
cp packages/contracts/src/zod.ts backend/src/db/zod.ts
```

- [ ] **Step 2: Create the barrel `backend/src/db/contracts.ts`**

```ts
// Local DB contracts — schema tables/enums + runtime zod validators.
// Mirrors the former @cobalt/contracts package root exactly.
export * from './schema';
export * from './zod';
```

- [ ] **Step 3: Build — new files must compile (nothing imports them yet)**

```bash
pnpm --filter backend build      # Expected: exit 0
```
Expected: PASS. `zod` now resolves (Task 1); `./schema` resolves to `schema/index.ts`. If a schema file fails to compile, compare its `tsconfig` assumptions against `backend/tsconfig.json` and fix imports before proceeding.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema backend/src/db/zod.ts backend/src/db/contracts.ts
git commit -m "feat(db): add local schema + zod + contracts barrel (copy of @cobalt/contracts)"
```

---

### Task 3: Repoint all 33 imports to the local barrel

**Files (modify — all currently `from '@cobalt/contracts'`):**
- `backend/src/db/`: `seed.ts`, `seed-entity-facts.ts`, `fix-po-total-broadcast.ts`, `fill-s2600240871a-cargo.ts`, `drizzle.provider.ts`, `backfill-po-enrichment.ts` → `./contracts`
- `backend/src/db/repositories/`: `users`, `shipment`, `settings`, `review-email`, `masters`, `field-lock`, `evidence`, `email`, `booking`, `audit`, `alert` (`.repository.ts`, 11 files) → `../contracts`
- `backend/src/reconcile/`: `committer.service.ts` (2 refs), `po-enrichment.ts`; `backend/src/purchase-orders/purchase-orders.service.ts`; `backend/src/alerts/alert-evaluator.service.ts` → `../db/contracts`
- `backend/src/presentation/adapters/enums.ts` → `../../db/contracts`
- `backend/test/`: `setup-db.ts`, `committer`, `decisions`, `review`, `reconcile`, `port-resolver`, `matcher-reads`, `auth.service`, `alert-evaluator` (`.int.spec.ts`), `shipment-edit.int.spec.ts`, `shipment-create.int.spec.ts` (11 files) → `../src/db/contracts`

**Interfaces:**
- Consumes: `backend/src/db/contracts` (Task 2). The `@cobalt/contracts` literal appears only in import specifiers, so a substring replace is safe.

- [ ] **Step 1: Rewrite imports, grouped by relative depth**

```bash
cd /d/cobalt_track_system/backend

# src/db/*  ->  ./contracts
for f in src/db/seed.ts src/db/seed-entity-facts.ts src/db/fix-po-total-broadcast.ts \
         src/db/fill-s2600240871a-cargo.ts src/db/drizzle.provider.ts src/db/backfill-po-enrichment.ts; do
  sed -i "s#@cobalt/contracts#./contracts#g" "$f"; done

# src/db/repositories/*  ->  ../contracts
sed -i "s#@cobalt/contracts#../contracts#g" src/db/repositories/*.repository.ts

# src/<feature>/*  ->  ../db/contracts
for f in src/reconcile/committer.service.ts src/reconcile/po-enrichment.ts \
         src/purchase-orders/purchase-orders.service.ts src/alerts/alert-evaluator.service.ts; do
  sed -i "s#@cobalt/contracts#../db/contracts#g" "$f"; done

# src/presentation/adapters/enums.ts  ->  ../../db/contracts
sed -i "s#@cobalt/contracts#../../db/contracts#g" src/presentation/adapters/enums.ts

# test/*  ->  ../src/db/contracts
sed -i "s#@cobalt/contracts#../src/db/contracts#g" test/*.int.spec.ts test/setup-db.ts
```

- [ ] **Step 2: Verify no stale references remain**

```bash
cd /d/cobalt_track_system
grep -rn "@cobalt/contracts" backend/src backend/test
```
Expected: **no output** (zero matches).

- [ ] **Step 3: Build + full test suite (this is the real test cycle for the move)**

```bash
pnpm --filter backend build      # Expected: exit 0
pnpm --filter backend test       # Expected: all ~310 pass, same as the Task 1 baseline
```
Expected: PASS. A resolution or type error here means a relative path is wrong for that file's depth — fix the specific import and re-run.

- [ ] **Step 4: Commit**

```bash
git add backend/src backend/test
git commit -m "refactor(backend): import schema/zod from local ./db/contracts, not @cobalt/contracts"
```

---

### Task 4: Move migrations + drizzle config into the backend

**Files:**
- Move: `packages/contracts/drizzle/` → `backend/drizzle/` (via `git mv`)
- Create: `backend/drizzle.config.ts`
- Modify: `backend/package.json` (scripts), `docker-entrypoint.sh`, `backend/test/setup-db.ts` (hardcoded migration path)

**Interfaces:**
- Produces: `backend` owns `db:generate` / `db:migrate` / `db:push` / `db:studio`; the migrate entrypoint targets `--filter backend`.

- [ ] **Step 1: Move the migration folder verbatim + repoint its filesystem consumer**

```bash
cd /d/cobalt_track_system
git mv packages/contracts/drizzle backend/drizzle
```

Then fix the ONE hardcoded migration path in `backend/test/setup-db.ts` (a filesystem path the test-DB bootstrap reads — **not** an import, so Task 3's rewrite does not touch it). Change:
```ts
const dir = join(process.cwd(), '..', 'packages', 'contracts', 'drizzle')
```
to:
```ts
const dir = join(process.cwd(), 'drizzle')   // vitest cwd = backend; migrations now live in backend/drizzle
```

- [ ] **Step 2: Create `backend/drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  // Custom Postgres schemas are EXCLUDED by drizzle-kit unless listed here.
  schemaFilter: ['public', 'queue', 'evidence', 'tracking', 'audit', 'alerts'],
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: true,
  strict: true,
})
```

- [ ] **Step 3: Add `db:*` scripts to `backend/package.json`**

In the `scripts` block:
```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:push": "drizzle-kit push",
"db:studio": "drizzle-kit studio",
```

- [ ] **Step 4: Point the Docker migrate step at the backend**

In `docker-entrypoint.sh`, change the migrate line:
```sh
  pnpm --filter backend exec drizzle-kit migrate || echo "[entrypoint] WARN: migrate failed"
```
(was `--filter @cobalt/contracts`). Also update the nearby comment `applies packages/contracts/drizzle/*.sql` → `applies backend/drizzle/*.sql`.

- [ ] **Step 5: Integrity check — moved schema must equal the migration history (no scratch DB needed)**

```bash
cd /d/cobalt_track_system
pnpm --filter backend exec drizzle-kit generate
```
Expected: **"No schema changes, nothing to migrate"** (proves `backend/src/db/schema` is byte-equivalent in meaning to the moved migrations). If it emits a new migration file, the schema copy diverged — delete the generated file, diff the schema against the original, fix, and re-run.

- [ ] **Step 6 (if a scratch Postgres is available): full migrate check**

```bash
DATABASE_URL=postgres://…/scratch_empty pnpm --filter backend exec drizzle-kit migrate
# Expected: 14 migrations applied, 0 pending
DATABASE_URL=postgres://…/scratch_empty pnpm --filter backend exec drizzle-kit migrate
# Expected: nothing to apply (idempotent)
```

- [ ] **Step 7: Build still green, then commit**

```bash
pnpm --filter backend build      # Expected: exit 0
git add backend/drizzle backend/drizzle.config.ts backend/package.json docker-entrypoint.sh
git commit -m "refactor(db): move drizzle migrations + config into backend"
```

---

### Task 5: Remove the package — workspace, deps, Docker, delete `packages/contracts`

**Files:**
- Modify: `backend/package.json` (remove dep), `pnpm-workspace.yaml`, `Dockerfile`, `.dockerignore`
- Delete: `packages/contracts/`

**Interfaces:**
- Consumes: nothing further imports `@cobalt/contracts` (Task 3 verified). Produces: a two-package workspace (`frontend`, `backend`) with no shadow-store.

- [ ] **Step 1: Remove the workspace dependency**

In `backend/package.json` `dependencies`, delete the line:
```json
"@cobalt/contracts": "workspace:*",
```

- [ ] **Step 2: Drop `packages/*` from the workspace**

`pnpm-workspace.yaml` becomes:
```yaml
packages:
  - 'frontend'
  - 'backend'
```

- [ ] **Step 3: Remove contracts from the Dockerfile**

Delete line 13 (`COPY packages/contracts/package.json packages/contracts/`) and the `pnpm --filter @cobalt/contracts build \` line, so the build step reads:
```dockerfile
# 2) source + build (backend + frontend)
COPY . .
RUN pnpm --filter backend build \
 && pnpm --filter frontend build
```
(`backend/drizzle/` ships via `COPY . .` and `drizzle-kit` is installed by `pnpm install --frozen-lockfile` — the runtime migrate step keeps working.)

- [ ] **Step 4: Remove the contracts lines from `.dockerignore`**

Delete lines 7–10 (the shadow-store comment + `packages/contracts/pnpm-lock.yaml` + `packages/contracts/pnpm-workspace.yaml`).

- [ ] **Step 5: Delete the package and reinstall**

```bash
cd /d/cobalt_track_system
rm -rf packages/contracts
pnpm install
```

- [ ] **Step 6: Verify — repo-wide clean, build, tests, boot**

```bash
grep -rn "@cobalt/contracts" backend frontend Dockerfile docker-entrypoint.sh pnpm-workspace.yaml
#   Expected: no output
pnpm --filter backend build      # Expected: exit 0
pnpm --filter backend test       # Expected: all ~310 pass
pnpm --filter backend start:prod &   # boot smoke: node dist/main.js
sleep 6 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health   # Expected: 200
kill %1
```

- [ ] **Step 7: Commit**

```bash
git add backend/package.json pnpm-workspace.yaml Dockerfile .dockerignore pnpm-lock.yaml
git commit -m "refactor: drop @cobalt/contracts package; backend is now self-contained"
```

---

### Task 6: Leave the "redo later" marker

**Files:**
- Modify: `TODO.md` (append)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Append a note to `TODO.md`**

```markdown
## Deferred: shared @cobalt/contracts (handover)

`@cobalt/contracts` was inlined into `backend/src/db` on 2026-07-07 (branch
refactor/inline-contracts-into-backend) to make track self-contained and kill
the drizzle shadow-store trap. The original Phase 2 — one versioned schema
package consumed by BOTH cobalt-queue and cobalt-track — is deferred to
handover and will be re-extracted fresh (cobalt org, git-tagged) at that time.
See docs/superpowers/specs/2026-07-07-inline-contracts-into-backend-design.md.
```

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "docs: note deferred shared-contracts re-extraction (handover)"
```

---

## Self-Review

**Spec coverage:** ✅ file moves (T2/T4), barrel/public surface (T2), 33 imports→relative (T3), migration history preserved (T4 §5–6), drizzle.config + scripts (T4), deps zod/drizzle-kit (T1), workspace + Dockerfile + entrypoint + .dockerignore (T4/T5), delete package (T5), redo-later marker (T6), verification: install/build/test/migrate/boot (T1/T3/T4/T5). All spec sections map to a task.

**Placeholder scan:** No TBD/TODO-as-work, no "add error handling", no "similar to Task N" — every edit shows exact content/commands. Scratch-DB URL in T4 §6 is an environment value, not a placeholder (the primary integrity check, T4 §5, needs no DB).

**Type/name consistency:** Single import target `backend/src/db/contracts` throughout; barrel matches old `index.ts` (`export * from './schema'; './zod'`); `schemaFilter` value identical in spec and T4; `drizzle-orm ^0.45.1` / `drizzle-kit ^0.31.8` / `zod ^3.24.1` consistent across T1 and config.
