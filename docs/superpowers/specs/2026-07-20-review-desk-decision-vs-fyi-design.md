# Review desk: decision flags vs FYI (detail-only)

**Date:** 2026-07-20  
**Status:** Approved (brainstorm) — Approach 1, product rule **A**  
**Surface:** Review Queue expand + Review focus (`ReviewCard`); Shipment detail Needs attention  
**Related:** `2026-07-17-review-needs-attention-ux-design.md`, `2026-07-19-review-decision-desk-design.md`, judgment-only banner (checks only / no field conflicts), `D:\cobalt-queue\docs\designs\document-parse-flow-enhancement.md` (gate codes bind into this taxonomy — §3.4 additions 2026-07-20)

---

## 1. Problem

Operators open Review and see a long **Needs attention** list (placement, 14 Mesh parties, brand Barbour, missing vendor, multi-dest, …) even when:

- There is **no conflict table** to act on, or  
- Many bullets require **no decision at confirm time** (add to Mesh later, soft brand note).

That feels like a broken desk: “so much info” but nothing to choose. Shipment detail already has (or can have) the full story; Review should not clone every diagnostic.

### Product principle (locked)

**Prefer decision desk (only show work)** — do not flood Review with FYI.

**Rule A (approved):**

- On Review: show only flags that need **judgment or execution before confirm** (especially **placement / identity**).  
- Pure FYI (Mesh party lists, soft brand/buyer notes, non-blocking incomplete data) → **hide on Review**, keep on **shipment detail**.

---

## 2. Goals

1. Review Needs attention = **decision** items only.  
2. Shipment detail Needs attention = **full** list (decision + FYI), optionally sectioned.  
3. Empty decision list + no conflicts → quiet **Ready to confirm** (existing ready state).  
4. Decision list present + no conflicts → keep **Checks only — no AI field conflicts** banner (already shipping).  
5. No matcher/gate score changes — **presentation filter only**.

### Non-goals

- Changing who is provisional / critic band.  
- Deleting FYI from stored `review_reasons` / critic payload.  
- Full Placement/Parties rename redesign (can follow later).  
- Hiding **all** Needs attention when conflicts.length === 0 (that was option B — rejected).

---

## 3. Classification

Each Needs attention item (after existing collapse/humanize) is tagged:

```ts
desk: 'decision' | 'fyi'
```

### 3.1 Decision (show on Review)

Items where the operator must **choose**, **not approve blind**, or **use in-desk tools** (identify/link, conflict table is separate).

| Category / lineId examples | Why decision |
|----------------------------|--------------|
| `which_shipment` / multi_id: PO-only, PO reassign, combined PO lines, multi-dest, multi-match, multi-id, supersede | Wrong job / split / move |
| `real_shipment` / no_identity, portal: weak identity, thin mail, portal | Is this trackable freight? |
| Missing attachment (body claims file, none ingested) | Cargo may be incomplete; don’t confirm blind |
| EXTRACTION_INCOMPLETE when still shown (blocking parse trust) | Don’t trust sparse extract |
| Field-disagree lines only when **no** conflict table (rare residual) | Or hide if table owns — existing rule |
| **Gate failures** (parse-flow plan, added 2026-07-20): `g-checksum` (check digit fails, value retained), `g-total` (line Σ ≠ footer TOTAL), `g-pages` (pages skipped AND footer TOTAL missing) | Deterministic data-integrity checks — don't confirm blind |

### 3.2 FYI (detail only; hide on Review)

| Category / lineId examples | Why FYI |
|----------------------------|---------|
| Mesh party collapse / m-party:* / m-mesh (“N parties not in Mesh”) | Master cleanup later |
| Soft port country/region-only lines if treated as non-blocking (optional; default **fyi** unless product later promotes) | Pick LOCODE on detail / open shipment |
| Brand across buyer families / house-agent style notes | Verify later on detail |
| “Vendor / factory not stated” when placement is already handled elsewhere | Incomplete data soft |
| Soft merge notes, packing noise (already suppressed), raw-name restatements (already suppressed) | Stay hidden or detail-only |
| **Gate audit notes** (added 2026-07-20): `g-repaired` ("container repaired X→Y" low note), `g-evidence-trunc` (evidence truncated) | Audit trail, non-blocking; truncation also annotates INSIDE gate popovers when a decision gate is present |

