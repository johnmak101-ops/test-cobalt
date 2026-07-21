# Qty Live-Leg Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the review decision table, treat live leg qty as Current and hide the qty conflict row when the shipment already holds the correct total (no fake 5-vs-16 choose / re-sum).

**Architecture:** Pure helpers in `frontend/src/lib/qty-conflict-settle.ts` decide settle (S1–S3). `ReviewCard` filters conflicts before seed/count/render. Qty Current cell prefers live `quantityShipped` over critic `source: system` when the row still shows. Presentation-only; no backend write on settle.

**Tech Stack:** TypeScript, React, Vitest, existing `CriticConflict` / `mapCriticFieldToColumn` / ReviewCard.

**Spec:** `docs/superpowers/specs/2026-07-21-qty-live-leg-truth-design.md`

## Global Constraints

- Qty-only (do not change style or vendor proposal logic)
- Set1-safe: no auto-PATCH of qty on settle
- Reuse `mapCriticFieldToColumn` for qty detection
- PO strip total: match product truth — `sharedBroadcastTotal` if set, else sum of linked PO `quantity` when every PO has a finite quantity; else null
- Hide settled qty (no quiet “already N” row in v1)
- Branch: implement on current feature branch (`fix/order-details-codes-only` or follow-up branch from main)

---

## File Structure

| File | Responsibility |
|------|----------------|
| Create: `frontend/src/lib/qty-conflict-settle.ts` | `normalizeQty`, `isQtyConflict`, `liveQtyFromShipment`, `poShipmentTotalFromLinked`, `isQtySettled`, `filterActionableConflicts`, `existingQtyDisplay` |
| Create: `frontend/src/lib/qty-conflict-settle.test.ts` | Unit matrix for S1/S2/S3 and show cases |
| Modify: `frontend/src/components/review/ReviewCard.tsx` | Filter conflicts; pass live qty into Current for qty rows; `conflictsCount` uses filtered list |
| Modify: `frontend/src/components/review/ConflictRow.tsx` | Optional: accept `existingOverride` for Current cell (or inject override only from ReviewCard by rewriting candidate — prefer override prop) |
| Modify: `frontend/src/components/review/ReviewCard.test.tsx` | GZL-class hide + Approve count; real fight still shows |

---

### Task 1: Pure settle helpers + unit tests (TDD)

**Files:**
- Create: `frontend/src/lib/qty-conflict-settle.ts`
- Create: `frontend/src/lib/qty-conflict-settle.test.ts`

**Interfaces:**
- Consumes: `CriticConflict` from `./critic-review`; `mapCriticFieldToColumn` from `./review-fields`; `LinkedPO` type (import type from hooks or a minimal local shape `{ quantity, totalQuantity, sharedBroadcastTotal }`)
- Produces:

```ts
export function normalizeQty(raw: unknown): number | null
export function isQtyConflict(c: CriticConflict): boolean
export function liveQtyFromShipment(shipment: { quantityShipped?: number | null }): number | null
export function poShipmentTotalFromLinked(
  linkedPOs: Array<{
    quantity?: number | null
    totalQuantity?: number | null
    sharedBroadcastTotal?: number | null
  }>,
): number | null
export function isQtySettled(
  conflict: CriticConflict,
  opts: { liveQty: number | null; poShipmentTotal: number | null },
): boolean
export function filterActionableConflicts(
  conflicts: CriticConflict[],
  opts: { liveQty: number | null; poShipmentTotal: number | null },
): CriticConflict[]
/** Value string for Current cell when live present; else null → caller uses critic system. */
export function existingQtyDisplay(
  conflict: CriticConflict,
  liveQty: number | null,
): string | null
```

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/qty-conflict-settle.test.ts
import { describe, it, expect } from 'vitest'
import type { CriticConflict } from './critic-review'
import {
  normalizeQty,
  isQtyConflict,
  isQtySettled,
  filterActionableConflicts,
  poShipmentTotalFromLinked,
  existingQtyDisplay,
} from './qty-conflict-settle'

function qtyConflict(
  candidates: { value: string; source: string }[],
): CriticConflict {
  return {
    field: 'qty',
    label: 'Total Quantity',
    candidates,
    rationale: 'test',
  }
}

