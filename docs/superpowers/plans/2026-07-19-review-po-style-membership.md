# Review PO membership + per-PO style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Review, operators confirm each PO belongs on the correct shipment (with free shipment search to re-home) and attach the correct item/style per PO—not via a shipment-level style bag.

**Architecture:** Add a `POs & styles` section to `ReviewCard` driven by live `linkedPOs`. Membership uses existing link/unlink PO APIs plus a new shipment free-text search endpoint. Style writes use `PATCH /purchase-orders/:id`. Suppress critic `itemStyleNo` bag rows when POs exist. Field conflict table keeps qty/UOM/SO/etc.

**Tech Stack:** NestJS presentation + purchase-orders, React/Vite, TanStack Query, Vitest, Testing Library.

**Design:** `docs/superpowers/specs/2026-07-19-review-po-style-membership-design.md`

## Global Constraints

- Do not change parser/enrichment algorithms (table-truth is separate).
- Do not rebuild full PurchaseOrdersCard CRUD inside Review (no delete-everywhere, no brand).
- Prefer live shipment/`linkedPOs` over critic System bag for PO style “Current”.
- Invalidate `shipment`, `review-queue`, `purchase-orders` after link/unlink/style updates.
- v1 Move = unlink current + link target; surface partial failure if link fails after unlink.
- No force-push; feature branch off main; PR for merge.

## File map

| File | Role |
|------|------|
| `backend/src/presentation/presentation.service.ts` (+ controller) | Shipment free-text search |
| `backend/src/presentation/*.spec.ts` | Search tests |
| `frontend/src/hooks/use-shipment-search.ts` | Debounced search query hook |
| `frontend/src/components/review/ShipmentSearchPicker.tsx` | Move-target UI |
| `frontend/src/components/review/ReviewPoStylesSection.tsx` | Section + rows |
| `frontend/src/components/review/ReviewPoStylesSection.test.tsx` | Component tests |
| `frontend/src/components/review/ReviewCard.tsx` | Mount section; filter bag conflicts |
| `frontend/src/components/review/ReviewCard.test.tsx` | Integration tests |
| `frontend/src/hooks/use-purchase-orders.ts` | Ensure invalidate review-queue on link/unlink/update |

---

### Task 1: Backend shipment free-text search

**Files:**
- Modify: `backend/src/shipments/shipments.controller.ts`
- Modify: `backend/src/presentation/presentation.service.ts` (or small new method on existing UI service)
- Test: `backend/src/presentation/presentation.service.spec.ts` (or new `shipment-search.spec.ts`)

**Interfaces:**
- Produces: `GET /api/shipments?q=<string>&limit=20` → `{ shipments: Array<{ id, bookingNo, soNumber, customerName, route, status, reviewStatus }> }`
- When `q` present and no strong match-keys, route to search (do not break existing `booking_no` / `so_no` lookup).

- [ ] **Step 1: Write failing unit test for search shaping**

```typescript
it('searchShipments matches booking substring and returns compact rows', async () => {
  // arrange legs with bookingNo SSL-318-2026 and SO-26-07-13401
  const res = await svc.searchShipments({ q: 'SSL-318', limit: 20 })
  expect(res.shipments.some((s) => s.bookingNo?.includes('SSL-318'))).toBe(true)
  expect(res.shipments[0]).toMatchObject({
    id: expect.any(String),
    bookingNo: expect.anything(),
  })
})
```

- [ ] **Step 2: Run test — expect FAIL (method missing)**

Run: `cd backend && npx vitest run src/presentation/presentation.service.spec.ts -t searchShipments`  
Expected: FAIL cannot find searchShipments / no matches

- [ ] **Step 3: Implement search**

Logic (minimal acceptable v1):
- Trim `q`; if empty return `{ shipments: [] }`.
- Query active legs with OR ilike/contains on bookingNo, soNo, hblAwbFcrNo, containerNo (use existing repo helpers if any; else Kysely `or` where).
- Also match PO numbers via join `shipment_pos` → `purchase_orders.po_number` when cheap.
- Cap `limit` default 20 max 50.
- Map to compact DTO (id, bookingNo, soNumber, customer name string, route, status, reviewStatus).

