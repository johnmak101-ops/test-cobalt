# Critic Review UI — Implementation Plan (Phase 1-UI, issue #100)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the queue's `criticReview` payload in ShipTrack, then render it as advisory triage on the Review Queue: band badge + conflict-only expandable card (Existing / Proposed / Recommended / Resolution), with Active / Rejected / Approved views and read-only resolved snapshots — without changing confirmed/provisional routing.

**Architecture:** Two coordinated repos. **Part A (cobalt-queue first)** adds optional `criticReview.conflicts[]` so the UI has structured candidates for every contested field. **Part B (ShipTrack)** accepts + persists the full JSON on the leg (`critic_review` nvarchar(max)), projects a compact band/summary for the list, and renders collapsible conflict cards. Routing stays on the gate's `autoApply` / `disposition`; queue sort stays `confidence ASC` (number not shown). Concurrency token = existing `updatedAt`.

**Tech Stack:**
- **Part A:** TypeScript ESM (`.js` import suffixes), vitest, hand-rolled validator (no zod).
- **Part B:** NestJS + Kysely + MSSQL; React 19 / Vite / Tailwind v4 / react-query; monorepo `pnpm --filter backend|frontend`.

## Global Constraints

- **Additive + null-safe.** Legacy legs without `criticReview` render exactly as today (no band, no conflict card expand content).
- **Do NOT change confirmed/provisional routing** (`autoApply` / `disposition` / confidence-threshold fallback in `decisions.service.ts`).
- **Do NOT change queue sort** — keep `orderBy('shipments.confidence', 'asc')` then recency.
- **Band display only** — show `Low` / `Medium` (and High only if ever surfaced); never show the raw score in the UI.
- **Conflicts-only table** — missing / clean / agreeing fields are not shown.
- **Migrations MUST be registered** in `backend/src/db/migrate-cli.ts` `MIGRATIONS` or they are silently skipped.
- **CI fails on eslint** — run `pnpm lint` before commit, not just tsc/tests.
- **Part A ships first** so fixtures and live POSTs carry `conflicts[]` before ShipTrack UI depends on them.
- **Every task ends green** (relevant test suite) and is **committed** before the next begins.

---

## Repo-boundary map

| Concern | Repo | Tasks |
|---|---|---|
| `CriticConflict` + populate `conflicts[]` + golden fixture | cobalt-queue (`D:\cobalt-queue`) | 1–2 |
| Migration + DTO + persist + jsonify | ShipTrack | 3–4 |
| Read model (detail + queue compact) | ShipTrack | 5 |
| Integrity guards (provisional-only + `updatedAt`) | ShipTrack | 6 |
| Frontend badge + card + queue tabs | ShipTrack | 7–9 |
| Docs / handoff | both as needed | 10 |

---

## File structure

### Part A — cobalt-queue (create/modify)

**Modify**
- `src/critic-agent/review/types.ts` — `CriticConflict`, `conflicts?` on `CriticReview`, validate when present
- `src/critic-agent/review/deterministic.ts` — `buildConflicts(input, signals)`
- `src/critic-agent/review/review-io.ts` — if emptySafe / clamp clones review, preserve `conflicts`
- `prompts/cobalt-critic-review-agent.md` — document `conflicts[]` in output schema (optional soul note)
- `test/fixtures/critic-review.sample.json` — regenerate (include `conflicts: []` or derived rows for high case)
- Tests: `src/critic-agent/review/{types,deterministic}.test.ts`, `test/critic-review-contract.test.ts`

### Part B — ShipTrack

**Create**
- `backend/src/db/kysely-migrations/0012_shipment_critic_review.ts`
- `backend/src/decisions/critic-review.types.ts` — shared TS shape for backend (mirror queue; loose)
- `frontend/src/components/review/ReviewCard.tsx`
- `frontend/src/components/review/ConflictRow.tsx`
- `frontend/src/lib/critic-review.ts` — band labels, topConflictType mapping, types
- Tests: `frontend/src/lib/critic-review.test.ts`, `frontend/src/components/review/ReviewCard.test.tsx` (or co-located vitest)

