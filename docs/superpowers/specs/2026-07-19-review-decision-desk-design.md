# Review Decision Desk UX — design

**Date:** 2026-07-19  
**Status:** Approved (brainstorm) — A1 quiet desk + critical missing/conflict  
**Surface:** Review Queue expand + Shipment Review Focus (`ReviewCard`)  
**Related:** Needs attention (`2026-07-17-review-needs-attention-ux-design.md`), POs & styles (`2026-07-19-review-po-style-membership-design.md`)

---

## 1. Problem

Busy operators open Review expecting a **short to-do list**. Today they often see:

1. **Sparse Review** (only a brand / master-miss line + Keep Existing) while **Order Details is full** of cargo — feels broken even when data is consistent.
2. **Field conflict table only** for AI-vs-stored fights — **blank booking / CRD / dates never appear** as work.
3. **Edit** only when `conflicts.length > 0` — cannot fix critical blanks or edit POs without a field fight.
4. **Needs attention** is not actionable (e.g. brand differs → no field to fix in place).

### Product principle (operator constraint)

**Prefer decision desk (only show work)** — do **not** clone Order Details into Review.

**But:** missing or contested **identity / timing** fields are work, not silence.

---

## 2. Goals

1. Review answers: **What do I need to decide or fill before confirm?**
2. Surface **critical missing** and **critical field conflicts** for a fixed allowlist.
3. Keep Needs attention for **judgment** (wrong leg, master miss, brand verify) without re-listing table fields.
4. Keep POs & styles + field conflict table; empty states must explain *why* the page is quiet.
5. **One** page-level Edit / Done editing drives PO rows + field resolutions (already shipping direction).
6. Confirm path stays fast: when nothing critical is open → one primary Approve / Keep Existing.

### Non-goals

- Full Order Details embedded in Review (snapshot of every leg field).
- Wizard multi-step flow (too slow for busy ops).
- Changing matcher / critic scoring algorithms.
- Making style-empty always critical (FA case: pending style is OK).

---

## 3. Information architecture (A1)

Top → bottom in expanded Review:

| # | Region | When shown | Responsibility |
|---|--------|------------|----------------|
| 1 | Identity (page/row chrome) | Always | Booking label, customer, route, status |
| 2 | **Needs attention** | Judgment items only | Which shipment, master miss, brand verify, multi-ID, … (existing rules) |
| 3 | **Critical for sailing** (NEW) | Any critical missing **or** critical conflict | Booking, SO#, CRD, ETD, ATD |
| 4 | **POs & styles** | ≥1 linked PO (or Edit with zero POs for Add) | Per-PO membership / style (existing strip) |
| 5 | **Field conflicts** | `criticReview.conflicts` non-empty (minus bag style when POs exist) | System vs AI for other fields |
| 6 | Source emails | If any | Evidence |
| 7 | Note + actions | Always when not read-only | Edit · Keep Existing · Approve N |

If regions 2–5 are all empty → **Ready state** (see §6).

---

## 4. Critical field set (locked)

These five leg columns are **critical**:

| UI label | Leg column / critic field examples |
|----------|-------------------------------------|
| Booking No. | `bookingNo` / `booking_no` |
| SO# | `soNo` / `so_no` / `soNumber` |
| Cargo Ready Date (CRD) | `cargoReadyDate` / CRD / `crd` |
| ETD | `etd` |
| ATD | `atd` / `actualDeparture` |

### 4.1 Critical **missing**

A field is **missing** when live shipment value is null/empty/whitespace after the same display rules as Order Details (pending).

Show one row per missing critical field in **Critical for sailing**.

### 4.2 Critical **conflict**

A field is a **critical conflict** when it appears in `criticReview.conflicts` (mapped via `mapCriticFieldToColumn`) and maps to one of the five critical columns.

**Warn prominently** — either:

- **Option preferred:** Keep the row in the normal conflict table **and** list a short bullet in **Critical for sailing** (“ETD: system vs AI — resolve below”), **or**
- Pin critical conflict rows to the **top** of the conflict table with a “Critical” badge.

Do **not** hide critical conflicts only in Needs attention prose.

### 4.3 Not critical (examples)

- Item/style empty on PO (unless later elevated by style-broadcast reason — out of scope v1)
- Gross weight / measurement / HTS alone
- Vessel / flight (not in operator’s locked list for this version)
- Brand text mismatch (stays Needs attention judgment)

---

## 5. Critical for sailing — UX

### Header

`Critical for sailing` · `(N)` when N > 0  
Subtitle (muted, once): `Booking, SO, CRD, ETD, ATD — missing or contested`

### Row types

| Kind | Presentation | Primary action |
|------|----------------|----------------|
| Missing | Amber/warning dot · “Booking No. not set” | **Edit** focuses page edit (and preferably scrolls to field if we later add non-conflict editors) |
| Conflict | Amber/warning · “ETD disagrees (system vs AI)” | Scroll/highlight that conflict row |

v1 minimal: Critical list is **read + CTA Edit**; actual value entry uses:

- **Conflict rows** for contested critical fields (existing table)
- **Page Edit** for missing critical fields only if we expose free-text on leg (may require small “critical field inputs” when missing and **not** in conflicts)

