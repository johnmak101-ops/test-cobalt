# Master-Resolution Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tracking.master_resolution` curated facts (aliases/groups/canonical/roles incl. SEH) runtime-manageable by ADMIN through a Settings tab, and stop `seed.ts` from wiping them.

**Architecture:** Additive `active` flag on the existing table + soft-deactivate; new ADMIN-gated CRUD endpoints on the existing `masters` module; a non-destructive seed; a new React "Resolution Rules" Settings tab mirroring the `UsersSettings` + `use-users` + `api` patterns. The consumer contract `GET /api/masters/resolution` is preserved (shape unchanged; filter tightens to `active=true`), so cobalt-queue needs no change.

**Tech Stack:** NestJS 11 + Drizzle (Postgres) backend; React 19 + @tanstack/react-query + Vite + Tailwind frontend; vitest both sides; drizzle-kit migrations.

**Spec:** `docs/superpowers/specs/2026-07-08-master-resolution-management-design.md`

## Global Constraints

- **Build/test via per-package binaries**, never `pnpm -C <pkg>` (divergent drizzle-orm → type errors). Backend: `cd backend && node_modules/.bin/{vitest,drizzle-kit,tsc}`. Frontend: `cd frontend && node_modules/.bin/{vitest,tsc}`.
- **Green baseline to protect:** 328 backend + 62 frontend tests pass; `tsc --noEmit` + builds clean, both sides.
- **Additive only** — no table renames, no column drops. `active` defaults `true` (backfills existing rows).
- **Auth:** `RolesGuard` is rank-based; `@Roles('ADMIN')` admits ADMIN **and** SUPERADMIN. Writes are ADMIN+.
- **Invariant:** at most one `active=true` fact per `(kind, lhs)`.
- **Governance:** do NOT add write paths for ERP-owned masters (customers/vendors/forwarders/ports/consignees). This feature touches `master_resolution` only.
- **Consumer contract:** `GET /api/masters/resolution` keeps returning `[{ kind, lhs, rhs, status, source, ... }]`; only the WHERE tightens. Do not change its response shape.

---

### Task 1: Schema + migration — `active` column + SEH cleanup

**Files:**
- Modify: `backend/src/db/schema/tracking.ts:84-98` (masterResolution table)
- Create: `backend/drizzle/0018_*.sql` (+ snapshot) via drizzle-kit
- Reference: `backend/drizzle.config.ts`

**Interfaces:**
- Produces: `schema.masterResolution.active` (boolean column) consumed by Tasks 2-3.

- [ ] **Step 1: Add the column to the schema.** In `tracking.ts`, inside the `masterResolution` table object (after the `updatedAt` line, before the closing `}, (t) => [...]`):

```ts
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** false = deactivated: kept for audit but no longer served to consumers (status stays 'approved'). */
  active: boolean('active').notNull().default(true),
}, (t) => [unique('master_resolution_uq').on(t.kind, t.lhs, t.rhs)])
```

`boolean` is already imported in this file (used by `users.active`). No other edit.

- [ ] **Step 2: Generate the migration.**

Run: `cd backend && node_modules/.bin/drizzle-kit generate`
Expected: prints a new migration `0018_*.sql` under `backend/drizzle/` containing `ALTER TABLE "tracking"."master_resolution" ADD COLUMN "active" boolean DEFAULT true NOT NULL;` and updates `backend/drizzle/meta/`.

- [ ] **Step 3: Append the one-time SEH cleanup** to the generated `0018_*.sql` (new statement after a `--> statement-breakpoint` line):

```sql
--> statement-breakpoint
-- one-time: drop the stale seed-sourced canonical SEH fold so the new customer_group bootstrap (seed.ts) is authoritative
DELETE FROM "tracking"."master_resolution" WHERE "kind" = 'customer_canonical' AND "lhs" = 'SEH' AND "source" = 'seed';
```

- [ ] **Step 4: Typecheck.**

