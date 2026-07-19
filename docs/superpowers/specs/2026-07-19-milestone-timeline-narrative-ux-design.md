# Milestone Timeline — Narrative UX

**Date:** 2026-07-19  
**Status:** CEO review locked — HOLD SCOPE + Approach B  
**Repo:** cobalt-shiptrack  
**Surface:** Shipment detail `MilestoneTimeline` only  
**Related:** Key Dates card, alert rules, status badge; Critical-for-sailing removed from Review

## Decisions locked

| Decision | Choice |
|----------|--------|
| Approach | **B — Narrative timeline** |
| Mode | **HOLD SCOPE** |
| Progress model | **Unchanged:** furthest stage with actual date + `currentStatus` floor. **No** `Date.now()` for completion. |
| Overdue / risk | **Not** in this strip — Key Dates + alert rules own that |
| Scope | Detail page timeline only (not review queue, not list table) |

## Problem

Ops read:

```
Booking Request   17 Jul 2026
SO Received       —
Draft BOL         Awaiting
Final BOL         Awaiting
Departure         Est. 26 Jul 2026
Delivered         Awaiting
```

Without knowing:

1. **Where am I?** (current stage)
2. **What’s next?**
3. What **—** vs **Awaiting** vs **Est.** mean

Root cause: date line vocabulary is engineer-shaped; progress is data-driven (correct) but the UI does not narrate it.

## Non-goals (NOT in scope)

- Wall-clock or system-time for stage completion  
- Soft “ETD passed” risk chips on the strip (Approach C)  
- Re-adding Critical for sailing on Review  
- Changing milestone order or backend event emission  
- List-page / queue mini-lifecycle  
- New APIs or schema  

## Goals

1. One glance: **current stage** and **next stage**  
2. Honest date vocabulary (no mysterious em dash)  
3. Visual hierarchy: past dimmer, current strongest, future quieter  
4. No truncation of “Awaiting” / “Not yet”  
5. Keep existing progress math (milestones + scalars + status)  

## Product model (unchanged)

```
actualDate(stage) = milestone.occurredAt
                  | DEPARTED → atd | SAILED event
                  | DELIVERED → inDcDate
                  | (ARRIVED path reserved; display order uses DELIVERED)

estDate(stage)    = DEPARTED → etd | ARRIVED → eta

currentIndex      = max( furthest stage with actualDate,
                         STATE_TO_INDEX[currentStatus] )

done(i)           = i <= currentIndex
isCurrent(i)      = i === currentIndex && not terminal
isNext(i)         = i === currentIndex + 1
```

**Product split:**

| Concern | Owner |
|---------|--------|
| Lifecycle story | Milestone Timeline |
| Exact field values | Key Dates / Order Details |
| Overdue / missing SLA | Alert rules |

## UX design

### 1. Orientation strip (new)

Above the stepper:

```
Now: SO Received · Next: Draft BOL
```

When terminal (Delivered done):

```
Complete · Delivered
```

When nothing reached yet:

```
Not started · Next: Booking Request
```

### 2. Date line vocabulary (replace)

| Case | Today | New (ops-facing) |
|------|-------|------------------|
| Has actual date | `17 Jul 2026` | **Same** (keep `formatDate`) |
| Done, no date | `—` | **Done** (tooltip: “Implied complete; no email date on file”) |
| Not done, has estimate | `Est. 26 Jul 2026` | **ETD 26 Jul 2026** (Departure) / **ETA …** if ever shown for arrival path |
| Not done, no estimate | `Awaiting` | **Not yet** |

Do **not** invent estimates for Draft/Final BOL/Delivered.

### 3. Hierarchy

| State | Node | Label | Date line |
|-------|------|-------|-----------|
| Past (`done` && !current) | Filled check, muted connector | `text-text-secondary` | muted |
| **Current** | Breathing icon (existing), warning ring | `font-semibold text-status-warning` | primary/muted |
| Next | Empty ring, primary border (existing isNext) | `text-text-primary` | muted |
| Future | Empty border | `text-text-muted` | muted |

### 4. Collapse far future (HOLD — minimal form)

**Default (horizontal md+):** show all 6 stages (status quo layout) but with hierarchy above.  

**If space still tight:** optional later — collapse stages after `currentIndex + 2` behind “+N more”. **Not required for v1 HOLD** unless tests prove overflow. v1 priority is copy + orientation + hierarchy + no truncation.

### 5. Layout polish

- Date lines: `whitespace-nowrap` or min-width so “Not yet” never becomes “Awaitin”  
- Mobile vertical: same copy + orientation strip above  

## Architecture

```
ShipmentDetailPage
  props → MilestoneTimeline (unchanged API surface preferred)
            │
            ├─ compute stages (existing actualDate / estDate / currentIndex)
            ├─ orientation: Now / Next from stages
            └─ dateLine() vocabulary + hierarchy classes
```

**Files:**