**Missing-only path (required for v1 completeness):**

If Booking/SO/CRD/ETD/ATD is missing **and** not in conflicts, page Edit must still open an input for that field (either a tiny **Critical fields** editor under the list, or include them in a “fill blanks” group that posts via correct/PATCH). Without this, operators cannot fill blanks from Review.

**Recommended v1 implementation:** under Critical for sailing, when `editing`, show one input per **missing** critical field; on Done editing / Approve, include those values in the same save path as field corrections (`mapCriticFieldsToColumns` / confirm). Contested critical fields stay in the conflict table only (no duplicate inputs).

### Approve gating (v1)

| State | Approve / Keep Existing |
|-------|-------------------------|
| No critical missing, no critical conflict unresolved | Enabled |
| Critical **conflict** still open (resolution not chosen / not approved) | Same as today: Approve applies resolutions — operator must resolve in table first; button applies current resolutions |
| Critical **missing** still blank | **Soft gate (default):** primary button still available but secondary warning “N critical blanks remain”; **or** Hard gate: disable until filled or “Skip with note” |

**Product default for busy ops: soft gate** — do not trap operators if email never had CRD; show strong warning + optional note.

Hard gate is a config flag for later if ops demand it.

---

## 6. Empty / ready states

| Situation | UI |
|-----------|-----|
| Only Needs attention (e.g. brand) | Needs attention + Ready line: “No field changes · confirm when verified” + Keep Existing / Approve |
| Critical missing only | Critical list + Edit + Approve (soft warn) |
| Field conflicts only | Conflict table as today |
| Nothing open | Single muted banner: **Ready to confirm — no open decisions** + primary Approve |
| FA47771F-like | Brand in Needs attention; style `—` OK; no critical rows if booking/SO/CRD/ETD/ATD present |

Never leave a blank card with only Note + Keep Existing without a one-line **why**.

---

## 7. Edit behavior (page-level)

| Control | Behavior |
|---------|----------|
| **Edit** | Always visible when not read-only **if** any of: critical missing, field conflicts, linked POs, or Needs attention (judgment-only can still allow Edit for PO fill). Minimum: show Edit when critical missing **or** conflicts **or** POs. |
| **Done editing** | Saves PO drafts (existing) + critical missing field patches |
| Conflict Edit | Same flag: Resolution column + PO inputs + critical blank inputs |

Remove any **second** Edit on POs header (already aligned).

---

## 8. Needs attention interaction (light)

v1: keep non-field bullets; no mandatory deep-link.

v1.1 optional: brand bullet → open full shipment or expand PO card. Not required for this spec.

---

## 9. Data / implementation sketch

| Input | Source |
|-------|--------|
| Live values | Shipment detail DTO (same as Order Details) |
| Missing check | `!liveValue` for critical columns |
| Critical conflict | `conflicts` where `mapCriticFieldToColumn(field)` ∈ critical set |
| Save blanks | PATCH/correct with critical columns only if changed |

Frontend helper (suggested):

```ts
const CRITICAL_COLUMNS = ['bookingNo', 'soNo', 'cargoReadyDate', 'etd', 'atd'] as const
function criticalMissing(shipment): CriticalItem[]
function criticalConflicts(conflicts): CriticalItem[]
```

Map critic aliases (`so_no`, `crd`, `actual_departure`) via existing `mapCriticFieldToColumn`.

---

## 10. Testing

- Unit: missing detection for each of 5 fields; SO alias mapping.
- Unit: critical conflict detection when conflict field is `etd` / `booking_no`.
- Component: Critical band renders N rows; hidden when none.
- Component: Edit visible with critical missing and zero conflicts.
- Component: ready-state banner when no needs-attention, no critical, no conflicts.
- Regression: bag itemStyle suppressed when linked POs; Approve still works with only needs-attention.

---

## 11. Rollout

1. Helpers + Critical for sailing band (missing + conflict pointers).  
2. Edit always when critical/PO/conflicts; critical blank inputs in edit.  
3. Ready-state copy when desk is empty.  
4. Soft warning on Approve when critical missing remain.  
5. Optional hard-gate flag later.

---

## 12. Success criteria

- Busy ops scan **Needs attention → Critical → Conflicts → Approve** in seconds.  
- Missing booking / SO / CRD / ETD / ATD never silent.  
- Conflicts on those five fields always **warned** (band and/or table pin).  
- Review still not a second Order Details page.  
- FA47771F-like brand-only cases explain themselves and allow confirm without fake conflict rows.

---

## 13. Open decisions (defaults)

| Topic | Default |
|-------|---------|
| Approve with critical missing | Soft warn, do not hard-block |
| Vessel / flight | Out of critical set (this version) |
| Style empty | Not critical |
| Critical conflict UI | Bullet in Critical band + row remains in conflict table |

---

## Appendix — ELI5 (繁中摘要)

審核頁 = **待辦清單**，不是整本出貨檔。  
待辦包括：要你判斷的（品牌、對不對票）、**重要欄位空白或打架**（訂艙、SO、CRD、ETD、ATD）、以及 AI 跟系統數字不一樣。  
其他已填好的貨櫃／重量等，請到「完整出貨」看，不必擠進審核。