Run: `cd backend && node_modules/.bin/tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 5: Apply against the dev DB and verify the column exists.**

Run: `cd backend && node_modules/.bin/drizzle-kit migrate`
Then verify: `docker exec -i <pg> psql -U postgres -d cobalt -c "\d tracking.master_resolution"` shows `active | boolean | not null | true`. (Dev PG is the local `cobalt` DB per `run-the-full-system`.)
Expected: migration applies clean; column present.

- [ ] **Step 6: Commit.**

```bash
git add backend/src/db/schema/tracking.ts backend/drizzle/
git commit -m "feat(db): master_resolution.active flag + SEH canonical cleanup (mig 0018)"
```

---

### Task 2: Backend repository — thin methods + consumer `active` filter

**Files:**
- Modify: `backend/src/db/repositories/masters.repository.ts` (add methods; filter existing reads)

**Interfaces:**
- Consumes: `schema.masterResolution.active` (Task 1).
- Produces (used by Task 3 service):
  - `deactivateActiveFor(kind: ResolutionKind, lhs: string): Promise<void>`
  - `insertOpsFact(v: { kind: ResolutionKind; lhs: string; rhs: string | null; reason: string | null; createdBy: string | null }): Promise<Row>`
  - `getFact(id: string): Promise<Row | null>`
  - `setActive(id: string, active: boolean): Promise<Row | null>`
  - `patchReason(id: string, reason: string | null): Promise<Row | null>`
  - `listResolutionManage(): Promise<Row[]>`
  where `Row = typeof schema.masterResolution.$inferSelect`.

- [ ] **Step 1: Add the `active = true` filter to the three consumer reads.** In `masters.repository.ts`:
  - `canonicalCode` (currently `and(eq(kind,'customer_canonical'), eq(lhs,c), eq(status,'approved'))`): add `eq(schema.masterResolution.active, true)`.
  - `customerGroupOf` (currently `and(eq(kind,'customer_group'), eq(lhs,...), eq(status,'approved'))`): add `eq(schema.masterResolution.active, true)`.
  - `listResolution(status)` (the consumer/`/resolution` + `/proposals` list): add `eq(schema.masterResolution.active, true)` to its `.where(...)` (wrap in `and(eq(status,...), eq(active,true))`).

Note: `/proposals` lists `status='proposed'` which are always `active=true` by default, so the filter is harmless there and keeps one code path.

- [ ] **Step 2: Add the new methods** (after `approvedKeys()` / near the other resolution methods):

```ts
  listResolutionManage() {
    return this.db
      .select()
      .from(schema.masterResolution)
      .where(eq(schema.masterResolution.status, 'approved'))
      .orderBy(schema.masterResolution.kind, schema.masterResolution.lhs)
  }

  async getFact(id: string) {
    const [r] = await this.db.select().from(schema.masterResolution).where(eq(schema.masterResolution.id, id))
    return r ?? null
  }

  /** Enforce the single-active invariant: turn off any live fact for this (kind,lhs) before a new one lands. */
  async deactivateActiveFor(kind: ResolutionKind, lhs: string) {
    await this.db
      .update(schema.masterResolution)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(schema.masterResolution.kind, kind), eq(schema.masterResolution.lhs, lhs), eq(schema.masterResolution.active, true)))
  }

  async insertOpsFact(v: { kind: ResolutionKind; lhs: string; rhs: string | null; reason: string | null; createdBy: string | null }) {
    const [r] = await this.db
      .insert(schema.masterResolution)
      .values({ kind: v.kind, lhs: v.lhs, rhs: v.rhs, reason: v.reason, createdBy: v.createdBy, status: 'approved', source: 'ops', active: true })
      .onConflictDoUpdate({
        target: [schema.masterResolution.kind, schema.masterResolution.lhs, schema.masterResolution.rhs],
        set: { active: true, status: 'approved', reason: v.reason, source: 'ops', updatedAt: new Date() },
      })
      .returning()
    return r ?? null
  }

  async setActive(id: string, active: boolean) {
    const [r] = await this.db
      .update(schema.masterResolution)
      .set({ active, updatedAt: new Date() })
      .where(eq(schema.masterResolution.id, id))
      .returning()
    return r ?? null
  }

  async patchReason(id: string, reason: string | null) {
    const [r] = await this.db
      .update(schema.masterResolution)
      .set({ reason, updatedAt: new Date() })
      .where(eq(schema.masterResolution.id, id))
      .returning()
    return r ?? null
  }