**Modify**
- `backend/src/db/migrate-cli.ts` — register `0012`
- `backend/src/db/kysely/db.ts` — `Json<CriticReview | null>`
- `backend/src/db/kysely/db.generated.ts` — via `pnpm --filter backend run db:codegen` after migrate (or hand-add `criticReview: string | null` if codegen not run in CI)
- `backend/src/decisions/dto.ts` — optional `criticReview?: object`
- `backend/src/decisions/decisions.service.ts` — pass through onto `ReconGroup`
- `backend/src/reconcile/committer.service.ts` — `ReconGroup.criticReview`; insert/metaPatch
- `backend/src/db/repositories/shipment.repository.ts` — jsonify `criticReview`; select for queue/detail
- `backend/src/presentation/mappers/shipment.mapper.ts` — detail pass-through
- `backend/src/presentation/presentation.service.ts` — compact queue fields; Approved view if needed
- `backend/src/review/dto.ts` + `review.service.ts` — provisional guard + `expectedUpdatedAt`
- `frontend/src/components/ui/Badge.tsx` — `variant="confidence"`
- `frontend/src/hooks/use-review-queue.ts` — types + hooks
- `frontend/src/pages/ReviewQueuePage.tsx` — band column, remove Why review?, tabs, expand
- `frontend/src/pages/ReviewShipmentPage.tsx` — conflict card primary + Save&Approve with version

---

## Part A — cobalt-queue

### Task 1: `CriticConflict` type + validator

**Files:**
- Modify: `D:\cobalt-queue\src\critic-agent\review\types.ts`
- Test: `D:\cobalt-queue\src\critic-agent\review\types.test.ts`

**Interfaces:**
- Consumes: existing `Band`, `CriticReview`
- Produces:
```ts
export interface CriticConflictCandidate {
  value: string
  source: string  // 'System' | 'SO' | 'Final B/L' | 'Draft B/L' | emailType | …
  confidence?: Band
}
export interface CriticConflict {
  field: string
  label: string
  candidates: CriticConflictCandidate[]  // length ≥ 2 when present
  recommended: string | null             // null = no safe pick
  rationale: string
}
// CriticReview.conflicts?: CriticConflict[]
```
- `validateCriticReview`: if `conflicts` is present, must be an array; each item has non-empty `field`/`label`/`rationale` strings; `candidates` array length ≥ 2 with string `value`/`source`; `recommended` is `string | null`. Missing `conflicts` is valid (legacy payloads).

- [ ] **Step 1: Write the failing test**

```ts
// append to types.test.ts
it('accepts optional conflicts[] with ≥2 candidates', () => {
  const withConflicts = {
    ...valid,
    conflicts: [{
      field: 'eta',
      label: 'ETA',
      candidates: [
        { value: '2026-07-20', source: 'System' },
        { value: '2026-07-23', source: 'SO' },
      ],
      recommended: '2026-07-23',
      rationale: 'Newer SO supersedes stored ETA.',
    }],
  }
  expect(validateCriticReview(withConflicts)).toEqual([])
})
it('rejects conflicts entry with fewer than 2 candidates', () => {
  expect(validateCriticReview({
    ...valid,
    conflicts: [{ field: 'eta', label: 'ETA', candidates: [{ value: 'x', source: 'SO' }], recommended: null, rationale: 'r' }],
  })).not.toEqual([])
})
```

- [ ] **Step 2: Run** `pnpm vitest run src/critic-agent/review/types.test.ts` → FAIL (no conflicts validation / type).
- [ ] **Step 3: Implement** types + validator branch.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(critic-review): CriticConflict type + optional conflicts[] validator"`

---

### Task 2: Populate `conflicts[]` in deterministic agent + fixture

**Files:**
- Modify: `D:\cobalt-queue\src\critic-agent\review\deterministic.ts`
- Modify: `D:\cobalt-queue\test\fixtures\critic-review.sample.json`
- Test: `D:\cobalt-queue\src\critic-agent\review\deterministic.test.ts`
- Test: `D:\cobalt-queue\test\critic-review-contract.test.ts`