describe('normalizeQty', () => {
  it('parses integers and strings', () => {
    expect(normalizeQty(16)).toBe(16)
    expect(normalizeQty('16')).toBe(16)
    expect(normalizeQty(' 16 cartons ')).toBe(16) // leading number
    expect(normalizeQty(null)).toBeNull()
    expect(normalizeQty('')).toBeNull()
  })
})

describe('isQtySettled', () => {
  it('S1: live equals non-system candidate', () => {
    const c = qtyConflict([
      { value: '5', source: 'system' },
      { value: '16', source: 'Final B/L' },
    ])
    expect(isQtySettled(c, { liveQty: 16, poShipmentTotal: null })).toBe(true)
  })

  it('S2: live equals PO shipment total when non-system only stale', () => {
    const c = qtyConflict([
      { value: '5', source: 'system' },
      { value: '5', source: 'Booking Request' },
    ])
    expect(isQtySettled(c, { liveQty: 16, poShipmentTotal: 16 })).toBe(true)
  })

  it('S3: all candidates equal live', () => {
    const c = qtyConflict([
      { value: '16', source: 'system' },
      { value: '16', source: 'SO' },
    ])
    expect(isQtySettled(c, { liveQty: 16, poShipmentTotal: null })).toBe(true)
  })

  it('shows when live differs from non-system and PO total', () => {
    const c = qtyConflict([
      { value: '5', source: 'system' },
      { value: '100', source: 'SO' },
    ])
    expect(isQtySettled(c, { liveQty: 16, poShipmentTotal: 100 })).toBe(false)
  })

  it('shows when liveQty null', () => {
    const c = qtyConflict([
      { value: '5', source: 'system' },
      { value: '16', source: 'SO' },
    ])
    expect(isQtySettled(c, { liveQty: null, poShipmentTotal: 16 })).toBe(false)
  })
})

describe('poShipmentTotalFromLinked', () => {
  it('prefers sharedBroadcastTotal', () => {
    expect(
      poShipmentTotalFromLinked([
        { quantity: 1, sharedBroadcastTotal: 16 },
        { quantity: 2, sharedBroadcastTotal: 16 },
      ]),
    ).toBe(16)
  })

  it('sums quantity when every PO has a number and no broadcast', () => {
    expect(
      poShipmentTotalFromLinked([
        { quantity: 10, totalQuantity: null },
        { quantity: 6, totalQuantity: null },
      ]),
    ).toBe(16)
  })

  it('null when a PO qty missing', () => {
    expect(
      poShipmentTotalFromLinked([
        { quantity: 10 },
        { quantity: null, totalQuantity: null },
      ]),
    ).toBeNull()
  })
})

describe('filterActionableConflicts', () => {
  it('drops settled qty, keeps other fields', () => {
    const conflicts: CriticConflict[] = [
      qtyConflict([
        { value: '5', source: 'system' },
        { value: '16', source: 'Final B/L' },
      ]),
      {
        field: 'vendor_code',
        label: 'Vendor',
        candidates: [
          { value: '', source: 'system' },
          { value: 'MACAU', source: 'SO' },
        ],
        rationale: 'x',
      },
    ]
    const out = filterActionableConflicts(conflicts, {
      liveQty: 16,
      poShipmentTotal: 16,
    })
    expect(out.map((c) => c.field)).toEqual(['vendor_code'])
  })
})