```

- [ ] **Step 3: Typecheck + existing tests stay green.**

Run: `cd backend && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run src/masters`
Expected: PASS (existing masters tests unaffected — the repo isn't unit-tested; logic lands in Task 3).

- [ ] **Step 4: Commit.**

```bash
git add backend/src/db/repositories/masters.repository.ts
git commit -m "feat(masters): resolution-fact repo methods + active-filter on consumer reads"
```

---

### Task 3: Backend service + DTO + controller — the ADMIN CRUD API (TDD)

**Files:**
- Modify: `backend/src/masters/masters.service.ts` (add methods)
- Modify: `backend/src/masters/masters.spec.ts` (add tests)
- Modify: `backend/src/masters/dto.ts` (add DTOs)
- Modify: `backend/src/masters/masters.controller.ts` (add routes)

**Interfaces:**
- Consumes: Task 2 repo methods.
- Produces (service): `createFact(dto, userId)`, `patchReason(id, reason)`, `deactivate(id)`, `reactivate(id)`, `resolutionManage()`.
- Produces (HTTP): `POST /masters/resolution`, `PATCH /masters/resolution/:id`, `POST /masters/resolution/:id/deactivate`, `POST /masters/resolution/:id/reactivate`, `GET /masters/resolution/manage` — all `@Roles('ADMIN')`.

- [ ] **Step 1: Write failing service tests.** Append to `masters.spec.ts` a new block. Extend the `fakeRepo()` helper (top of file) to also record the new calls, or add a dedicated fake here:

```ts
function resolutionRepo() {
  const calls: any[] = []
  const repo = {
    deactivateActiveFor: (kind: string, lhs: string) => { calls.push({ fn: 'deactivateActiveFor', kind, lhs }); return Promise.resolve() },
    insertOpsFact: (v: unknown) => { calls.push({ fn: 'insertOpsFact', v }); return Promise.resolve({ id: 'r1', ...(v as object) }) },
    getFact: (id: string) => { calls.push({ fn: 'getFact', id }); return Promise.resolve({ id, kind: 'customer_group', lhs: 'SEH' }) },
    setActive: (id: string, active: boolean) => { calls.push({ fn: 'setActive', id, active }); return Promise.resolve({ id, active }) },
    patchReason: (id: string, reason: string | null) => { calls.push({ fn: 'patchReason', id, reason }); return Promise.resolve({ id, reason }) },
    listResolutionManage: () => { calls.push({ fn: 'listResolutionManage' }); return Promise.resolve([{ id: 'r1' }]) },
  }
  return { svc: new MastersService(repo as unknown as MastersRepository), calls }
}

describe('MastersService — resolution CRUD', () => {
  it('createFact trims, defaults ops/approved, supersedes the old (kind,lhs) BEFORE inserting', async () => {
    const { svc, calls } = resolutionRepo()
    await svc.createFact({ kind: 'customer_group', lhs: '  seh ', rhs: ' PRIMARK ', reason: '  x  ' }, 'user-1')
    expect(calls.map((c) => c.fn)).toEqual(['deactivateActiveFor', 'insertOpsFact'])
    expect(calls[0]).toEqual({ fn: 'deactivateActiveFor', kind: 'customer_group', lhs: 'SEH' })
    expect(calls[1].v).toEqual({ kind: 'customer_group', lhs: 'SEH', rhs: 'PRIMARK', reason: 'x', createdBy: 'user-1' })
  })
  it('deactivate flips active=false', async () => {
    const { svc, calls } = resolutionRepo()
    await svc.deactivate('r1')
    expect(calls).toEqual([{ fn: 'setActive', id: 'r1', active: false }])
  })
  it('reactivate supersedes same (kind,lhs) then re-enables', async () => {
    const { svc, calls } = resolutionRepo()
    await svc.reactivate('r1')
    expect(calls.map((c) => c.fn)).toEqual(['getFact', 'deactivateActiveFor', 'setActive'])
    expect(calls[2]).toEqual({ fn: 'setActive', id: 'r1', active: true })
  })
  it('patchReason trims empty → null', async () => {
    const { svc, calls } = resolutionRepo()
    await svc.patchReason('r1', '   ')
    expect(calls).toEqual([{ fn: 'patchReason', id: 'r1', reason: null }])
  })
})
```

Note: `lhs`/`rhs` uppercase in `createFact` — codes are canonical uppercase (matches `canonicalCode`/`customerGroupOf` which `.toUpperCase()` the lookup). `reason` trims to text-or-null.

- [ ] **Step 2: Run — verify it fails.**

Run: `cd backend && node_modules/.bin/vitest run src/masters/masters.spec.ts`
Expected: FAIL — `svc.createFact is not a function`.

- [ ] **Step 3: Implement the service methods.** In `masters.service.ts`, add a helper + methods (place near `resolution()`):

```ts
  private static up(s: string): string { return s.trim().toUpperCase() }
  private static nn(s?: string | null): string | null { const t = s?.trim(); return t ? t : null }

  resolutionManage() {
    return this.repo.listResolutionManage()
  }
  async createFact(dto: { kind: string; lhs: string; rhs?: string | null; reason?: string | null }, userId: string) {
    const kind = dto.kind as (typeof import('../db/schema/enums').MASTER_RESOLUTION_KIND)[number]
    const lhs = MastersService.up(dto.lhs)
    const rhs = dto.rhs != null && dto.rhs.trim() ? MastersService.up(dto.rhs) : null
    await this.repo.deactivateActiveFor(kind, lhs)
    return this.repo.insertOpsFact({ kind, lhs, rhs, reason: MastersService.nn(dto.reason), createdBy: userId })
  }
  patchReason(id: string, reason?: string | null) {
    return this.repo.patchReason(id, MastersService.nn(reason))
  }
  deactivate(id: string) {
    return this.repo.setActive(id, false)
  }
  async reactivate(id: string) {
    const f = await this.repo.getFact(id)
    if (!f) return null
    await this.repo.deactivateActiveFor(f.kind, f.lhs)
    return this.repo.setActive(id, true)
  }