**Interfaces:**
- Produces: `buildConflicts(input: CriticReviewInput, s: RiskSignals): CriticConflict[]`
- Rules (design §8):
  1. For each `backendMismatches` entry where values differ:
     - `candidates: [{ value: String(backendValue ?? ''), source: 'System' }, { value: String(emailValue ?? ''), source: primaryEmailType(draft) }]`
     - Skip if either value empty and the other empty; ensure ≥2 distinct non-empty candidates, else skip row
     - `recommended = emailValue` string if `verdict === 'update' || verdict === 'addition'`; `null` if `verdict === 'conflict'`
     - `rationale` ops-language one line
  2. For each type in `s.multiStrongIdTypes`, collect current identifiers of that type (≥2 values):
     - `candidates` from each `{ value, source: docType || 'Email' }`
     - `recommended: null`
     - `field` = type key, `label` = fieldLabel(type)
  3. Deduplicate by `field` (backend mismatch wins over multi-id if both — prefer backend row).

- Attach `conflicts: buildConflicts(...)` on the returned `CriticReview` (always array; may be empty).
- Empty-safe / hard-stop paths: still include `conflicts` when derived.
- Regenerate golden fixture: high-case ETA update should produce one conflict-like row **or** empty conflicts if design treats clean updates as proposedChanges only — **decision for this plan:** emit `conflicts[]` only for contested cases (`verdict === 'conflict'` OR multi-id OR intra-email multi-candidate). Clean `update` stays in `proposedChanges` only so the UI conflict table stays conflict-only.
  - Clarified rule: **include** backend mismatch when `verdict === 'conflict'` OR when operator must choose (multi-id); **do not** put clean `update` supersedes into `conflicts[]` (those are proposedChanges / auto-friendly).
  - Multi-id always in `conflicts[]` with `recommended: null`.

- [ ] **Step 1: Write failing tests**

```ts
it('backend conflict → conflicts[] with recommended null', async () => {
  const r = await A.review({
    draft: draft({
      backendMismatches: [{ field: 'mbl', emailValue: 'a', backendValue: 'b', verdict: 'conflict' }],
    }),
    prior: { fields: { mbl: 'b' } },
  })
  const c = r.conflicts?.find((x) => x.field === 'mbl')
  expect(c).toBeTruthy()
  expect(c!.candidates).toHaveLength(2)
  expect(c!.recommended).toBeNull()
})
it('multi co-current hbl → conflicts[] recommended null', async () => {
  const r = await A.review({
    draft: draft({
      identifiers: [
        { type: 'hbl_awb_fcr_no', value: 'H1', docType: 'Final B/L', rank: 5, isCurrent: true, sourceEmailId: null, observedAt: null },
        { type: 'hbl_awb_fcr_no', value: 'H2', docType: 'Draft B/L', rank: 4, isCurrent: true, sourceEmailId: null, observedAt: null },
      ],
    }),
    prior: null,
  })
  expect(r.conflicts?.some((c) => c.field === 'hbl_awb_fcr_no' && c.recommended === null)).toBe(true)
})
it('clean ETA update does NOT add conflicts[] (proposedChanges only)', async () => {
  const r = await A.review({
    draft: draft({
      matchKey: { booking_no: 'BY058417', so_no: 'SO-1' },
      backendMismatches: [{ field: 'eta', emailValue: '2026-07-23', backendValue: '2026-07-20', verdict: 'update' }],
    }),
    prior: { fields: { booking_no: 'BY058417', eta: '2026-07-20' } },
  })
  expect(r.conflicts ?? []).toEqual([])
  expect(r.proposedChanges.some((p) => p.field === 'eta')).toBe(true)
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `buildConflicts` + wire into `review()`; set fixture `conflicts: []` for high sample; ensure contract still deep-equals.
- [ ] **Step 4: Full** `pnpm test` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(critic-review): emit conflicts[] for multi-id and backend conflicts"`

---

## Part B — ShipTrack

### Task 3: Migration `0012` + register + Kysely types

**Files:**
- Create: `backend/src/db/kysely-migrations/0012_shipment_critic_review.ts`
- Modify: `backend/src/db/migrate-cli.ts`
- Modify: `backend/src/db/kysely/db.ts`
- Modify: `backend/src/db/kysely/db.generated.ts` (codegen or hand-add)