Controller routing in `index()`:

```typescript
if (present('q')) return this.ui.searchShipments({ q: q.q, limit: Number(q.limit) || 20 })
// existing strong-key + list filters unchanged
```

- [ ] **Step 4: Run tests — PASS**

Run: `cd backend && npx vitest run src/presentation/presentation.service.spec.ts src/shipments/shipments.controller.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add backend/src/presentation backend/src/shipments
git commit -m "feat(shipments): free-text search for review PO move target"
```

---

### Task 2: Frontend search hook + ShipmentSearchPicker

**Files:**
- Create: `frontend/src/hooks/use-shipment-search.ts`
- Create: `frontend/src/components/review/ShipmentSearchPicker.tsx`
- Create: `frontend/src/components/review/ShipmentSearchPicker.test.tsx`

**Interfaces:**
- Consumes: `GET /api/shipments?q=&limit=20`
- Produces: `useShipmentSearch(q: string)` → `{ data?: { shipments: SearchHit[] }, isFetching }`
- Produces: `<ShipmentSearchPicker excludeId={string} onSelect={(id, hit) => void} onCancel={() => void} />`

- [ ] **Step 1: Failing test — picker calls onSelect**

```tsx
it('lists results and selects a shipment', async () => {
  // mock useShipmentSearch to return one hit
  render(<ShipmentSearchPicker excludeId="ship-1" onSelect={onSelect} onCancel={vi.fn()} />)
  await user.type(screen.getByRole('searchbox'), 'SSL')
  await user.click(screen.getByRole('button', { name: /SSL-318/i }))
  expect(onSelect).toHaveBeenCalledWith('ship-2', expect.objectContaining({ bookingNo: 'SSL-318-2026' }))
})
```

- [ ] **Step 2: Run — FAIL missing component**

Run: `cd frontend && npm test -- --run src/components/review/ShipmentSearchPicker.test.tsx`

- [ ] **Step 3: Implement hook + picker**

```typescript
// use-shipment-search.ts
export type ShipmentSearchHit = {
  id: string
  bookingNo: string | null
  soNumber: string | null
  customerName: string | null
  route: string | null
  status: string
  reviewStatus?: string | null
}

export function useShipmentSearch(q: string) {
  const trimmed = q.trim()
  return useQuery({
    queryKey: ['shipment-search', trimmed],
    queryFn: () =>
      api.get<{ shipments: ShipmentSearchHit[] }>(
        `/shipments?q=${encodeURIComponent(trimmed)}&limit=20`,
      ),
    enabled: trimmed.length >= 2,
    placeholderData: (prev) => prev,
  })
}
```

Picker: debounced local input (300ms), filter out `excludeId`, show booking · customer · route, empty/loading states.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/use-shipment-search.ts frontend/src/components/review/ShipmentSearchPicker.tsx frontend/src/components/review/ShipmentSearchPicker.test.tsx
git commit -m "feat(review): shipment search picker for PO re-home"
```

---

### Task 3: ReviewPoStylesSection (membership + style)

**Files:**
- Create: `frontend/src/components/review/ReviewPoStylesSection.tsx`
- Create: `frontend/src/components/review/ReviewPoStylesSection.test.tsx`
- Modify: `frontend/src/hooks/use-purchase-orders.ts` — add `review-queue` invalidation on update/link/unlink success

**Interfaces:**
- Consumes: `linkedPOs: LinkedPO[]`, `shipmentId: string`, `readOnly?: boolean`, optional `reviewReasons: string[]` for proposed style hints
- Consumes: `useUpdatePurchaseOrder`, `useUnlinkShipmentFromPO`, `useLinkShipmentToPO`, `ShipmentSearchPicker`
- Produces: section UI only (no approve)

- [ ] **Step 1: Failing tests**

```tsx
it('renders each linked PO with current style', () => {
  render(
    <ReviewPoStylesSection
      shipmentId="ship-1"
      linkedPOs={[
        { id: 'po1', linkId: 'l1', poNumber: '6495962', itemStyleNo: '263121585', /* minimal LinkedPO */ },
      ]}
    />,
  )
  expect(screen.getByText('6495962')).toBeInTheDocument()
  expect(screen.getByText('263121585')).toBeInTheDocument()
})