```

(The `import('...').MASTER_RESOLUTION_KIND` inline type keeps `kind` typed without a top-level import churn; if the file already imports enums, use that instead.)

- [ ] **Step 4: Run — verify pass.**

Run: `cd backend && node_modules/.bin/vitest run src/masters/masters.spec.ts`
Expected: PASS (all new + existing masters tests green).

- [ ] **Step 5: Add DTOs.** In `masters/dto.ts` append:

```ts
import { MASTER_RESOLUTION_KIND } from '../db/schema/enums'

export class CreateResolutionFactDto {
  @IsIn(MASTER_RESOLUTION_KIND as unknown as string[]) kind!: string
  @IsString() @MinLength(1) lhs!: string
  @IsOptional() @IsString() rhs?: string
  @IsOptional() @IsString() reason?: string
}
export class PatchResolutionFactDto {
  @IsOptional() @IsString() reason?: string
}
```

- [ ] **Step 6: Add controller routes.** In `masters.controller.ts`, add the DTO imports and, in the "Master resolution" block:

```ts
  @Get('resolution/manage') @Roles('ADMIN') resolutionManage() { return this.masters.resolutionManage() }
  @Post('resolution') @Roles('ADMIN') createFact(@Body() dto: CreateResolutionFactDto, @CurrentUser() u: AuthUser) {
    return this.masters.createFact(dto, u.id)
  }
  @Patch('resolution/:id') @Roles('ADMIN') patchFact(@Param('id') id: string, @Body() dto: PatchResolutionFactDto) {
    return this.masters.patchReason(id, dto.reason)
  }
  @Post('resolution/:id/deactivate') @Roles('ADMIN') deactivateFact(@Param('id') id: string) {
    return this.masters.deactivate(id)
  }
  @Post('resolution/:id/reactivate') @Roles('ADMIN') reactivateFact(@Param('id') id: string) {
    return this.masters.reactivate(id)
  }
```

Route order: declare `resolution/manage` BEFORE any `resolution/:id` isn't required (different verbs/paths), but keep `@Get('resolution')` (the consumer list) and `@Get('resolution/manage')` both present — Nest matches the literal `manage` fine.

- [ ] **Step 7: Typecheck + full masters + no regressions.**

Run: `cd backend && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run src`
Expected: PASS, 328+ backend tests green.

- [ ] **Step 8: Commit.**

```bash
git add backend/src/masters/
git commit -m "feat(masters): ADMIN CRUD for master_resolution facts (create/patch/deactivate/reactivate/manage)"
```

---

### Task 4: Non-destructive seed + retire `seed-entity-facts.ts`

**Files:**
- Modify: `backend/src/db/seed.ts` (truncate list; upserts; SEH row)
- Delete: `backend/src/db/seed-entity-facts.ts`
- Modify: `backend/package.json:11` (remove `seed:entity-facts` script)

- [ ] **Step 1: Stop truncating admin-owned tables.** In `seed.ts` the big `truncate table ... restart identity cascade` (lines ~20-28): remove `tracking.master_resolution,` and `tracking.app_settings,`. Remove the separate `truncate table alerts.alerts, alerts.alert_rules restart identity cascade` line's `alerts.alert_rules` — keep `alerts.alerts` (demo transactional). Result: `master_resolution`, `app_settings`, `alert_rules` are no longer truncated.

- [ ] **Step 2: Make their inserts idempotent.**
  - `MASTER_RESOLUTION_FACTS` insert (`db.insert(schema.masterResolution).values(...)`, ~line 140): append `.onConflictDoNothing()`.
  - `app_settings` insert (`db.insert(schema.appSettings).values({ key: 'confidence_threshold', value: 85 })`, ~line 232): append `.onConflictDoNothing()`.
  - `alert_rules` insert (`db.insert(schema.alertRules).values([...A1,A2...])`, ~line 223): append `.onConflictDoNothing()`.

- [ ] **Step 3: Reconcile SEH to the safe default.** In `MASTER_RESOLUTION_FACTS` (~line 124) replace the SEH row:

```ts
    { kind: 'customer_canonical', lhs: 'SEH', rhs: 'PRMK', reason: "group 13: SEH is Cobalt's internal short-form for Primark" },
```

with:

```ts
    { kind: 'customer_group', lhs: 'SEH', rhs: 'PRIMARK', reason: 'group 13: SEH bootstraps as a Primark GROUP sibling (stays reviewed); flip in Settings → Resolution Rules if confirmed a hard fold' },
