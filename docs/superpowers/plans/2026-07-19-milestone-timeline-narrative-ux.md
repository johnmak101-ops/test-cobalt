# Milestone Timeline Narrative UX — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans. Checkbox steps.

**Goal:** Ops see where a shipment is in the lifecycle and what’s next, with honest date lines — without using system time for stage completion.

**Architecture:** Frontend-only changes to `MilestoneTimeline.tsx`. Keep existing `actualDate` / `estDate` / `currentIndex` math. Replace date-line copy; add orientation strip; strengthen visual hierarchy.

**Tech stack:** React, TypeScript, Vitest, existing `formatDate` / `cn`.

**Design:** `docs/superpowers/specs/2026-07-19-milestone-timeline-narrative-ux-design.md`

## Global constraints

- **No** `Date.now()` / wall-clock for `done` / `currentIndex`
- **No** soft overdue chips (Approach C deferred)
- **No** Review Critical-for-sailing reintroduction
- **Caption priority (eng lock D1=A):** `date` → **`done` wins** → est → not yet  
  ```
  if (date) → formatDate(date)
  else if (done) → "Done"          // SAILED + no ATD stays Done, NEVER "ETD …"
  else if (est && type === 'DEPARTED') → "ETD " + formatDate(est)
  else if (est && type === 'ARRIVED') → "ETA " + formatDate(est)
  else → "Not yet"
  ```
- Exact copy:
  - has date → `formatDate` only (do **not** call `formatDate` on null — it returns `"TBD"`)
  - done + no date → `Done` (+ title tooltip optional: implied complete, no email date)
  - not done + no est → `Not yet`
  - not done + etd on Departure → `ETD {formatDate(etd)}`
  - not done + eta if ARRIVED path → `ETA {formatDate(eta)}`
- **Regression CRITICAL:** SAILED + no ATD + etd set → Departure caption is **Done**, never Est./ETD (existing product rule / BUG-7)
- Orientation:
  - mid: `Now: {label} · Next: {label}`
  - terminal done: `Complete · {label}`
  - none: `Not started · Next: {first label}`
- Helpers: export pure `stageDateCaption` / `orientationLine`; input shape plain (not private React type)

## File map

| File | Role |
|------|------|
| `frontend/src/components/shipments/MilestoneTimeline.tsx` | Copy, orientation, hierarchy |
| `frontend/src/components/shipments/MilestoneTimeline.test.tsx` | Unit coverage |

---

### Task 1: Pure helpers + date line vocabulary (TDD)

**Files:** Modify `MilestoneTimeline.tsx`, `MilestoneTimeline.test.tsx`

**Produces:**

```typescript
export function stageDateCaption(s: {
  date: string | null
  est: string | null
  done: boolean
  type: string
}): string
// examples:
// { date: '2026-07-17', ... } → formatted date via formatDate (test with fixed input)
// { date: null, done: true } → 'Done'
// { date: null, done: false, est: null } → 'Not yet'
// { type: 'DEPARTED', est: etd, done: false } → 'ETD ' + formatDate(etd)

export function orientationLine(stages: TimelineStage[]): string
```

- [ ] Write failing tests for each caption branch + orientation mid/terminal/not-started  
- [ ] **CRITICAL regression:** SAILED + null atd + etd → expect `Done`, `queryByText(/ETD|Est\./)` null  
- [ ] Implement helpers; wire `dateLine` UI to caption string  
- [ ] Run `npx vitest run src/components/shipments/MilestoneTimeline.test.tsx`  
- [ ] Commit: `feat(shipments): honest milestone date captions`

---

### Task 2: Orientation strip + hierarchy

**Files:** `MilestoneTimeline.tsx`, tests

- [ ] Render orientation above vertical and horizontal views  
- [ ] Apply past / current / next / future text classes per design  
- [ ] Ensure date caption containers don’t truncate (“Not yet”)  
- [ ] Tests for orientation visible in document  
- [ ] Commit: `feat(shipments): milestone now/next orientation and hierarchy`

---

### Task 3: Regression pass

- [ ] Keep AT_WAREHOUSE ignore test green  
- [ ] Manual: open a shipment with ETD-only departure + SO without date  
- [ ] Commit if any polish

## NOT in scope

- Clock-based risk, list mini-timeline, backend milestone changes

## Eng review notes (2026-07-19)

| Finding | Decision |
|---------|----------|
| SAILED + no ATD must not show ETD/Est | **D1=A locked:** done beats est |
| Export pure helpers for TDD | Required |
| formatDate(null) → TBD | Never call on null caption paths |
| Complexity | 2 files — sequential Tasks 1→2→3 |
| Perf / security | No issues |

## Implementation Tasks (eng-hardened)

- [ ] **T1 (P1)** — `stageDateCaption` + caption priority + SAILED regression  
- [ ] **T2 (P1)** — `orientationLine` + strip UI + hierarchy + no truncation  
- [ ] **T3 (P2)** — AT_WAREHOUSE + lean-stage regressions; manual detail check  

Sequential; no parallel lanes.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | clean | mode: HOLD_SCOPE, 0 critical gaps |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 1 issue folded (SAILED/Done); 0 open |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | optional |
| DX Review | `/plan-devex-review` | Developer experience | 0 | — | — |

**VERDICT:** CEO + ENG CLEARED — ready to implement.

NO UNRESOLVED DECISIONS
