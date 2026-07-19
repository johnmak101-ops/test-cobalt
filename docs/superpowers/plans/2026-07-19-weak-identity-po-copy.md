# Weak identity PO-honest copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `WEAK_IDENTITY` fires and the shipment has at least one linked PO, Needs attention says “Only PO known — add booking, SO, or B/L to place this email” instead of falsely claiming “or PO — cannot place.”

**Architecture:** Pure frontend. Add optional `hasPo` to `buildNeedsAttention` / groups; export `weakIdentityText(hasPo)`; normalize any `lineId === 'r-no-id'` line with that helper. ReviewCard and ShipmentDetailPage pass `hasPo` from non-empty `linkedPOs` / detail PO list.

**Tech Stack:** TypeScript, React, Vitest, Testing Library.

**Design:** `docs/superpowers/specs/2026-07-19-weak-identity-po-copy-design.md`

## Global Constraints

- Frontend only — do **not** change critic flag emission or committer.
- Exact copy:
  - hasPo: `Only PO known — add booking, SO, or B/L to place this email`
  - !hasPo: `No booking, SO, B/L, or PO — cannot place this email`
- lineId stays `r-no-id`; category `no_identity`; no “strong” jargon.
- Default `hasPo` omitted → false (no-PO copy).
- Do not invent PO from flag message when linkedPOs empty.
- `PO_ONLY_WEAK_MATCH` copy unchanged.
- Identify section behavior unchanged.

## File map

| File | Role |
|------|------|
| `frontend/src/components/review/needs-attention.ts` | `weakIdentityText`, `hasPo` opt, rewrite `r-no-id` |
| `frontend/src/components/review/needs-attention.test.ts` | Unit tests |
| `frontend/src/components/review/ReviewCard.tsx` | Pass `hasPo` from `linkedPOs` |
| `frontend/src/pages/ShipmentDetailPage.tsx` | Pass `hasPo` from shipment POs |
| `frontend/src/components/review/ReviewCard.test.tsx` | Fix/assert copy when PO present |

---

### Task 1: weakIdentityText + hasPo in buildNeedsAttention

**Files:**
- Modify: `frontend/src/components/review/needs-attention.ts`
- Modify: `frontend/src/components/review/needs-attention.test.ts`

**Interfaces:**
- Produces:

```typescript
export function weakIdentityText(hasPo: boolean): string
// true  → 'Only PO known — add booking, SO, or B/L to place this email'
// false → 'No booking, SO, B/L, or PO — cannot place this email'

// buildNeedsAttention / buildNeedsAttentionGroups opts:
hasPo?: boolean  // default false
```

- Consumes: existing `lineFromFlag` `WEAK_IDENTITY` → `r-no-id`; reason path that returns `r-no-id`.

- [ ] **Step 1: Write failing tests**

In `needs-attention.test.ts`, update the existing weak-identity test and add hasPo cases:

```typescript
import {
  buildNeedsAttention,
  weakIdentityText,
  // existing
} from './needs-attention'

describe('weakIdentityText', () => {
  it('splits by PO presence', () => {
    expect(weakIdentityText(true)).toBe(
      'Only PO known — add booking, SO, or B/L to place this email',
    )
    expect(weakIdentityText(false)).toBe(
      'No booking, SO, B/L, or PO — cannot place this email',
    )
  })
})

describe('buildNeedsAttention WEAK_IDENTITY hasPo', () => {
  it('uses only-PO copy when hasPo true', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      hasPo: true,
      riskFlags: [
        {
          code: 'WEAK_IDENTITY',
          severity: 'medium',
          message: 'No strong booking/SO/B/L identity',
        },
      ],
      reviewReasons: [],
    })
    expect(items[0]!.lineId).toBe('r-no-id')
    expect(items[0]!.text).toBe(
      'Only PO known — add booking, SO, or B/L to place this email',
    )
    expect(items[0]!.text).not.toMatch(/or PO|cannot place/i)
  })

  it('keeps no-PO copy when hasPo false or omitted', () => {
    const flag = {
      code: 'WEAK_IDENTITY',
      severity: 'medium' as const,
      message: 'No strong booking/SO/B/L identity and no PO',
    }
    for (const opts of [{ hasPo: false }, {}]) {
      const items = buildNeedsAttention({
        conflictsCount: 0,
        ...opts,
        riskFlags: [flag],
        reviewReasons: [],
      })
      expect(items[0]!.text).toBe(
        'No booking, SO, B/L, or PO — cannot place this email',
      )
    }
  })

  it('rewrites reason-path r-no-id when hasPo', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      hasPo: true,
      riskFlags: [],
      reviewReasons: ['neither a strong identity key nor a PO'],
    })
    // If reason still maps to r-no-id, text must honor hasPo (PO known on card wins over stale reason text)
    const hit = items.find((i) => i.lineId === 'r-no-id')
    if (hit) {
      expect(hit.text).toBe(
        'Only PO known — add booking, SO, or B/L to place this email',
      )
    }
  })
})
```