describe('existingQtyDisplay', () => {
  it('returns live string when live present', () => {
    const c = qtyConflict([{ value: '5', source: 'system' }])
    expect(existingQtyDisplay(c, 16)).toBe('16')
  })

  it('returns null when no live (caller uses system)', () => {
    const c = qtyConflict([{ value: '5', source: 'system' }])
    expect(existingQtyDisplay(c, null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd D:\cobalt_track_system\frontend
pnpm exec vitest run src/lib/qty-conflict-settle.test.ts
```

Expected: FAIL module not found / functions not defined.

- [ ] **Step 3: Implement helpers**

```ts
// frontend/src/lib/qty-conflict-settle.ts
import type { CriticConflict } from './critic-review'
import { mapCriticFieldToColumn } from './review-fields'

export function normalizeQty(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const s = String(raw).trim()
  const m = s.match(/^(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function isQtyConflict(c: CriticConflict): boolean {
  return mapCriticFieldToColumn(c.field) === 'qty'
}

export function liveQtyFromShipment(shipment: {
  quantityShipped?: number | null
}): number | null {
  return normalizeQty(shipment.quantityShipped)
}

export function poShipmentTotalFromLinked(
  linkedPOs: Array<{
    quantity?: number | null
    totalQuantity?: number | null
    sharedBroadcastTotal?: number | null
  }>,
): number | null {
  if (!linkedPOs.length) return null
  const b = linkedPOs[0]?.sharedBroadcastTotal
  const bn = normalizeQty(b)
  if (bn != null) return bn
  let sum = 0
  for (const p of linkedPOs) {
    const q = normalizeQty(p.quantity ?? p.totalQuantity)
    if (q == null) return null
    sum += q
  }
  return sum
}

function nonSystemValues(c: CriticConflict): number[] {
  return c.candidates
    .filter((x) => x.source.trim().toLowerCase() !== 'system')
    .map((x) => normalizeQty(x.value))
    .filter((n): n is number => n != null)
}

function allCandidateValues(c: CriticConflict): number[] {
  return c.candidates
    .map((x) => normalizeQty(x.value))
    .filter((n): n is number => n != null)
}

export function isQtySettled(
  conflict: CriticConflict,
  opts: { liveQty: number | null; poShipmentTotal: number | null },
): boolean {
  if (!isQtyConflict(conflict)) return false
  const { liveQty, poShipmentTotal } = opts
  if (liveQty == null) return false
  const nonSys = nonSystemValues(conflict)
  // S1
  if (nonSys.some((n) => n === liveQty)) return true
  // S3
  const all = allCandidateValues(conflict)
  if (all.length > 0 && all.every((n) => n === liveQty)) return true
  // S2
  if (poShipmentTotal != null && poShipmentTotal === liveQty) return true
  return false
}

export function filterActionableConflicts(
  conflicts: CriticConflict[],
  opts: { liveQty: number | null; poShipmentTotal: number | null },
): CriticConflict[] {
  return conflicts.filter((c) => {
    if (!isQtyConflict(c)) return true
    return !isQtySettled(c, opts)
  })
}

export function existingQtyDisplay(
  conflict: CriticConflict,
  liveQty: number | null,
): string | null {
  if (!isQtyConflict(conflict)) return null
  if (liveQty == null) return null
  return String(liveQty)
}
```

Notes for implementer:

- If `normalizeQty('16 cartons')` leading-number behavior is too aggressive for your taste, narrow to pure numeric strings only — but keep tests in sync.
- `S2` alone (live === po total) settles even when non-system is only `5` — matches spec example.

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm exec vitest run src/lib/qty-conflict-settle.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/qty-conflict-settle.ts frontend/src/lib/qty-conflict-settle.test.ts
git commit -m "feat(review): qty conflict settle helpers (live-leg truth)"
```

---

### Task 2: Wire ReviewCard filter + live Current for qty

**Files:**
- Modify: `frontend/src/components/review/ReviewCard.tsx`
- Modify: `frontend/src/components/review/ConflictRow.tsx` (add optional `existingOverride?: string | null`)

**Interfaces:**
- Consumes: `filterActionableConflicts`, `liveQtyFromShipment`, `poShipmentTotalFromLinked`, `existingQtyDisplay`, `isQtyConflict` from `../../lib/qty-conflict-settle`
- Produces: `conflicts` memo already used for table / resolutions / needsAttention `conflictsCount` is the **filtered** list

- [ ] **Step 1: Add `existingOverride` to ConflictRow**

In `ConflictRowProps`:

```ts
  /** When set, Current column shows this instead of critic system candidate (qty live-leg). */
  existingOverride?: string | null
```

In the Existing cell render path (non-styles branch), prefer override:

```ts
  const existingDisplay =
    existingOverride != null && existingOverride !== ''
      ? existingOverride
      : existing?.value ?? ''
  // render existingDisplay; still show (system) only when override is null
  // when override set, show (leg) or omit secondary label — use (on shipment) microcopy
```

Suggested microcopy when override is used: `(on shipment)` instead of `(system)`.

- [ ] **Step 2: Filter conflicts in ReviewCard**

Replace the conflicts useMemo to chain existing hides + qty settle:

```ts
  const liveQty = useMemo(
    () => liveQtyFromShipment(shipment as { quantityShipped?: number | null }),
    [shipment],
  )
  const poShipmentTotal = useMemo(
    () => poShipmentTotalFromLinked(linkedPOs),
    [linkedPOs],
  )

  const conflicts = useMemo(() => {
    const base = rawConflicts.filter((c) => {
      const col = mapCriticFieldToColumn(c.field) ?? c.field
      return col !== 'itemStyleNo' && col !== 'grossWeight' && col !== 'htsCode'
    })
    return filterActionableConflicts(base, { liveQty, poShipmentTotal })
  }, [rawConflicts, liveQty, poShipmentTotal])
```

Ensure `linkedPOs` is defined **before** this memo (already is).

`initialResolutions(conflicts)` / `conflictKey` already depend on `conflicts` — re-seed will exclude settled qty automatically.

Pass into ConflictRow when mapping rows:

```ts
existingOverride={
  isQtyConflict(c) ? existingQtyDisplay(c, liveQty) : null
}
```

- [ ] **Step 3: needsAttention conflictsCount**

Keep using `conflicts.length` (now filtered). That reduces “N field(s)” on the card when qty was the only drop — good enough for v1 minimum.

- [ ] **Step 4: Manual typecheck**

```bash
cd D:\cobalt_track_system\frontend
pnpm exec tsc --noEmit
```

Expected: no new errors in touched files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/review/ReviewCard.tsx frontend/src/components/review/ConflictRow.tsx
git commit -m "feat(review): hide settled qty conflicts; Current from live leg"
```

---

### Task 3: ReviewCard integration tests

**Files:**
- Modify: `frontend/src/components/review/ReviewCard.test.tsx`

**Interfaces:**
- Consumes: existing `baseShipment`, `baseReview`, `ReviewCard` harness
- Produces: two new tests (GZL settle + real fight)

- [ ] **Step 1: Write failing tests**

```ts
  it('hides qty conflict when live leg already matches AI proposed (GZL-class)', () => {
    const shipment = baseShipment({
      quantityShipped: 16,
      quantityUnit: 'cartons',
      linkedPOs: [
        {
          id: 'po1',
          linkId: 'l1',
          poNumber: '28739',
          quantity: 10,
          totalQuantity: null,
          quantityUnit: 'cartons',
          itemStyleNo: 'RED STRIPE',
        },
        {
          id: 'po2',
          linkId: 'l2',
          poNumber: '28740',
          quantity: 6,
          totalQuantity: null,
          quantityUnit: 'cartons',
          itemStyleNo: 'X',
        },
      ],
    } as never)
    const conflictQty = {
      field: 'qty',
      label: 'Total Quantity',
      candidates: [
        { value: '5', source: 'system' },
        { value: '16', source: 'Final B/L' },
      ],
      rationale: 'stale system vs email',
    }
    const conflictVendor = {
      field: 'vendor_code',
      label: 'Vendor',
      candidates: [
        { value: '', source: 'system' },
        { value: 'MACAU FUNG TAI LIMITED', source: 'SO' },
      ],
      rationale: 'vendor',
    }
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={shipment}
          criticReview={baseReview({ conflicts: [conflictQty, conflictVendor] })}
          compact={null}
          defaultExpanded
          onSaveAndApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    const grid = screen.getByTestId('review-decision-grid')
    expect(within(grid).queryByText('Total Quantity')).toBeNull()
    expect(within(grid).getByText('Vendor')).toBeInTheDocument()
    // Approve should not claim qty change — only vendor (1) if seeded as change
    expect(screen.queryByRole('button', { name: /approve 2 changes/i })).toBeNull()
  })

  it('still shows qty when live differs from all non-system candidates', () => {
    const shipment = baseShipment({
      quantityShipped: 16,
      quantityUnit: 'cartons',
      linkedPOs: [],
    } as never)
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={shipment}
          criticReview={baseReview({
            conflicts: [
              {
                field: 'qty',
                label: 'Total Quantity',
                candidates: [
                  { value: '5', source: 'system' },
                  { value: '100', source: 'SO' },
                ],
                rationale: 'real fight',
              },
            ],
          })}
          compact={null}
          defaultExpanded
        />
      </MemoryRouter>,
    )
    const grid = screen.getByTestId('review-decision-grid')
    expect(within(grid).getByText('Total Quantity')).toBeInTheDocument()
    // Current shows live 16
    expect(within(grid).getByText('16')).toBeInTheDocument()
  })
```

Adapt `baseShipment` typing if `quantityShipped` is only on detail shape — cast as existing tests do with `as never` / partial.

- [ ] **Step 2: Run tests**

```bash
pnpm exec vitest run src/components/review/ReviewCard.test.tsx
```

Expected: new tests pass (or fix Approve button name assertions to match actual button copy).

- [ ] **Step 3: Fix any button-label mismatch**

If Approve shows “Approve 1 change” only when vendor resolution ≠ existing, assert that. Do not overfit to exact English if locale differs — use `/approve/i` and ensure qty not double-counted.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/review/ReviewCard.test.tsx
git commit -m "test(review): qty live-leg settle on decision table"
```

---

### Task 4: Flag copy when qty-only backend message (light)

**Files:**
- Modify: `frontend/src/lib/review-reasons.ts` — already has `prettifyVisibleFields`; optionally strip `qty` when caller passes a flag — **YAGNI if Task 2 conflictsCount is enough**
- Prefer: only if GZL still shows “differ on Qty” from riskFlags while table has no qty row

**Minimum for this task:**

- [ ] **Step 1: Reproduce with ReviewCard needs-attention**

When `conflicts` empty of qty but riskFlags still say `stored on Qty, …`, operator still sees Qty in Needs attention.

If product wants that cleaned in v1, strip qty tokens from `fieldsFromBackendMsg` only when **all** qty conflicts were settled — that requires passing `settledQty: boolean` into `buildNeedsAttention`.

**v1 decision (spec minimum):** table + Approve honest first. Optional enhancement:

```ts
// In ReviewCard needsAttentionGroups:
buildNeedsAttentionGroups({
  ...
  conflictsCount: conflicts.length, // filtered
  // leave riskFlags as-is unless tests fail UX
})
```

- [ ] **Step 2: If Needs attention still lists Qty for GZL-class, add optional filter**

In `needs-attention.ts` `fieldsFromBackendMsg` / BACKEND_CONFLICT path: do not remove qty globally.

Instead in ReviewCard only, after settle, if no qty in `conflicts`, map riskFlags messages:

```ts
function stripQtyFromBackendMsg(msg: string): string {
  // remove qty / Total Quantity tokens from "stored on X, Y" lists; if empty fields → generic differ message
}
```

Only implement if a ReviewCard test proves the bad line still appears with filtered conflicts.

- [ ] **Step 3: Commit if changed**

```bash
git commit -m "fix(review): drop Qty from Needs attention when qty conflict settled"
```

---

### Task 5: Verification gate

- [ ] **Step 1: Run full frontend unit suite for review surface**

```bash
cd D:\cobalt_track_system\frontend
pnpm exec vitest run src/lib/qty-conflict-settle.test.ts src/components/review/ReviewCard.test.tsx src/components/review/ConflictRow.test.tsx
```

Expected: all pass.

- [ ] **Step 2: Manual check (if ShipTrack running)**

Open GZL26261147 review:

- No Total Quantity row when leg shows 16 and AI had 16
- Approve N does not include qty
- Vendor / PO styles still visible if still contested

- [ ] **Step 3: Final commit if any fixups**

```bash
git status
# commit only intentional files
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Live leg as Current | Task 2 `existingOverride` |
| S1 settle | Task 1 `isQtySettled` |
| S2 settle | Task 1 `poShipmentTotalFromLinked` + S2 |
| S3 settle | Task 1 |
| Hide row | Task 2 filter |
| Not in Approve N | Task 2 + 3 (resolutions from filtered) |
| Show real fights | Task 1 + 3 |
| Qty-only / no queue | All tasks FE-only |
| Needs attention minimum | Task 2 count; Task 4 optional |

## Placeholder scan

None intentional. Task 4 is explicitly optional gated on residual UX.

## Type consistency

- `filterActionableConflicts` / `isQtySettled` opts: `{ liveQty: number | null; poShipmentTotal: number | null }`
- `existingQtyDisplay(conflict, liveQty)` → `string | null`
- `mapCriticFieldToColumn(...) === 'qty'` for detection

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-21-qty-live-leg-truth-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, task-by-task with checkpoints  

**Which approach?**
