# Review Decision Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Review a busy-ops decision desk: surface critical missing and contested Booking / SO# / CRD / ETD / ATD, explain empty desks, keep Edit available without field fights, soft-warn on Approve when blanks remain.

**Architecture:** Pure frontend on `ReviewCard` + small helpers. Detect critical missing from live shipment DTO (`liveShipmentValue` / EDITABLE_FIELDS uiKeys) and critical conflicts from `criticReview.conflicts` via `mapCriticFieldToColumn`. New **Critical for sailing** band + ready-state banner; page Edit always when critical/PO/conflicts; missing-only inputs while editing merge into `fieldsToApply` / save path.

**Tech Stack:** React, TypeScript, Vitest, Testing Library; existing `ReviewCard`, `review-fields.ts`, `toInputValue` for dates.

**Design:** `docs/superpowers/specs/2026-07-19-review-decision-desk-design.md`

## Global Constraints

- Decision desk only — do **not** clone full Order Details into Review.
- Critical columns (exact): `bookingNo`, `soNo`, `cargoReadyDate`, `etd`, `atd` (labels: Booking No., SO#, Cargo Ready Date, ETD, ATD).
- Critical **missing** = live empty; critical **conflict** = conflict maps to one of those columns (band bullet + row stays in conflict table).
- Style empty / brand verify are **not** critical; brand stays Needs attention.
- Soft gate on Approve when critical missing remain (warn, do not hard-disable).
- One page-level Edit / Done editing (already drives POs); no second Edit on critical band.
- YAGNI: no vessel/flight critical set; no hard-gate flag UI in v1.

## File map

| File | Role |
|------|------|
| `frontend/src/lib/review-critical.ts` | `CRITICAL_COLUMNS`, `criticalMissing`, `criticalConflicts`, types |
| `frontend/src/lib/review-critical.test.ts` | Unit tests for helpers |
| `frontend/src/components/review/CriticalSailingBand.tsx` | Band UI + missing inputs when editing |
| `frontend/src/components/review/CriticalSailingBand.test.tsx` | Component tests |
| `frontend/src/components/review/ReviewCard.tsx` | Mount band, ready state, Edit visibility, merge critical drafts into save |
| `frontend/src/components/review/ReviewCard.test.tsx` | Integration tests |

Reuse: `mapCriticFieldToColumn`, `fieldLabel`, `liveShipmentValue` (or uiKey reads), `toInputValue`, `EDITABLE_FIELDS`.

---

### Task 1: Critical field helpers

**Files:**
- Create: `frontend/src/lib/review-critical.ts`
- Create: `frontend/src/lib/review-critical.test.ts`

**Interfaces:**
- Produces:

```typescript
export const CRITICAL_COLUMNS = [
  'bookingNo',
  'soNo',
  'cargoReadyDate',
  'etd',
  'atd',
] as const
export type CriticalColumn = (typeof CRITICAL_COLUMNS)[number]

export type CriticalItem =
  | { kind: 'missing'; column: CriticalColumn; label: string }
  | {
      kind: 'conflict'
      column: CriticalColumn
      label: string
      field: string // critic conflict.field for scroll/key
      summary: string // short "system vs AI" line
    }

/** Live blank for critical columns (uses shipment detail / queue-shaped objects). */
export function criticalMissing(shipment: object | null | undefined): CriticalItem[]

/** Conflicts whose mapped column is critical. */
export function criticalConflicts(
  conflicts: Array<{ field: string; label?: string; candidates?: Array<{ value: string; source: string }> }>,
): CriticalItem[]

export function isCriticalColumn(column: string | null | undefined): boolean
```

- [ ] **Step 1: Write failing unit tests**

```typescript
// review-critical.test.ts
import { describe, it, expect } from 'vitest'
import {
  CRITICAL_COLUMNS,
  criticalMissing,
  criticalConflicts,
  isCriticalColumn,
} from './review-critical'

describe('criticalMissing', () => {
  it('flags each empty critical field', () => {
    const items = criticalMissing({
      bookingNo: null,
      soNumber: '',
      crd: null,
      etd: '2026-07-20',
      actualDeparture: null,
    })
    const cols = items.filter((i) => i.kind === 'missing').map((i) => i.column)
    expect(cols).toEqual(expect.arrayContaining(['bookingNo', 'soNo', 'cargoReadyDate', 'atd']))
    expect(cols).not.toContain('etd')
  })

  it('treats whitespace as missing', () => {
    expect(criticalMissing({ bookingNo: '  ' }).some((i) => i.column === 'bookingNo')).toBe(true)
  })

  it('returns empty when all critical present', () => {
    expect(
      criticalMissing({
        bookingNo: 'BK1',
        soNumber: 'SO1',
        crd: '2026-07-01',
        etd: '2026-07-10',
        actualDeparture: '2026-07-11',
      }),
    ).toEqual([])
  })
})

describe('criticalConflicts', () => {
  it('maps etd and booking_no conflicts', () => {
    const items = criticalConflicts([
      {
        field: 'etd',
        label: 'ETD',
        candidates: [
          { value: '2026-07-01', source: 'System' },
          { value: '2026-07-05', source: 'SO' },
        ],
      },
      {
        field: 'qty',
        label: 'Qty',
        candidates: [
          { value: '1', source: 'System' },
          { value: '2', source: 'SO' },
        ],
      },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'conflict', column: 'etd' })
    expect(items[0].kind === 'conflict' && items[0].summary).toMatch(/2026-07-01|2026-07-05/)
  })

  it('accepts so_no alias', () => {
    const items = criticalConflicts([
      { field: 'so_no', candidates: [{ value: 'A', source: 'System' }, { value: 'B', source: 'SO' }] },
    ])
    expect(items[0]?.column).toBe('soNo')
  })
})

describe('isCriticalColumn', () => {
  it('true only for the five', () => {
    for (const c of CRITICAL_COLUMNS) expect(isCriticalColumn(c)).toBe(true)
    expect(isCriticalColumn('qty')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd frontend && npm test -- --run src/lib/review-critical.test.ts`  
Expected: FAIL module not found / functions undefined

- [ ] **Step 3: Implement helpers**

Use `EDITABLE_FIELDS` for label + uiKey; read live via:

```typescript
import { EDITABLE_FIELDS, fieldLabel, mapCriticFieldToColumn } from './review-fields'
import { liveShipmentValue } from './review-fields' // if already exported for critic field; else read uiKey

// Prefer liveShipmentValue(shipment, column) when it accepts column/uiKey;
// else: for each CRITICAL_COLUMNS find meta.uiKey and LIVE_UI_KEY_ALIASES (soNumber/soNo, actualDeparture).
function liveCritical(shipment: object, column: CriticalColumn): string {
  // Return trimmed string; dates as YYYY-MM-DD via same logic as liveShipmentValue
}
```

`criticalMissing`: if `liveCritical` is `''` → push `{ kind: 'missing', column, label: fieldLabel(column) }`.

`criticalConflicts`: for each conflict, `col = mapCriticFieldToColumn(c.field)`; if `isCriticalColumn(col)`, build summary from first system candidate vs first non-system (or first two values):  
`"${existing || '—'} vs ${proposed || '—'}"`.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/review-critical.ts frontend/src/lib/review-critical.test.ts
git commit -m "feat(review): critical sailing field helpers (missing + conflict)"
```

---

### Task 2: CriticalSailingBand component

**Files:**
- Create: `frontend/src/components/review/CriticalSailingBand.tsx`
- Create: `frontend/src/components/review/CriticalSailingBand.test.tsx`

**Interfaces:**
- Consumes: `CriticalItem[]` from Task 1; `editing`, `drafts`, `onDraftChange`
- Produces:

```tsx
export function CriticalSailingBand({
  items,
  editing,
  drafts, // Record<CriticalColumn, string> for missing fields only
  onDraftChange,
}: {
  items: CriticalItem[]
  editing: boolean
  drafts: Partial<Record<CriticalColumn, string>>
  onDraftChange: (column: CriticalColumn, value: string) => void
}): JSX.Element | null
// null when items.length === 0
```

- [ ] **Step 1: Failing component tests**

```tsx
it('renders nothing when items empty', () => {
  const { container } = render(
    <CriticalSailingBand items={[]} editing={false} drafts={{}} onDraftChange={vi.fn()} />,
  )
  expect(container).toBeEmptyDOMElement()
})

it('lists missing and conflict rows', () => {
  render(
    <CriticalSailingBand
      items={[
        { kind: 'missing', column: 'crd' as const, label: 'Cargo Ready Date' },
        {
          kind: 'conflict',
          column: 'etd',
          label: 'ETD',
          field: 'etd',
          summary: '2026-07-01 vs 2026-07-05',
        },
      ]}
      editing={false}
      drafts={{}}
      onDraftChange={vi.fn()}
    />,
  )
  expect(screen.getByTestId('critical-sailing')).toBeInTheDocument()
  expect(screen.getByText(/Cargo Ready Date/i)).toBeInTheDocument()
  expect(screen.getByText(/not set/i)).toBeInTheDocument()
  expect(screen.getByText(/2026-07-01 vs 2026-07-05/)).toBeInTheDocument()
})

it('shows input for missing rows when editing', () => {
  render(
    <CriticalSailingBand
      items={[{ kind: 'missing', column: 'bookingNo', label: 'Booking No.' }]}
      editing
      drafts={{ bookingNo: '' }}
      onDraftChange={vi.fn()}
    />,
  )
  expect(screen.getByRole('textbox', { name: /booking no/i })).toBeInTheDocument()
})

it('does not show input for conflict rows (resolved in conflict table)', () => {
  render(
    <CriticalSailingBand
      items={[
        {
          kind: 'conflict',
          column: 'etd',
          label: 'ETD',
          field: 'etd',
          summary: 'a vs b',
        },
      ]}
      editing
      drafts={{}}
      onDraftChange={vi.fn()}
    />,
  )
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByText(/resolve in field conflicts/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run — FAIL**

Run: `cd frontend && npm test -- --run src/components/review/CriticalSailingBand.test.tsx`

- [ ] **Step 3: Implement band**

Chrome (match Needs attention weight):

```tsx
<div
  data-testid="critical-sailing"
  className="rounded-lg border border-status-warning/30 bg-status-warning/5 px-3 py-2"
>
  <p className="text-[11px] font-medium text-status-warning">
    Critical for sailing
    <span className="ml-1 font-normal text-text-muted">({items.length})</span>
  </p>
  <p className="mt-0.5 text-[10px] text-text-muted">
    Booking, SO, CRD, ETD, ATD — missing or contested
  </p>
  <ul className="mt-1.5 space-y-1.5">
    {/* each item: amber dot + label + body */}
  </ul>
</div>
```

Missing row body: if `editing` → date/text input (`type="date"` for cargoReadyDate/etd/atd using `toInputValue` seed); else “Not set”.  
Conflict row body: `summary` + muted “Resolve in field conflicts below”.

Use `fieldLabel` for accessible names.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/review/CriticalSailingBand.tsx frontend/src/components/review/CriticalSailingBand.test.tsx
git commit -m "feat(review): Critical for sailing band UI"
```

---

### Task 3: Wire band + ready state into ReviewCard

**Files:**
- Modify: `frontend/src/components/review/ReviewCard.tsx`
- Modify: `frontend/src/components/review/ReviewCard.test.tsx`

**Interfaces:**
- Consumes: `criticalMissing(shipment)`, `criticalConflicts(conflicts)`, `CriticalSailingBand`
- State: `criticalDrafts: Partial<Record<CriticalColumn, string>>`
- On enter edit: seed drafts from empty for each missing item
- On Done editing / Save&Approve: merge non-empty critical drafts into fields bag as column keys

- [ ] **Step 1: Failing ReviewCard tests**

```tsx
it('shows Critical for sailing when booking blank on detail shipment', () => {
  render(
    <MemoryRouter>
      <ReviewCard
        shipment={{ ...baseShipment(), bookingNo: null, soNumber: null /* detail-shaped */ } as any}
        criticReview={baseReview({ conflicts: [] })}
        defaultExpanded
        onApprove={vi.fn()}
      />
    </MemoryRouter>,
  )
  // may need shipment with linkedPOs empty and full detail keys
  expect(screen.getByTestId('critical-sailing')).toBeInTheDocument()
})

it('shows Edit when critical missing even with zero conflicts', async () => {
  // criticReview conflicts: []
  // shipment missing etd
  expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
})

it('shows ready banner when no needs-attention, no critical, no conflicts', () => {
  render(/* full booking/so/crd/etd/atd, empty conflicts, no review reasons that create needs attention */)
  expect(screen.getByTestId('review-ready-state')).toHaveTextContent(/ready to confirm|no open decisions/i)
})

it('soft-warns when approving with critical blanks still empty', async () => {
  // optional: assert warning text visible near actions when criticalMissing.length > 0
  expect(screen.getByTestId('critical-approve-soft-warn')).toBeInTheDocument()
})
```

Adapt fixtures to `baseShipment` + detail overrides used elsewhere in the file. For “ready” case, mock `buildNeedsAttentionGroups` empty by giving empty reasons and no multi-id flags.

- [ ] **Step 2: Run focused ReviewCard tests — FAIL**

- [ ] **Step 3: Wire ReviewCard**

Placement after Needs attention, before POs & styles:

```tsx
const missing = useMemo(() => criticalMissing(shipment), [shipment])
const critConflicts = useMemo(() => criticalConflicts(conflicts), [conflicts])
const criticalItems = useMemo(() => [...missing, ...critConflicts], [missing, critConflicts])

const [criticalDrafts, setCriticalDrafts] = useState<Partial<Record<CriticalColumn, string>>>({})

// When editing becomes true, seed '' for each missing column not already in drafts
// When building fieldsToApply (or a parallel bag), add:
//   for (const [col, v] of Object.entries(criticalDrafts)) {
//     if (v?.trim() && missing still includes col) fields[col] = v.trim()
//   }
```

**Edit button visibility** — change from `conflicts.length > 0` to:

```tsx
const showEdit =
  !readOnly &&
  (conflicts.length > 0 ||
    criticalItems.some((i) => i.kind === 'missing') ||
    linkedPOs.length > 0)
```

**Ready state** (when expanded, not read-only):

```tsx
const deskEmpty =
  needsAttentionGroups.length === 0 &&
  criticalItems.length === 0 &&
  conflicts.length === 0

{deskEmpty && (
  <div data-testid="review-ready-state" className="rounded-lg bg-surface-900/50 px-3 py-2 text-xs text-text-muted">
    Ready to confirm — no open decisions
  </div>
)}
```

When only needs-attention (no critical, no conflicts):

```tsx
{needsAttentionGroups.length > 0 && criticalItems.length === 0 && conflicts.length === 0 && (
  <p className="text-xs text-text-muted" data-testid="review-judgment-only">
    No field changes · confirm when verified
  </p>
)}
```

**Soft warn** near actions when `missing.length > 0` after considering drafts still empty:

```tsx
{!readOnly && remainingCriticalMissing > 0 && (
  <p data-testid="critical-approve-soft-warn" className="text-xs text-status-warning">
    {remainingCriticalMissing} critical blank{remainingCriticalMissing === 1 ? '' : 's'} remain — you can still confirm
  </p>
)}
```

Merge critical drafts into `fieldsToApply` useMemo (column keys `bookingNo`, `soNo`, `cargoReadyDate`, `etd`, `atd` as correct endpoint expects).

Date inputs: store ISO date strings `YYYY-MM-DD` in drafts; backend coerce accepts dates.

- [ ] **Step 4: Full related tests PASS**

Run:

```bash
cd frontend && npm test -- --run \
  src/lib/review-critical.test.ts \
  src/components/review/CriticalSailingBand.test.tsx \
  src/components/review/ReviewCard.test.tsx \
  src/components/review/ReviewPoStylesSection.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/review/ReviewCard.tsx frontend/src/components/review/ReviewCard.test.tsx
git commit -m "feat(review): wire decision desk critical band and ready state"
```

---

### Task 4: Conflict table — mark critical rows (light)

**Files:**
- Modify: `frontend/src/components/review/ConflictRow.tsx` (optional prop)
- Modify: `frontend/src/components/review/ReviewCard.tsx` (pass flag)
- Test: extend `ConflictRow` or ReviewCard test

**Interfaces:**
- `ConflictRow` accepts optional `critical?: boolean`
- When true, show small badge “Critical” next to field label (text-[10px] text-status-warning)

- [ ] **Step 1: Test** badge appears when critical  
- [ ] **Step 2: Implement** `critical={isCriticalColumn(mapCriticFieldToColumn(c.field))}`  
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(review): badge critical fields in conflict table"
```

---

### Task 5: Manual QA checklist + PR

- [ ] **Step 1: Manual paths**

1. Shipment with blank CRD/ETD, no conflicts → Critical band lists them; Edit shows date inputs; Done/Approve includes values.  
2. Conflict on `etd` only → Critical conflict bullet + table row + Critical badge.  
3. FA47771F-like (brand only, all five critical filled) → no Critical band; judgment-only line; Keep Existing.  
4. All clear → ready banner.  
5. Soft warn when approve with blanks.  
6. PO styles + page Edit still work together.

- [ ] **Step 2: PR**

Branch: `feat/review-decision-desk-ux` (already has design commit)  
Title: `feat(review): decision desk — critical booking/SO/CRD/ETD/ATD`  
Body: link design spec; list test commands.

---

## Spec coverage

| Spec § | Task |
|--------|------|
| Critical set of 5 | 1 |
| Missing detection | 1 |
| Conflict detection + band bullet | 1, 2 |
| Conflict remains in table | 3, 4 |
| Critical band UX + edit inputs for missing | 2, 3 |
| Edit without conflicts | 3 |
| Ready / judgment-only copy | 3 |
| Soft approve warn | 3 |
| Merge blanks into save | 3 |
| No Order Details clone | Global |
| Tests | 1–4 |
| Manual QA | 5 |

## Placeholder scan

None intentional. Soft-gate only (no hard-gate UI).

## Type consistency

- `CriticalColumn` = `'bookingNo' | 'soNo' | 'cargoReadyDate' | 'etd' | 'atd'`
- Draft keys match correct/PATCH columns (`soNo` not `soNumber`)
- `field` on conflict items = critic `conflict.field` for identity only