```

- [ ] **Step 4: Update the seed header note.** In the top doc-comment of `seed.ts`, change "Idempotent: truncates first." to note the split: demo transactional data is truncated + reseeded, but `master_resolution` / `app_settings` / `alert_rules` are seeded idempotently (`onConflictDoNothing`) so runtime admin edits survive a reseed.

- [ ] **Step 5: Delete the legacy script + npm entry.**

```bash
git rm backend/src/db/seed-entity-facts.ts
```
In `backend/package.json`, delete line 11 (`"seed:entity-facts": ...`).

- [ ] **Step 6: Typecheck.**

Run: `cd backend && node_modules/.bin/tsc --noEmit`
Expected: PASS (nothing imports `seed-entity-facts`).

- [ ] **Step 7: Verify non-destructive behavior against dev DB.**

```bash
cd backend
node_modules/.bin/ts-node -P tsconfig.json src/db/seed.ts   # reseed once
# insert an ops fact directly, then reseed, and confirm it survives:
docker exec -i <pg> psql -U postgres -d cobalt -c "INSERT INTO tracking.master_resolution (kind,lhs,rhs,status,source,active) VALUES ('vendor_alias','PROBE ALIAS','PRB','approved','ops',true);"
node_modules/.bin/ts-node -P tsconfig.json src/db/seed.ts   # reseed again
docker exec -i <pg> psql -U postgres -d cobalt -c "SELECT count(*) FROM tracking.master_resolution WHERE lhs='PROBE ALIAS';"   # expect 1
docker exec -i <pg> psql -U postgres -d cobalt -c "SELECT kind FROM tracking.master_resolution WHERE lhs='SEH' AND active;"     # expect customer_group
```
Expected: the ops fact survives (count 1); SEH is `customer_group`. Clean up the probe row afterward.

- [ ] **Step 8: Commit.**

```bash
git add backend/src/db/seed.ts backend/package.json
git commit -m "feat(seed): non-destructive seed for resolution/app_settings/alert_rules; SEH→group; retire seed-entity-facts.ts"
```

---

### Task 5: Frontend API + `use-resolution` hook (TDD)

**Files:**
- Modify: `frontend/src/lib/api.ts` (add resolution methods)
- Create: `frontend/src/hooks/use-resolution.ts`
- Create: `frontend/src/hooks/use-resolution.test.tsx`

**Interfaces:**
- Produces: `useResolutionFacts()`, `useProposals()`, `useCreateFact()`, `usePatchFact()`, `useDeactivateFact()`, `useReactivateFact()`, `useApproveProposal()`, `useRejectProposal()`; type `ResolutionFact`.

- [ ] **Step 1: Add API methods.** In `api.ts`, inside the `export const api = { ... }` object (after the documents block), add:

```ts
  // --- master_resolution (curated facts) ---
  getResolutionManage: () => request<ResolutionFact[]>('/masters/resolution/manage'),
  getProposals: () => request<ResolutionFact[]>('/masters/proposals'),
  createFact: (body: { kind: string; lhs: string; rhs?: string; reason?: string }) => request<ResolutionFact>('/masters/resolution', { method: 'POST', body: JSON.stringify(body) }),
  patchFact: (id: string, body: { reason?: string }) => request<ResolutionFact>(`/masters/resolution/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deactivateFact: (id: string) => request<ResolutionFact>(`/masters/resolution/${id}/deactivate`, { method: 'POST' }),
  reactivateFact: (id: string) => request<ResolutionFact>(`/masters/resolution/${id}/reactivate`, { method: 'POST' }),
  approveProposal: (id: string) => request<ResolutionFact>(`/masters/proposals/${id}/approve`, { method: 'POST' }),
  rejectProposal: (id: string) => request<ResolutionFact>(`/masters/proposals/${id}/reject`, { method: 'POST' }),
```

And add the exported interface near `DocumentRow`:

```ts
export interface ResolutionFact {
  id: string
  kind: string
  lhs: string
  rhs: string | null
  status: string
  source: string
  reason: string | null
  active: boolean
  createdAt: string
}
```

- [ ] **Step 2: Write the failing hook test** `use-resolution.test.tsx` (mirror `use-users.test.tsx`):

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useResolutionFacts } from './use-resolution'