**Interfaces:**
- Column: `critic_review nvarchar(max) NULL` on `shipments`
- Generated: `criticReview: string | null`
- Overlay: `criticReview: Json<CriticReviewPayload | null>` where `CriticReviewPayload` is a local type (Task 4 can own the full interface file)

- [ ] **Step 1: Write migration**

```ts
// backend/src/db/kysely-migrations/0012_shipment_critic_review.ts
import { sql, type Kysely } from 'kysely'

/** 0012 — store agent criticReview JSON on the leg (advisory Phase 1-UI). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments ADD critic_review nvarchar(max) NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP COLUMN critic_review`).execute(db)
}
```

- [ ] **Step 2: Register** in `migrate-cli.ts`:
```ts
import * as m0012_shipment_critic_review from './kysely-migrations/0012_shipment_critic_review'
// in MIGRATIONS:
'0012_shipment_critic_review': m0012_shipment_critic_review,
```

- [ ] **Step 3: Run** `pnpm --filter backend run db:migrate` against local SQL Server (or test DB). Confirm column exists.
- [ ] **Step 4: Types** — run `pnpm --filter backend run db:codegen` if available; else hand-add `criticReview: string | null` to generated `Shipments`. In `db.ts`, omit `criticReview` and re-add as `Json<Record<string, unknown> | null>` temporarily (tighten in Task 4).
- [ ] **Step 5: Commit** `git commit -m "feat(db): shipments.critic_review column (migration 0012 + registry)"`

---

### Task 4: Accept + persist `criticReview` on decisions

**Files:**
- Create: `backend/src/decisions/critic-review.types.ts`
- Modify: `backend/src/decisions/dto.ts`
- Modify: `backend/src/decisions/decisions.service.ts`
- Modify: `backend/src/reconcile/committer.service.ts`
- Modify: `backend/src/db/repositories/shipment.repository.ts`
- Test: `backend/test/decisions.int.spec.ts` and/or `backend/test/committer.int.spec.ts`

**Interfaces:**
```ts
// critic-review.types.ts — mirror queue shape loosely
export type Band = 'low' | 'medium' | 'high'
export interface CriticConflict {
  field: string
  label: string
  candidates: { value: string; source: string; confidence?: Band }[]
  recommended: string | null
  rationale: string
}
export interface CriticReview {
  confidence: { score: number; band: Band; label: string }
  summary: string
  observations: string[]
  priorState: { headline: string; fields: unknown[] }
  proposedChanges: unknown[]
  riskFlags: { code: string; severity: Band; message: string }[]
  conflicts?: CriticConflict[]
  recommendedHumanAction: string
  reasons: string[]
}
```

- DTO: `@IsOptional() @IsObject() criticReview?: object` on `CreateDecisionDto` (class-validator; no deep schema).
- `decisions.service.ts`: include `criticReview: dto.criticReview ?? null` on `ReconGroup`.
- `ReconGroup`: `criticReview?: object | null`
- committer: on insertLeg + metaPatch when review path, set `criticReview: g.criticReview ?? null` (do not wipe on unrelated amends if absent — only set when `g.criticReview !== undefined`).
- `jsonifyLegColumns`: add `'criticReview'` alongside `matchKeys` / `reviewReasons`.

- [ ] **Step 1: Failing integration test**

```ts
// decisions.int.spec.ts
it('persists criticReview JSON on the leg and round-trips', async () => {
  const criticReview = {
    confidence: { score: 38, band: 'low', label: 'Low' },
    summary: 'Two HBLs',
    observations: [],
    priorState: { headline: 'New', fields: [] },
    proposedChanges: [],
    riskFlags: [{ code: 'INTRA_EMAIL_MULTI_STRONG_ID', severity: 'high', message: 'multi' }],
    conflicts: [{
      field: 'hbl_awb_fcr_no', label: 'HBL',
      candidates: [{ value: 'H1', source: 'Final B/L' }, { value: 'H2', source: 'Draft B/L' }],
      recommended: null, rationale: 'Split or multi-leg',
    }],
    recommendedHumanAction: 'split_or_multi_leg',
    reasons: ['multi'],
  }
  const r = await decisions.ingest(decision({
    autoApply: false,
    disposition: 'review',
    confidence: 38,
    criticReview,
  }))
  const leg = await shipments.findById(r.shipmentId!)
  expect(leg?.criticReview).toMatchObject({ confidence: { band: 'low' } })
  expect((leg?.criticReview as { conflicts: unknown[] }).conflicts).toHaveLength(1)
})
```

- [ ] **Step 2: Run** `pnpm --filter backend run test -- test/decisions.int.spec.ts` → FAIL (DTO strips / column missing / not persisted).
- [ ] **Step 3: Implement** DTO → service → ReconGroup → committer → jsonify.
- [ ] **Step 4: Run** → PASS; full backend unit tests green.
- [ ] **Step 5: Commit** `git commit -m "feat(decisions): accept and persist criticReview on shipment legs"`

---

### Task 5: Read model — detail + compact queue projection

**Files:**
- Modify: `backend/src/presentation/mappers/shipment.mapper.ts`
- Modify: `backend/src/presentation/presentation.service.ts`
- Modify: `backend/src/db/repositories/shipment.repository.ts` (select `criticReview` in queue/detail queries if not `selectAll`)
- Test: `backend/src/presentation/mappers/shipment.mapper.spec.ts`
- Optional unit: pure helper `compactCriticReview(cr): { band, summary, topConflictType } | null`

**Interfaces:**
```ts
export function compactCriticReview(cr: CriticReview | null | undefined): {
  band: Band
  summary: string
  topConflictType: string
} | null {
  if (!cr?.confidence?.band) return null
  const top = cr.riskFlags?.[0]
  const topConflictType = top
    ? shortLabelForRisk(top.code) // e.g. INTRA_EMAIL_MULTI_STRONG_ID → 'Two strong IDs in one email'
    : cr.conflicts?.[0]?.label
      ? `${cr.conflicts[0].label} conflict`
      : 'Needs review'
  return { band: cr.confidence.band, summary: cr.summary, topConflictType }
}
```

Map RISK codes → short AI-comment types (design §2.2 examples):
| code | short type |
|------|------------|
| `INTRA_EMAIL_MULTI_STRONG_ID` | Two strong IDs in one email |
| `BACKEND_CONFLICT` | Stored value disagrees |
| `PO_REASSIGN` | PO may belong to another shipment |
| `PORTAL_ECHO` | Portal notification only |
| `AMBIGUOUS_MATCH` | Multiple matching legs |
| `FIELD_LOCK_CLASH` | Would overwrite locked field |
| default | Needs review |

- Detail: `UiShipment.criticReview: CriticReview | null`, `updatedAt: string` (ISO) for concurrency.
- Queue list item: add `criticReviewCompact: { band, summary, topConflictType } | null` and `updatedAt`.
- **Do not** project raw `confidence` number to the queue UI (sort stays server-side).

- [ ] **Step 1: Unit test** mapper + compact helper.
- [ ] **Step 2: FAIL → implement → PASS.**
- [ ] **Step 3: Commit** `git commit -m "feat(presentation): surface criticReview on detail + compact queue projection"`

---

### Task 6: Integrity — provisional-only + optimistic concurrency

**Files:**
- Modify: `backend/src/review/dto.ts`
- Modify: `backend/src/review/review.service.ts`
- Test: `backend/src/review/review.service.spec.ts` and/or `backend/test/review.int.spec.ts`

**Interfaces:**
```ts
// CorrectDto / ConfirmDto
@IsOptional() @IsString() expectedUpdatedAt?: string  // ISO from client load
```

In `confirm` / `correct`:
1. Load leg; if missing → 404.
2. If `leg.reviewStatus !== 'provisional'` → `409 Conflict` with message `shipment is not provisional`.
3. If `expectedUpdatedAt` provided and `new Date(expectedUpdatedAt).getTime() !== new Date(leg.updatedAt).getTime()` → `409` stale (reload).
4. Else existing lock/audit behavior.

Dismiss/restore: no change required beyond existing behavior (Rejected view uses dismissed legs).

- [ ] **Step 1: Failing tests** for non-provisional confirm and stale `expectedUpdatedAt`.
- [ ] **Step 2: Implement guards.**
- [ ] **Step 3: PASS + commit** `git commit -m "feat(review): reject non-provisional and stale updatedAt on confirm/correct"`

---

### Task 7: Frontend types + Badge confidence + critic helpers

**Files:**
- Create: `frontend/src/lib/critic-review.ts`
- Create: `frontend/src/lib/critic-review.test.ts`
- Modify: `frontend/src/components/ui/Badge.tsx`
- Modify: `frontend/src/hooks/use-review-queue.ts`
- Modify: `frontend/src/hooks/use-shipments.ts` (ShipmentDetail if needed)

**Interfaces:**
```ts
// critic-review.ts
export type Band = 'low' | 'medium' | 'high'
export interface CriticConflict { /* same as backend */ }
export interface CriticReview { /* same shape used by UI */ }
export interface CriticReviewCompact { band: Band; summary: string; topConflictType: string }
export function bandLabel(band: Band): 'Low' | 'Medium' | 'High'
export function aiCommentLine(compact: CriticReviewCompact): string
// e.g. `${bandLabel(band)} · ${topConflictType}`
```

- `Badge`: `variant?: 'severity' | 'status' | 'emailType' | 'confidence'`
  - styles: `low` → critical token, `medium` → warning, `high` → success
  - display: Low / Medium / High (title case)

- `ReviewShipment`: add `criticReviewCompact: CriticReviewCompact | null`, `updatedAt: string`
- Confirm/Correct hooks: pass `expectedUpdatedAt` when available

- [ ] **Step 1: Tests** for `bandLabel`, `aiCommentLine`, Badge confidence render if component-tested.
- [ ] **Step 2: Implement → PASS.**
- [ ] **Step 3: Commit** `git commit -m "feat(frontend): confidence Badge + critic-review helpers/types"`

---

### Task 8: `ConflictRow` + `ReviewCard` components

**Files:**
- Create: `frontend/src/components/review/ConflictRow.tsx`
- Create: `frontend/src/components/review/ReviewCard.tsx`
- Test: `frontend/src/components/review/ReviewCard.test.tsx` (vitest + testing-library if project has it; else pure props tests of derived state)

**Interfaces:**
```tsx
// ConflictRow props
{
  conflict: CriticConflict
  value: string            // resolution controlled
  onChange: (v: string) => void
  readOnly?: boolean
}

