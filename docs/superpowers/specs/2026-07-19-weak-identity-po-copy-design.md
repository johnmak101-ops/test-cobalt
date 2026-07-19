# Weak identity Needs attention — honest PO copy

**Date:** 2026-07-19  
**Status:** Approved for implementation  
**Repo:** cobalt-shiptrack (Review Needs attention humanizer)  
**Related:** Needs attention layman groups; Identify section on `WEAK_IDENTITY`; decision desk

## Goal

When risk flag **`WEAK_IDENTITY`** fires and a **PO is known**, Needs attention must **not** claim there is no PO or that the email “cannot place.” Ops should read that **only PO is known** and they should **add booking, SO, or B/L** (Identify).

When there is truly no PO and no strong ID, keep a clear empty-identity line.

## Product decision

| Choice | Detail |
|--------|--------|
| **Approach** | Split copy by PO presence (Approach 1) |
| **Ops action** | Push **add strong ID** (booking / SO / B/L) when PO is present |
| **Surface** | Frontend humanizer + pass `hasPo` from Review / detail callers |
| **Backend** | No change to when `WEAK_IDENTITY` is emitted |

## Problem (current)

`WEAK_IDENTITY` always humanizes to:

> No booking, SO, B/L, or PO — cannot place this email

Backend chip text is only **“No booking/SO/B/L identity”** (strong IDs). The card can still show **linked POs**. Ops correctly reject the “or PO” claim.

Separate flag **`PO_ONLY_WEAK_MATCH`** (“Linked by PO only — may be the wrong leg”) is a different story and stays unchanged.

## Copy sheet

| Case | Condition | User sees |
|------|-----------|-----------|
| **PO known** | `hasPo === true` | **Only PO known — add booking, SO, or B/L to place this email** |
| **No PO** | `hasPo === false` or omitted | **No booking, SO, B/L, or PO — cannot place this email** |

| Rule | Detail |
|------|--------|
| Group | Real shipment? (`no_identity`) |
| lineId | `r-no-id` (same combine key either way) |
| Jargon | No “strong ID” in UI copy |
| Severity | Unchanged (flag severity) |

Same split applies when a **review reason** maps to the same empty-identity / weak-identity line (`r-no-id`), not only the flag code.

## `hasPo` signal

```typescript
// buildNeedsAttention / buildNeedsAttentionGroups
hasPo?: boolean  // default false when omitted
```

### Callers

| Caller | How to set `hasPo` |
|--------|---------------------|
| `ReviewCard` | `linkedPOs.some((p) => String(p.poNumber ?? '').trim().length > 0)` |
| `ShipmentDetailPage` | Same from shipment linked POs (or equivalent non-empty PO list on detail DTO) |

### Defaults / queue

- **`hasPo` omitted or `false`:** no-PO copy (safe default; no false “Only PO known”).
- Do **not** invent PO presence from flag message alone when `linkedPOs` is empty — card truth wins.
- Optional later: richer queue payload with PO numbers; out of scope if not already on the row.

## Architecture

```
ReviewCard / ShipmentDetailPage
        │  hasPo from linkedPOs
        ▼
buildNeedsAttention({ riskFlags, reviewReasons, hasPo, ... })
        │
        │  WEAK_IDENTITY / r-no-id lines
        ▼
weakIdentityText(hasPo)  →  PO-known copy | no-PO copy
```

**Suggested helper:**

```typescript
export function weakIdentityText(hasPo: boolean): string {
  return hasPo
    ? 'Only PO known — add booking, SO, or B/L to place this email'
    : 'No booking, SO, B/L, or PO — cannot place this email'
}
```

Apply when producing or normalizing lines with `lineId === 'r-no-id'` (flag path and reason path).

## Unchanged

| Piece | Detail |
|-------|--------|
| Identify section | Still shown for `WEAK_IDENTITY` |
| `PO_ONLY_WEAK_MATCH` | “Linked by PO only — may be the wrong leg” |
| Critic / committer | No change to flag emission |
| Decision desk critical fields | Unrelated |

## Files

| File | Change |
|------|--------|
| `frontend/src/components/review/needs-attention.ts` | `hasPo` opt; `weakIdentityText`; wire `r-no-id` / `WEAK_IDENTITY` |
| `frontend/src/components/review/needs-attention.test.ts` | hasPo true/false cases |
| `frontend/src/components/review/ReviewCard.tsx` | Pass `hasPo` from `linkedPOs` |
| `frontend/src/pages/ShipmentDetailPage.tsx` | Pass `hasPo` when linked POs exist |
| `ReviewCard.test.tsx` | Update expectations if they assert old copy with POs present |

## Success criteria

1. Card with linked PO + `WEAK_IDENTITY` → **Only PO known — add booking, SO, or B/L…**; never “or PO — cannot place” as the claim.
2. No PO + `WEAK_IDENTITY` → existing no-PO line.
3. Identify still available for weak identity.
4. No backend / flag-emission change.

## Out of scope

- Identity band redesign (Approach 3)
- Always-drop-PO single line only (Approach 2) as sole behavior
- Merging `WEAK_IDENTITY` with `PO_ONLY_WEAK_MATCH`
- Changing when the critic raises `WEAK_IDENTITY`

## Testing

- Unit: `weakIdentityText(true|false)` exact strings
- Unit: `buildNeedsAttention` + `WEAK_IDENTITY` + `hasPo: true` → only-PO copy
- Unit: same flag + `hasPo: false` / omitted → no-PO copy
- Unit: `PO_ONLY_WEAK_MATCH` unchanged
- Component (optional): ReviewCard with `linkedPOs` + flag shows only-PO copy