vi.mock('../lib/api', () => ({
  api: { getResolutionManage: vi.fn().mockResolvedValue([{ id: 'r1', kind: 'customer_group', lhs: 'SEH', rhs: 'PRIMARK', status: 'approved', source: 'seed', reason: null, active: true, createdAt: '' }]) },
}))

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useResolutionFacts', () => {
  it('fetches the manage list from GET /masters/resolution/manage', async () => {
    const { result } = renderHook(() => useResolutionFacts(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.data![0].lhs).toBe('SEH')
  })
})
```

- [ ] **Step 3: Run — verify fail.**

Run: `cd frontend && node_modules/.bin/vitest run src/hooks/use-resolution.test.tsx`
Expected: FAIL — cannot find `./use-resolution`.

- [ ] **Step 4: Implement `use-resolution.ts`** (mirror `use-users.ts`):

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ResolutionFact } from '../lib/api'
import { apiErrorMessage } from './use-users'
import { toast } from '../components/ui/Toast'

export type { ResolutionFact }
const FACTS = ['resolution-facts'] as const
const PROPOSALS = ['resolution-proposals'] as const

export function useResolutionFacts() {
  return useQuery({ queryKey: FACTS, queryFn: () => api.getResolutionManage() })
}
export function useProposals() {
  return useQuery({ queryKey: PROPOSALS, queryFn: () => api.getProposals() })
}
function mutation<V>(fn: (v: V) => Promise<unknown>, fail: string, keys: readonly (readonly string[])[]) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k })),
    onError: (e) => toast(apiErrorMessage(e, fail)),
  })
}
export function useCreateFact() { return mutation((b: { kind: string; lhs: string; rhs?: string; reason?: string }) => api.createFact(b), 'Failed to create fact', [FACTS]) }
export function usePatchFact() { return mutation(({ id, reason }: { id: string; reason?: string }) => api.patchFact(id, { reason }), 'Failed to update fact', [FACTS]) }
export function useDeactivateFact() { return mutation((id: string) => api.deactivateFact(id), 'Failed to deactivate', [FACTS]) }
export function useReactivateFact() { return mutation((id: string) => api.reactivateFact(id), 'Failed to reactivate', [FACTS]) }
export function useApproveProposal() { return mutation((id: string) => api.approveProposal(id), 'Failed to approve', [FACTS, PROPOSALS]) }
export function useRejectProposal() { return mutation((id: string) => api.rejectProposal(id), 'Failed to reject', [PROPOSALS]) }
```

Note: `mutation` is a custom hook calling `useQueryClient`/`useMutation` — it obeys the rules of hooks (called unconditionally inside each exported hook). If lint flags the helper, inline the three lines per hook instead (as `use-users.ts` does).

- [ ] **Step 5: Run — verify pass, and typecheck.**

