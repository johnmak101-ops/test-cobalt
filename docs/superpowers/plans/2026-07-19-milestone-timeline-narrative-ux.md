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
- Exact copy:
  - done + no date → `Done` (+ title tooltip optional)
  - not done + no est → `Not yet`
  - not done + etd on Departure → `ETD {formatDate(etd)}`
  - not done + eta if ARRIVED path ever shown → `ETA {formatDate(eta)}`
  - has date → `formatDate` only
- Orientation:
  - mid: `Now: {label} · Next: {label}`
  - terminal done: `Complete · {label}`
  - none: `Not started · Next: {first label}`

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

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | clean | Approach B + HOLD; 0 critical gaps |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | not run yet |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | optional |
| DX Review | `/plan-devex-review` | Developer experience | 0 | — | — |

**VERDICT:** CEO CLEARED for scope — eng review recommended before implement.

NO UNRESOLVED DECISIONS