// ReviewCard props
{
  shipment: ReviewShipment | ShipmentDetail
  criticReview: CriticReview | null
  compact?: CriticReviewCompact | null  // for collapsed AI line without full payload
  defaultExpanded?: boolean
  readOnly?: boolean                   // resolved history
  onSaveAndApprove?: (payload: {
    fields: Record<string, unknown>
    note: string
    expectedUpdatedAt?: string
  }) => Promise<void>
  onApprove?: () => Promise<void>      // no field edits
  onDismiss?: () => Promise<void>
}
```

**Behavior:**
- Collapsed: band badge + existing identity line (customer · booking · route · status · actions). No AI text when fully collapsed list-mode; design §2.1 — band on row, expand for details.
- Expanded: `aiCommentLine` + table of **only** `criticReview.conflicts` (if empty, show short empty state “No field conflicts — review reasons may still apply” without inventing rows from proposedChanges).
- Resolution inputs prefilled with `recommended ?? ''`.
- If any resolution differs from recommended/initial, **note required** before Save&Approve.
- Read-only: show resolved values, hide inputs and primary button.

- [ ] **Step 1: Component tests** — collapsed no conflict table; expanded only conflicts; note required when dirty.
- [ ] **Step 2: Implement → PASS.**
- [ ] **Step 3: Commit** `git commit -m "feat(frontend): ReviewCard + ConflictRow (conflict-only)"`

---

### Task 9: Wire Review Queue + detail pages + tabs

**Files:**
- Modify: `frontend/src/pages/ReviewQueuePage.tsx`
- Modify: `frontend/src/pages/ReviewShipmentPage.tsx`
- Modify: `backend/src/presentation/presentation.service.ts` + repo if Approved tab needs new query
- Modify: `frontend/src/hooks/use-review-queue.ts` (views: `active` | `rejected` | `approved`)

**Queue views mapping (design §3):**
| Tab | Backend |
|-----|---------|
| Active | existing `view=pending` (provisional, not dismissed) |
| Rejected | existing `view=dismissed` |
| Approved | **new** `view=approved`: `reviewStatus = 'confirmed'`, not superseded, has `critic_review IS NOT NULL` (or all confirmed — prefer “has criticReview” for history relevance; if empty UX, fall back to recent confirmed) |

Backend:
```ts
// reviewQueue(view: 'pending' | 'dismissed' | 'approved')
// approved: where reviewStatus = confirmed, legStatus <> SUPERSEDED, order confidence asc / reviewedAt desc
```

**ReviewQueuePage:**
- Tabs: Active | Rejected | Approved (labels).
- Remove **Why review?** column and `humanizeReasons` cell.
- Prepend **Band** column: `criticReviewCompact?.band` → `<Badge variant="confidence" value={band} />` or empty.
- Keep Customer / Booking / Route / Status / Action; Approve/Dismiss on Active collapsed rows.
- Row expand: inline accordion rendering `<ReviewCard readOnly={view!=='active'} />` **or** keep navigate-to-detail; **this plan chooses:** expand inline for conflicts + keep click-through to detail for full editor. If inline is heavy, detail-only is OK as long as detail shows the card first.
- Category chips: may keep filtering on remaining `reviewReasons` if still present; if reasons empty when only critic path, chips degrade gracefully.

**ReviewShipmentPage:**
- Load full `criticReview` from detail API.
- Render `ReviewCard` at top; Save&Approve → `correct` (if dirty fields) then `confirm`, or single correct+confirm sequence matching existing page; pass `expectedUpdatedAt`.
- On 409 stale → toast + refetch.

- [ ] **Step 1: Adjust backend approved view + frontend hooks tests if any.**
- [ ] **Step 2: Wire pages; manual smoke via `pnpm dev`.**
- [ ] **Step 3: `pnpm lint` + `pnpm --filter frontend run test` + backend tests.**
- [ ] **Step 4: Commit** `git commit -m "feat(review-ui): band column, conflict card, Active/Rejected/Approved tabs"`

---

### Task 10: Docs + handoff

**Files:**
- Modify: ShipTrack `README.md` / `AGENTS.md` if they document review queue
- Modify: `docs/superpowers/specs/2026-07-14-critic-review-ui-design.md` status → implemented (or add delivered note)
- Optional: cobalt-queue handoff already notes Phase 1; add “conflicts[] + ShipTrack Phase 1-UI”

- [x] **Step 1: Document** `critic_review` column, DTO field, `CRITIC_REVIEW` consumer fixture path, UI tabs.
- [x] **Step 2: Commit** `git commit -m "docs(critic-review-ui): Phase 1-UI land+render delivered notes"`

---

## Phase 1-UI verification (before landing)

- [ ] cobalt-queue: `pnpm test` green; golden fixture updated; `conflicts[]` contract covered.
- [ ] ShipTrack: `pnpm --filter backend run db:migrate` applied; `pnpm lint`; backend + frontend tests green.
- [ ] Smoke: POST decision with fixture-like `criticReview` → appears on Active queue with band; expand shows conflicts; Save&Approve locks fields + confirms; second confirm 409; Rejected/Approved tabs read-only.
- [ ] Regression: decision without `criticReview` still works; autoApply true still confirms without queue noise.
- [ ] Open PRs: label **Phase 1-UI (advisory)**; link issue #100; mention Part A dependency.

---

## Self-review (authoring)

- **Spec coverage:** §2 card → Tasks 8–9; §3 tabs → Task 9; §4 integrity → Task 6; §5 persist → 3–4; §6 read model → 5; §7 frontend → 7–9; §8 conflicts[] → 1–2; §9 tests → each task; §10 not-changing → Global Constraints.
- **Concurrency:** resolved = reuse `updatedAt` (Task 6); no new rowversion.
- **Placeholder scan:** none intentional; shortLabel map and migration SQL are concrete.
- **Type consistency:** `CriticConflict` / `CriticReview` / `compactCriticReview` names stable across A/B.
- **Order:** Part A before Part B so UI can rely on `conflicts[]`.