Run: `cd frontend && node_modules/.bin/vitest run src/hooks/use-resolution.test.tsx && node_modules/.bin/tsc --noEmit`
Expected: PASS + clean types.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/use-resolution.ts frontend/src/hooks/use-resolution.test.tsx
git commit -m "feat(fe): resolution-fact api + use-resolution hooks"
```

---

### Task 6: Frontend `ResolutionRulesSettings` component (TDD)

**Files:**
- Create: `frontend/src/components/settings/ResolutionRulesSettings.tsx`
- Create: `frontend/src/components/settings/ResolutionRulesSettings.test.tsx`

**Interfaces:**
- Consumes: `use-resolution` hooks (Task 5).
- Produces: default/named `ResolutionRulesSettings` React component.

- [ ] **Step 1: Write the failing component test** (mirror `UsersSettings.test.tsx`):

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResolutionRulesSettings } from './ResolutionRulesSettings'

vi.mock('../../hooks/use-resolution', () => ({
  useResolutionFacts: () => ({
    data: [
      { id: 'r1', kind: 'customer_group', lhs: 'SEH', rhs: 'PRIMARK', status: 'approved', source: 'seed', reason: null, active: true, createdAt: '' },
      { id: 'r2', kind: 'vendor_alias', lhs: 'MACAU FUNG TAI', rhs: 'MACFUN', status: 'approved', source: 'ops', reason: null, active: false, createdAt: '' },
    ],
    isLoading: false, isError: false,
  }),
  useProposals: () => ({ data: [], isLoading: false }),
  useCreateFact: () => ({ mutate: vi.fn(), isPending: false }),
  usePatchFact: () => ({ mutate: vi.fn(), isPending: false }),
  useDeactivateFact: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateFact: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveProposal: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectProposal: () => ({ mutate: vi.fn(), isPending: false }),
}))

describe('ResolutionRulesSettings', () => {
  it('lists facts and marks a deactivated one', () => {
    render(<ResolutionRulesSettings />)
    expect(screen.getByText('SEH')).toBeInTheDocument()
    expect(screen.getByText('MACAU FUNG TAI')).toBeInTheDocument()
    expect(screen.getByText(/inactive/i)).toBeInTheDocument()
  })
  it('shows an Add rule control', () => {
    render(<ResolutionRulesSettings />)
    expect(screen.getByRole('button', { name: /add rule/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — verify fail.**

Run: `cd frontend && node_modules/.bin/vitest run src/components/settings/ResolutionRulesSettings.test.tsx`
Expected: FAIL — cannot find the component.

- [ ] **Step 3: Implement the component.** Create `ResolutionRulesSettings.tsx`. Structure (follow `UsersSettings.tsx` styling/tailwind conventions — card container, table, small buttons, a Toast on mutate):
  - Header: title "Resolution Rules" + subtitle "Curated alias / group / canonical facts served to the parser & committer."
  - **Add form** (toggle with an "Add rule" button): a `<select>` of the 9 kinds (`const KINDS = ['vendor_alias','vendor_name_marker','customer_vendor','consignee_for_customer','forwarder_ref','customer_canonical','customer_group','customer_role','vendor_group']`), text inputs `lhs`, `rhs`, `reason`; submit calls `useCreateFact().mutate({kind,lhs,rhs,reason})`.
  - **Facts table** from `useResolutionFacts()`: group rows by `kind` (a subheading row per kind), columns `lhs · rhs · reason · source · status`. A deactivated row (`active===false`) renders muted + an **"inactive"** badge. Row actions: **Edit reason** (inline prompt → `usePatchFact().mutate({id, reason})`), **Deactivate** (`useDeactivateFact().mutate(id)`) when active else **Reactivate** (`useReactivateFact().mutate(id)`).
  - **Proposals inbox** from `useProposals()`: if any, a section listing each with **Approve** (`useApproveProposal().mutate(id)`) / **Reject** (`useRejectProposal().mutate(id)`); hide the section when empty.
  - Export as a named export `export function ResolutionRulesSettings()`.
  Keep it a single focused file (< ~180 lines). Use the exact button label text `Add rule` and badge text `inactive` so the tests match.

- [ ] **Step 4: Run — verify pass + typecheck.**

Run: `cd frontend && node_modules/.bin/vitest run src/components/settings/ResolutionRulesSettings.test.tsx && node_modules/.bin/tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/components/settings/ResolutionRulesSettings.tsx frontend/src/components/settings/ResolutionRulesSettings.test.tsx
git commit -m "feat(fe): ResolutionRulesSettings — facts table + add form + proposals inbox"
```

---

### Task 7: Frontend routing/nav — `AdminRoute` + role-aware Settings tab

**Files:**
- Modify: `frontend/src/App.tsx` (add `AdminRoute`; register `/settings/resolution`)
- Modify: `frontend/src/pages/SettingsPage.tsx` (role-aware nav; render the tab)
- Create: `frontend/src/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Write the failing nav test** `SettingsPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SettingsPage from './SettingsPage'

const mockUser = { role: 'ADMIN' }
vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ user: mockUser, loading: false }) }))
vi.mock('../components/settings/ResolutionRulesSettings', () => ({ ResolutionRulesSettings: () => <div>resolution-tab</div> }))
vi.mock('../components/settings/UsersSettings', () => ({ UsersSettings: () => <div>users</div> }))
vi.mock('../components/settings/VendorsSettings', () => ({ VendorsSettings: () => <div>vendors</div> }))
vi.mock('../components/settings/AlertRulesSettings', () => ({ AlertRulesSettings: () => <div>alerts</div> }))

describe('SettingsPage nav (role-aware)', () => {
  it('an ADMIN sees the Resolution Rules tab but not superadmin-only tabs', () => {
    mockUser.role = 'ADMIN'
    render(<MemoryRouter initialEntries={['/settings/resolution']}><SettingsPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /resolution rules/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^users$/i })).not.toBeInTheDocument()
  })
  it('a SUPERADMIN sees every tab', () => {
    mockUser.role = 'SUPERADMIN'
    render(<MemoryRouter initialEntries={['/settings']}><SettingsPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /resolution rules/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^users$/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — verify fail.**

Run: `cd frontend && node_modules/.bin/vitest run src/pages/SettingsPage.test.tsx`
Expected: FAIL (Resolution Rules link absent; page not role-aware).

- [ ] **Step 3: Make `SettingsPage` role-aware.** Rewrite the nav array + content switch:
  - Import `useAuth`: `const { user } = useAuth()`; `const isSuper = user?.role === 'SUPERADMIN'`.
  - Nav items become `{ to, label, end?, superOnly }`: General/Alert Rules/Vendors/Users get `superOnly: true`; add `{ to: '/settings/resolution', label: 'Resolution Rules', superOnly: false }`. Render `.filter((i) => isSuper || !i.superOnly)`.
  - Add `const isResolution = location.pathname.includes('/settings/resolution')` and render `<ResolutionRulesSettings/>` first in the content switch. Import it.

- [ ] **Step 4: Add `AdminRoute` + register the route in `App.tsx`.** After `SuperadminRoute`:

```tsx
/** ADMIN or higher — used for resolution-rule management, which is ADMIN-capable unlike the rest of Settings. */
function AdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user && user.role !== 'ADMIN' && user.role !== 'SUPERADMIN') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
```

Then in `AppRoutes`, beside the other settings routes:

```tsx
        <Route path="/settings/resolution" element={<AdminRoute><SettingsPage /></AdminRoute>} />