Update the old test `no strong ID jargon — weak identity uses booking/SO/B/L/PO` to assert `weakIdentityText(false)` / no-PO line when hasPo omitted.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd frontend
npx vitest run src/components/review/needs-attention.test.ts
```

Expected: `weakIdentityText` not exported / hasPo ignored.

- [ ] **Step 3: Implement**

In `needs-attention.ts`:

```typescript
export function weakIdentityText(hasPo: boolean): string {
  return hasPo
    ? 'Only PO known — add booking, SO, or B/L to place this email'
    : 'No booking, SO, B/L, or PO — cannot place this email'
}
```

1. Add `hasPo?: boolean` to `buildNeedsAttention` and `buildNeedsAttentionGroups` opts.
2. After each `lineFromFlag` / `lineFromReason` hit is obtained (before `pushUnique`), if `hit.lineId === 'r-no-id'`:

```typescript
const text = hit.lineId === 'r-no-id' ? weakIdentityText(!!opts.hasPo) : hit.text
// push with text
```

3. Optionally point `WEAK_IDENTITY` case in `lineFromFlag` at `weakIdentityText(false)` as default so single source of truth for the no-PO string (hasPo still applied at build time).

Do **not** change `PO_ONLY_WEAK_MATCH` branch.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd frontend
npx vitest run src/components/review/needs-attention.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/review/needs-attention.ts frontend/src/components/review/needs-attention.test.ts
git commit -m "fix(review): honest weak-identity copy when PO is known"
```

---

### Task 2: Wire hasPo from ReviewCard and ShipmentDetailPage

**Files:**
- Modify: `frontend/src/components/review/ReviewCard.tsx`
- Modify: `frontend/src/pages/ShipmentDetailPage.tsx`
- Modify: `frontend/src/components/review/ReviewCard.test.tsx` (as needed)

**Interfaces:**
- Consumes: `buildNeedsAttentionGroups({ hasPo, ... })`, `linkedPOs` on card, shipment detail PO list.
- Produces: callers pass `hasPo: boolean`.

- [ ] **Step 1: Failing / updated ReviewCard test**

If a test renders `WEAK_IDENTITY` with `linkedPOs` non-empty, expect only-PO copy. Example:

```typescript
// When shipment has linkedPOs + WEAK_IDENTITY, Needs attention shows only-PO line
expect(within(why).getByText(/Only PO known — add booking, SO, or B\/L/)).toBeInTheDocument()
expect(within(why).queryByText(/or PO — cannot place/)).not.toBeInTheDocument()
```

Keep a case without POs that still shows no-PO copy if one exists.

- [ ] **Step 2: Wire ReviewCard**

Where `buildNeedsAttentionGroups` is called:

```typescript
const hasPo = linkedPOs.some((p) => String(p.poNumber ?? '').trim().length > 0)

buildNeedsAttentionGroups({
  riskFlags: criticReview?.riskFlags,
  reviewReasons,
  conflictsCount: conflicts.length,
  portsLinked: portsLinkedFromRoute((shipment as { route?: string | null }).route),
  hasPo,
})
```

Include `linkedPOs` / `hasPo` in the `useMemo` dependency list.

- [ ] **Step 3: Wire ShipmentDetailPage**

Same pattern from `shipment.linkedPOs` (or the field already used for PO display on detail). If only `polRaw`-style fields exist and linkedPOs is the array, use it:

```typescript
const hasPo = (shipment.linkedPOs ?? []).some(
  (p) => String(p.poNumber ?? '').trim().length > 0,
)
buildNeedsAttentionGroups({
  // existing fields...
  hasPo,
})
```

If the detail type uses a different PO shape, match existing property names on that page (grep `linkedPOs` / `poNumber` in the file).

- [ ] **Step 4: Run tests**

```bash
cd frontend
npx vitest run src/components/review/needs-attention.test.ts src/components/review/ReviewCard.test.tsx
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/review/ReviewCard.tsx \
  frontend/src/pages/ShipmentDetailPage.tsx \
  frontend/src/components/review/ReviewCard.test.tsx
git commit -m "fix(review): pass hasPo into Needs attention for weak identity"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Only-PO vs no-PO exact copy | Task 1 `weakIdentityText` |
| hasPo from linkedPOs | Task 2 |
| Default hasPo false | Task 1 |
| lineId r-no-id, no backend change | Task 1 constraints |
| PO_ONLY_WEAK_MATCH unchanged | Task 1 step 3 |
| Detail page same humanizer | Task 2 ShipmentDetailPage |

No placeholders. Types consistent.