it('Take proposed PATCHes itemStyleNo', async () => {
  // mock update mutate
  await user.click(screen.getByRole('button', { name: /take proposed/i }))
  expect(updateMutate).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'po1', itemStyleNo: 'NEW-STYLE' }),
    expect.anything(),
  )
})

it('Remove unlinks this shipment', async () => {
  await user.click(screen.getByRole('button', { name: /remove from this shipment/i }))
  expect(unlinkMutate).toHaveBeenCalledWith(
    { poId: 'po1', linkId: 'l1' },
    expect.anything(),
  )
})

it('Move: unlink then link to selected shipment', async () => {
  await user.click(screen.getByRole('button', { name: /move to another shipment/i }))
  // select ship-9 from mocked picker
  expect(unlinkMutate).toHaveBeenCalled()
  expect(linkMutate).toHaveBeenCalledWith(
    expect.objectContaining({ poId: 'po1', shipmentId: 'ship-9' }),
    expect.anything(),
  )
})
```

- [ ] **Step 2: Run — FAIL**

Run: `cd frontend && npm test -- --run src/components/review/ReviewPoStylesSection.test.tsx`

- [ ] **Step 3: Implement section**

Layout:
- Header `POs & styles` + short subtitle.
- Table or stacked rows: PO# | Current style | Proposed | actions.
- Edit: inline input + Save.
- Move: toggles inline `ShipmentSearchPicker` for that row; on select run:

```typescript
async function movePo(po: LinkedPO, targetId: string) {
  if (!po.linkId) { toast('Open full shipment to manage this PO link'); return }
  await unlink.mutateAsync({ poId: po.id, linkId: po.linkId })
  try {
    await link.mutateAsync({ poId: po.id, shipmentId: targetId })
    toast(`PO ${po.poNumber} moved`)
  } catch {
    toast(`PO ${po.poNumber} removed here but failed to link target — re-link from PO page`)
  }
}
```

Proposed style helper (v1):

```typescript
export function proposedStyleForPo(poNumber: string, reviewReasons: string[]): string | null {
  // Match: PO 6495962: item/style "X" vs "Y" (kept Z)
  const re = new RegExp(
    `PO\\s+${escapeRegExp(poNumber)}:.*?item\\/style[\\s\\S]*?\\(kept\\s+([^)]+)\\)`,
    'i',
  )
  for (const r of reviewReasons) {
    const m = r.match(re)
    if (m?.[1]) return m[1].trim().replace(/^"|"$/g, '')
  }
  return null
}
```

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/review/ReviewPoStylesSection.tsx frontend/src/components/review/ReviewPoStylesSection.test.tsx frontend/src/hooks/use-purchase-orders.ts
git commit -m "feat(review): POs & styles section with move and per-PO style"
```

---

### Task 4: Wire ReviewCard + suppress bag conflict

**Files:**
- Modify: `frontend/src/components/review/ReviewCard.tsx`
- Modify: `frontend/src/components/review/ReviewCard.test.tsx`
- Modify: `frontend/src/pages/ReviewQueuePage.tsx` only if Expanded panel must pass extra props (prefer reading `linkedPOs` from loaded shipment in ExpandedReviewPanel — already uses `useShipment`)

**Interfaces:**
- Consumes: `(shipment as ShipmentDetail).linkedPOs ?? []`, `shipment.reviewReasons`
- Produces: conflicts list filtered to drop `itemStyleNo` when `linkedPOs.length > 0`

- [ ] **Step 1: Failing tests**