```

- [ ] **Step 5: Run the new test + full frontend suite + typecheck.**

Run: `cd frontend && node_modules/.bin/vitest run src/pages/SettingsPage.test.tsx && node_modules/.bin/vitest run && node_modules/.bin/tsc --noEmit`
Expected: new test PASS; 62+ existing frontend tests still green; clean types.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/App.tsx frontend/src/pages/SettingsPage.tsx frontend/src/pages/SettingsPage.test.tsx
git commit -m "feat(fe): AdminRoute + role-aware Settings nav; wire Resolution Rules tab"
```

---

### Task 8: End-to-end verification, docs, and PR

**Files:**
- Modify: `TODO.md` (tick the DB-split items done here; add the out-of-scope follow-ups)
- Reference: memory `cobalt-master-data-governance`, `cobalt-system-wiring`

- [ ] **Step 1: Full green gate.**

Run: `cd backend && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run` then `cd frontend && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run`
Expected: 330+ backend + 64+ frontend tests pass (baseline + new), types clean both sides.

- [ ] **Step 2: Live UI verification.** Start the stack (per `run-the-full-system`: PG `cobalt` + backend :3000 + frontend :5173), log in as an ADMIN, open **Settings → Resolution Rules**. Verify via the preview tools:
  - The facts table renders; SEH shows as `customer_group`.
  - Add a fact (`vendor_alias` / `TEST NAME` → `TCODE`); it appears active.
  - Deactivate it; row shows `inactive`.
  - `GET /api/masters/resolution` (network tab or curl) **excludes** the deactivated fact but **includes** active ones — confirms the consumer contract + filter.
  - Re-add the same `(vendor_alias, TEST NAME)` with a different rhs; the old row goes inactive (single-active invariant). Clean up the test rows after.
  Capture a screenshot of the tab.

- [ ] **Step 3: Update `TODO.md`.** Under "Architecture — split queue + ShipTrack" remaining follow-ups: mark the `seed-entity-facts.ts` retire + SEH reconcile **done**; note `backfill-shipment-ports.sql` already uses `ingest.parsed_record` (done). Add a new "Follow-ups (out of scope of this feature)" bullet list: code-only port maps (`masters.repository.ts`) + cobalt-queue soul/`validate.ts` rules → migrate to data; cobalt-queue `docker-compose` DB name → `cobalt_queue`; `graphAttachmentId` test; the commented-out SUPERADMIN guard on alert-rules write.

- [ ] **Step 4: Commit docs + push + open PR.**

```bash
git add TODO.md docs/superpowers/plans/2026-07-08-master-resolution-management.md
git commit -m "docs(todo): master_resolution management shipped; log out-of-scope follow-ups"
git push -u origin feat/master-resolution-management
gh pr create --fill --base main
```

- [ ] **Step 5: Update memory.** Append a note to `cobalt-master-data-governance` (or a new memory) that `master_resolution` is now ADMIN-manageable at runtime (Settings → Resolution Rules), the seed is non-destructive for it, and SEH is a `customer_group` fact by default — so it's data, not code.

---

## Self-Review

**Spec coverage:** Data model (`active`) → T1. Backend endpoints (create/patch/deactivate/reactivate/manage + consumer filter) → T2/T3. Single-active invariant → T2 (`deactivateActiveFor`) + T3 tests. Non-destructive seed + retire `seed-entity-facts` + SEH default → T4. Frontend tab (facts table + add + proposals inbox) → T5/T6. ADMIN gating + placement under Settings → T7. Testing → per-task TDD + T8 e2e. Consumers/compat (cobalt-queue no-change; committer filter) → T2 + T8 verification. Non-goals logged → T8 Step 3. All spec sections covered.

**Placeholder scan:** No TBD/TODO. The one non-verbatim block is Task 6 Step 3 (component body given as a precise structural spec with exact hook calls, kind list, label/badge strings, and file-size bound) — deliberately, to avoid transcribing a ~180-line React view; its behavior is pinned by the Task 6 tests.

**Type consistency:** `ResolutionFact` shape identical in `api.ts` and hook/component mocks. Service method names (`createFact`, `patchReason`, `deactivate`, `reactivate`, `resolutionManage`) match between T3 impl, tests, and controller. Repo method names (`deactivateActiveFor`, `insertOpsFact`, `getFact`, `setActive`, `patchReason`, `listResolutionManage`) match between T2 (produces) and T3 (consumes). Hook names match between T5 (produces) and T6 mocks.
