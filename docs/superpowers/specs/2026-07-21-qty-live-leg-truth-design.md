# Design: Qty live-leg truth on review decision table

**Date:** 2026-07-21  
**Repo:** cobalt-shiptrack (frontend review desk; no cobalt-queue change in v1)  
**Status:** Approved for planning  
**Scope:** Qty-only (Approach A / implementation approach 1)

## Problem

On legs such as GZL26261147 the operator already sees:

| Surface | Qty |
|--------|-----|
| Order Details | **16** cartons (live leg) |
| Customer PO strip | shipment total **16** cartons |
| Review conflict table “Current (system)” | **5** cartons |
| Review “AI Proposed” | **16** cartons |

They are forced to re-sum POs and “choose” 5 vs 16 when the live shipment and PO total already hold the med/high-confidence value. That is fake work.

Root cause (UX layer):

1. **Current** for a conflict row is the critic candidate with `source: system`, not a live re-read of the leg.
2. **AI Proposed** is the first non-system candidate, not “already stored.”
3. When live qty already equals the good candidate, the row still counts toward **Approve N changes**.

## Goals

1. **Live leg is truth for qty Current** on the review decision table.
2. **Auto-settle** qty when there is nothing left for a human to choose.
3. **No mental PO sum** when the PO strip / leg already shows the settled total.
4. **Qty-only** — styles, vendor, GW/HTS are out of scope for this design.

## Non-goals

- Fixing style “kept C200” proposals.
- Vendor vs consignee party mix-ups.
- Backend / cobalt-queue conflict emission (optional later).
- Changing merge math for how 16 was computed.

## Decision rules

### Qty conflict detection

A critic conflict row is a **qty row** when `mapCriticFieldToColumn(field) === 'qty'` (covers `qty`, `quantity`, snake variants already mapped).

### Live qty

`liveQty` = shipment detail `quantityShipped` (same field Order Details uses for Total Quantity), normalized:

- `null` / `undefined` / non-finite → no live qty
- numeric compare via `Number` after trim; integer-safe for carton counts

### Current column (qty only)

| Case | Current cell shows |
|------|-------------------|
| `liveQty` present | `liveQty` (label unit from leg UOM as today) |
| `liveQty` absent | Critic system candidate (existing `existingValueOf` behavior) |

Do **not** invent a qty when the leg has none.

### Auto-settle (hide qty row)

Hide the qty conflict from the **actionable** decision table when **any** of:

**S1 — Live equals a non-system candidate**  
`liveQty` is present and equals at least one non-system candidate value (normalized numeric equality).

**S2 — Live equals PO shipment total**  
`liveQty` is present and equals the same **shipment total** already shown on the PO strip (sum of linked PO quantities when the product already computes that total for the strip). Prefer the existing frontend/backend helper used for “shipment total N cartons” so review and PO card never disagree.

**S3 — Live equals all candidates**  
All distinct candidate values (system + non-system) normalize to `liveQty` → trivial conflict, hide.

When settled:

- Qty row **not rendered** in the conflict table body.
- Qty **does not** seed `resolutions` for apply.
- Qty **does not** count toward “Approve N changes.”
- Optional later: quiet confirmation line — **out of v1** (approved: hide, not “already N” row).

### When qty row **stays**

Show the row (with live-leg as Current when available) when:

- `liveQty` is null, **or**
- `liveQty` differs from every non-system candidate **and** (if PO total available) differs from PO shipment total.

Example: live=16, email candidates {100, 200}, PO total 100 → **show** (real choice).

Example: live=16, system candidate 5, non-system 16 → **hide** (S1).

Example: live=16, system 5, non-system 5 only, PO total 16 → **hide** (S2) if PO total is available.

### Approve / Keep Existing

- `fieldsToApply` for qty only uses remaining **visible** qty conflicts.
- Settled qty never forces a note solely for qty.
- “Keep Existing” behavior unchanged for non-qty rows.

### Needs attention / flag copy

When qty is auto-settled:

- Do **not** list Qty in “Email and system differ on …” if no other unsettled fields remain from that reason.
- Prefer not to claim “N field(s) disagree” counts that include only settled qty — adjust displayed count to **visible** conflict rows when the card has a critic table (same card). Full global rematch of risk flag counts is **not** required in v1 if only the card’s conflict list drives the count used on that card.

Minimum v1: **decision table + Approve N** honest; Needs attention qty name stripped when qty row hidden and that was the only qty mention.

## Architecture

```
criticReview.conflicts[]
        │
        ▼
filterQtyConflicts(conflicts, shipment)
  - map qty column
  - compute liveQty, poShipmentTotal?
  - settle? drop : keep (with live Current override at render)
        │
        ▼
ReviewCard table + initialResolutions + fieldsToApply
```

**Primary touch:** `frontend` review desk

| Piece | Role |
|-------|------|
| `qty-conflict-settle.ts` (or under `lib/`) | Pure helpers: `isQtyConflict`, `normalizeQty`, `isQtySettled`, `filterActionableConflicts` |
| `ConflictRow` / qty Current | Prefer live qty when rendering qty Current |
| `ReviewCard` | Filter conflicts before table; wire shipment + linked PO totals |
| Tests | Unit settle rules + ReviewCard hide/count |

**No** cobalt-queue, **no** DB migration in v1.

## Data flow

1. Load shipment detail + critic review (unchanged).
2. Before rendering decision grid, compute `actionableConflicts = filterActionableConflicts(conflicts, { liveQty, poShipmentTotal, uom })`.
3. Seed resolutions only from `actionableConflicts`.
4. PO total: reuse existing presentation of “shipment total N cartons” so one definition of sum.

## Error / edge cases

| Edge | Behavior |
|------|----------|
| UOM contested in same card | Still allow settle on **numeric** qty only if live number matches; do not auto-settle UOM row |
| Pieces vs cartons same number | Numeric-only equality; if UOM also conflicts, leave UOM row |
| liveQty=0 | Treat as present; settle only if candidates truly 0 |
| Multi-leg / multi-candidate qty | Settle if live matches **any** non-system; else show |
| Linked POs empty | S2 unavailable; S1/S3 only |
| Stale critic after human edit | Live leg wins; next open re-filters |

## Testing

1. **Unit:** settle matrix (S1/S2/S3, show cases).
2. **ReviewCard:** fixture like GZL — live 16, system 5, proposed 16 → no qty row; Approve count excludes qty.
3. **Regression:** real qty fight (live null or live ≠ candidates) still shows row and apply works.
4. **PO total:** live 16, candidates only 5, linked POs sum 16 → settled.

## Success criteria

- Operator on GZL-class legs does **not** re-sum POs or approve qty when Order Details already shows the correct total.
- “Approve N changes” never includes settled qty.
- No change to non-qty conflict behavior.

## Out of scope follow-ups (not this PR)

- Backend omit qty conflict when leg matches winner.
- Quiet “Qty already 16” confirmation row.
- Style / vendor smart proposals.
- Medium-band blanket hide of all cargo fields.

## Implementation notes for plan

- Keep helpers pure and tested without mounting full ReviewCard where possible.
- Reuse `mapCriticFieldToColumn` / existing qty unit display helpers.
- Set1-safe: presentation-only filter; no write of qty on settle (leg already correct).