```tsx
it('shows POs & styles section from linkedPOs', () => {
  render(
    <ReviewCard
      shipment={baseShipment({ linkedPOs: [{ id: 'po1', linkId: 'l1', poNumber: '1', itemStyleNo: 'A' }] } as any)}
      criticReview={baseReview()}
      defaultExpanded
    />,
  )
  expect(screen.getByText(/POs & styles/i)).toBeInTheDocument()
})

it('hides Item/Style bag conflict when linked POs exist', () => {
  const conflicts = [
    {
      field: 'item_style_no',
      label: 'Item / Style No.',
      candidates: [
        { value: 'A,B,C', source: 'System' },
        { value: 'A,B,C', source: 'SO' },
      ],
      rationale: 'x',
    },
    {
      field: 'qty',
      label: 'Total Quantity',
      candidates: [
        { value: '10', source: 'System' },
        { value: '20', source: 'SO' },
      ],
      rationale: 'y',
    },
  ]
  render(
    <ReviewCard
      shipment={detailWithPos}
      criticReview={baseReview({ conflicts })}
      defaultExpanded
    />,
  )
  expect(screen.queryByText('Item / Style No.')).toBeNull()
  expect(screen.getByText('Total Quantity')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

In `ReviewCard`:
- Resolve `linkedPOs` from shipment if present.
- `const fieldConflicts = useMemo(() => linkedPOs.length > 0 ? conflicts.filter(c => mapCriticFieldToColumn(c.field) !== 'itemStyleNo') : conflicts, ...)`
- Render `<ReviewPoStylesSection ... />` when expanded and (`linkedPOs.length > 0` || !readOnly) above conflict table.
- Pass `readOnly` through.

Ensure ExpandedReviewPanel’s `useShipment` detail includes `linkedPOs` (already on presentation DTO).

- [ ] **Step 4: Full related tests PASS**

Run:  
`cd frontend && npm test -- --run src/components/review/ReviewCard.test.tsx src/components/review/ReviewPoStylesSection.test.tsx src/components/review/ShipmentSearchPicker.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/review/ReviewCard.tsx frontend/src/components/review/ReviewCard.test.tsx
git commit -m "feat(review): wire PO styles section and drop bag style conflict"
```

---

### Task 5: Optional leg rollup after PO style patch

**Files:**
- Modify: `backend/src/purchase-orders/purchase-orders.service.ts`
- Test: `backend/src/purchase-orders/purchase-orders.service.spec.ts`

**Interfaces:**
- After successful `update` with `itemStyleNo` change, recompute union of linked legs’ PO styles into each linked leg’s `itemStyleNo` (or only legs linked to this PO).

- [ ] **Step 1: Test** — updating PO style refreshes leg bag to include new style / drop old if unique  
- [ ] **Step 2: Implement minimal recompute** (skip if time-boxed; note in PR as follow-up)  
- [ ] **Step 3: Commit** if done

```bash
git commit -m "fix(pos): refresh leg itemStyleNo rollup after PO style edit"
```

---

### Task 6: Manual QA checklist + PR

- [ ] **Step 1: Manual paths**

1. Open review with multi-PO shipment (e.g. styles aligned bag case).  
2. Confirm **POs & styles** shows one row per PO; **no** bag Item/Style decision row.  
3. Edit style on one PO → Order Details PO card shows new style.  
4. Remove PO from shipment → row gone; detail card updated.  
5. Move PO to another shipment via search → unlinked here, linked there.  
6. Approve/Keep Existing still works for field conflicts (qty/SO).  
7. Read-only approved view: section visible, no action buttons.

- [ ] **Step 2: PR**

Branch: `feat/review-po-style-membership`  
Title: `feat(review): PO membership and per-PO style in review`  
Body: link design spec; list test commands; note search endpoint.

---

## Spec coverage (self-check)

| Spec requirement | Task |
|------------------|------|
| POs & styles section in Review | 3, 4 |
| Job 1 membership remove | 3 |
| Job 1 free search move | 1, 2, 3 |
| Job 2 style keep/take/edit | 3 |
| Suppress bag Item/Style row | 4 |
| Qty/UOM/SO stay field table | 4 (unchanged) |
| APIs link/unlink/patch | 3 (reuse) |
| Search API | 1 |
| Tests | 1–4 |
| Leg rollup | 5 optional |

## Placeholder scan

No TBD steps; optional Task 5 explicitly skippable with PR note.

## Type consistency

- `ShipmentSearchHit.id` used as `link` `shipmentId`.
- `LinkedPO.id` = poId; `LinkedPO.linkId` = unlink path param.
- Critic field filter uses `mapCriticFieldToColumn(...) === 'itemStyleNo'`.