### 3.3 Rule of thumb

- Next step = **add in Mesh later** or **nice to know** → `fyi`.  
- Next step = **wrong job / split / real mail / missing file / don’t trust parse** → `decision`.

### 3.4 Explicit allow/deny for implementation

**Default for unmapped lineIds:** `decision` if group is `which_shipment` or `real_shipment`; else `fyi` (prefer quiet desk over missing a rare alarm — override with tests).

**Must stay decision (never demote without product change):**

- `w-po-only`, `w-po-other`, `w-po-combined`, `w-po-thin`  
- `w-multi-dest`, `w-multi-match`, `w-multi-id`, `w-supersede`  
- `r-no-id`, `r-thin`, `r-portal`  
- `i-attach` (missing attachment)  
- `i-parse` when still surfaced as parse incomplete  
- `g-checksum`, `g-total`, `g-pages` (gate failures — added 2026-07-20; these only exist when a gate FIRED, so the unmapped-default must never see them)  

**Must be fyi (hide on Review):**

- `m-party:collapsed`, `m-party:*`, `m-mesh`, `m-party`, `m-customer` (soft), mesh party miss text  
- Brand / buyer-family merge notes under `other` matching brand-across-families  
- `m-vendor` / “Vendor / factory not stated” incomplete soft lines  
- `m-port:collapsed` / soft country-only port lines (detail; operator uses Open shipment for LOCODE)  
- `g-repaired`, `g-evidence-trunc` (gate audit notes — added 2026-07-20; evidence-trunc still annotates inside decision-gate popovers)  

---

## 4. Information architecture

### 4.1 Review (`ReviewCard` — queue expand + focus)

```
Needs attention   [only desk === 'decision']
  [optional] Checks only banner if decision non-empty && conflicts.length === 0
POs & styles / field conflicts / identify / candidates  (unchanged)
Open shipment · actions
```

- If **no decision items** → **omit** Needs attention section entirely.  
- Do **not** show FYI under a collapsed “Also noted” on Review (keeps desk short).

### 4.2 Shipment detail

```
Needs attention
  Before confirm   (decision)   — optional subhead if both non-empty
  Also noted       (fyi)        — optional subhead if both non-empty
```

If only one class non-empty, single list without subheads is fine.

---

## 5. Implementation sketch (presentation-only)

1. Extend `NeedsAttentionItem` with `desk: 'decision' | 'fyi'`.  
2. In `buildNeedsAttention` (or thin wrapper `tagDesk(item)` after collapses): assign `desk` from lineId/group rules §3.4.  
3. `buildNeedsAttentionGroups` gains option or sibling:
   - `buildNeedsAttentionGroups({ …, desk: 'decision' | 'all' })`  
   - Review: `desk: 'decision'`  
   - Detail: `desk: 'all'` (default).  
4. Filter groups: drop empty groups after filter.  
5. Tests: fixture matching Barbour + 14 Mesh + PO-only → Review shows placement only; Detail shows Mesh + brand + placement.  
6. No API change required unless we later expose desk tags to other clients.

---

## 6. Success criteria

| Scenario | Review Needs attention | Detail |
|----------|------------------------|--------|
| PO-only + reassign + multi-dest + 14 Mesh + brand Barbour + vendor not stated | Placement lines only (merged as today) | Full list |
| Only Mesh parties | Section **hidden** | Mesh expand list |
| Only field conflicts | No FYI; conflict table owns work | Full optional FYI |
| Nothing decision + no conflicts | Ready to confirm | Empty or FYI only |

---

## 7. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Operator never sees Mesh miss until detail | Open shipment is on card; detail “Also noted”; Mesh cleanup is not confirm-blocking |
| Over-hiding placement | §3.4 must-stay-decision list + tests |
| Port country-only only on detail | Open shipment path; can promote specific ports to decision later |

---

## 8. Out of scope / follow-ups

- Placement + Parties visual rename (soft merge copy).  
- Promoting Mesh miss to decision when zero parties linked and create path.  
- Backend critic payload split (Approach 2).

---

## 9. Approval

- Product rule: **A**  
- Approach: **1** (display filter by `desk`)  
- Approved: 2026-07-20 (chat)