| File | Change |
|------|--------|
| `frontend/src/components/shipments/MilestoneTimeline.tsx` | Orientation, copy, hierarchy, layout |
| `frontend/src/components/shipments/MilestoneTimeline.test.tsx` | New cases for copy + orientation |
| `ShipmentDetailPage.tsx` | Only if wrapper title/copy needs “Lifecycle” rename — **optional, default keep “Milestone Timeline”** |

No backend changes.

## Edge cases

| Case | Behavior |
|------|----------|
| No milestones, status BOOKED | Now: Booking Request (or not started) per index rules |
| Status SAILED, no ATD, has ETD | Current Departure; date line **ETD …** until ATD |
| Status SAILED, has ATD | Departure done with date; Next Delivered **Not yet** |
| Delivered + inDcDate | Complete · Delivered; all prior Done |
| Implied SO complete (— → Done) | Tooltip explains missing event date |
| Empty milestones + no status map | currentIndex -1 → Not started |

## Shadow paths

```
INPUT milestones/status/dates
  │
  ├─ nil milestones[]     → [] map; status floor still works
  ├─ empty occurredAt     → treat as no actual for that type
  ├─ unknown status       → STATE_TO_INDEX miss → -1 floor
  └─ only etd, no events  → Departure shows ETD when index reaches DEPARTED via status
```

## Error / failure modes

| Path | Failure | User sees | Test? |
|------|---------|-----------|-------|
| UI render | Bad date string | formatDate existing behavior | existing |
| Missing props | etd null | “Not yet” not crash | unit |
| Status unknown | floor -1 | Not started | unit |

No new network calls → no new API error paths.

## Security

No new endpoints, no new inputs from user. **OK** — display-only.

## Tests (required)

1. Done without date → text **Done**, not `—`  
2. Pending without est → **Not yet**, not Awaiting  
3. Departure with etd, not done → **ETD** + formatted date  
4. Orientation: with SO date + not draft → Now includes SO / Next Draft  
5. Terminal delivered → Complete line  
6. Regression: AT_WAREHOUSE milestone still ignored (existing test)  
7. Status floor still advances without events (existing pattern)  

## Observability

None new. Optional later: log if `currentIndex` and badge status diverge by >1 stage — out of scope HOLD.

## Deployment

Frontend-only. Instant rollback via revert. No flags required for HOLD strip.

## Dream state delta

| Now | After this plan | 12-month ideal |
|-----|-----------------|----------------|
| Cryptic strip | Clear now/next + honest copy | Same lifecycle language on list + alerts |
| Risk mixed into strip | Risk stays on alerts | Product split documented |

## What already exists

- Progress math, breathing icon, horizontal/vertical split, status floor — **reuse**  
- `formatDate`, Key Dates, alerts — **do not reimplement**  

## Reversibility

**5/5** — pure UI; easy revert.

## Implementation tasks

- [ ] **T1 (P1)** — Date line vocabulary (`Done` / `Not yet` / `ETD` / `ETA`) + tooltips  
  - Files: `MilestoneTimeline.tsx`  
  - Verify: unit tests for each branch  

- [ ] **T2 (P1)** — Orientation strip (Now · Next / Complete)  
  - Files: `MilestoneTimeline.tsx`  
  - Verify: unit tests for mid-lifecycle + terminal + not started  

- [ ] **T3 (P2)** — Visual hierarchy (current/next/past classes) + no truncation  
  - Files: `MilestoneTimeline.tsx`  
  - Verify: visual check on detail; mobile vertical  

- [ ] **T4 (P2)** — Expand tests; keep AT_WAREHOUSE tolerance  
  - Files: `MilestoneTimeline.test.tsx`  
  - Verify: `npx vitest run src/components/shipments/MilestoneTimeline.test.tsx`  

## Review sections (HOLD — condensed findings)

| # | Section | Result |
|---|---------|--------|
| 1 Arch | Single component; no new coupling. **OK** |
| 2 Errors | Display-only; no new GAPS. **OK** |
| 3 Security | No new attack surface. **OK** |
| 4 Data/UX | Edge cases listed above; double-nav N/A. **OK** |
| 5 Quality | Prefer pure helpers for `dateLine` / orientation strings for testability. **Note for eng** |
| 6 Tests | Tasks T1–T4. **OK** |
| 7 Perf | O(stages)=6. **OK** |
| 8 Observ | None required HOLD. **OK** |
| 9 Deploy | FE only. **OK** |
| 10 Future | Does not block Approach C later. Reversibility 5. **OK** |
| 11 Design | Hierarchy as service; subtraction of cryptic em dash. Recommend `/plan-design-review` optional. **OK** |

## Scope proposals

| Proposed | Decision |
|----------|----------|
| Approach B narrative | **ACCEPTED** (user) |
| HOLD SCOPE | **ACCEPTED** (user) |
| Approach C ETD-passed risk on strip | **SKIPPED** (HOLD) |
| List-page mini lifecycle | **NOT in scope** |

## Unresolved decisions

None. Approach B + HOLD + product split locked.
