# Implementation Plan: Review Card — Needs attention UX

**Date:** 2026-07-17  
**Branch target:** `main` via feature branch `feat/review-needs-attention-ux`  
**Design:** `docs/superpowers/specs/2026-07-17-review-needs-attention-ux-design.md`  
**CEO review mode:** **HOLD SCOPE** (design already approved; presentation-only; no expansion)  
**Effort:** human ~2–3h / CC ~20–40min  

---

## CEO review (HOLD SCOPE) — executive

### Premise

| Question | Answer |
|----------|--------|
| Right problem? | Yes. Ops still see flat Why lists that restate the conflict table or repeat labels. |
| Do nothing? | Live pain remains; #166/#168 reduced noise but did not rename/structure the block or edit highlight. |
| Proxy problem? | Not abstract “beauty” — hierarchy of attention on the busiest ops screen. |

### Approaches considered

| | Summary | Effort | Risk | Completeness |
|--|---------|--------|------|--------------|
| **A — Minimal (chosen)** | Filter + label + edit CSS on `ReviewCard` only | S | Low | 8/10 for stated goals |
| B — Extract hook + pure filter module | Same UX, cleaner test surface | S–M | Low | 9/10 |
| C — Full #167 taxonomy cards | Grouped classes, actions, queue chips | L | Med | 10/10 product vision, **out of scope** |

**RECOMMENDATION: A**, optionally structure as B if filter logic exceeds ~30 lines. Do not pull C into this PR.

### Dream state delta

```
  CURRENT                     THIS PLAN                    12-MONTH IDEAL
  Flat Why list + noise     --->  Needs attention        --->  Classed reasons (#167)
  Table already compares         (non-field only) +           + queue chips + primary CTA
  #166/#168 dedupe shipped       subtle edit highlight
```

This plan **moves toward** ideal without implementing the whole cathedral.

### NOT in scope

- #167 full layman class UI  
- Queue list redesign / chips  
- Conflict table visual redesign  
- Wizard multi-step review  
- Gate / auto-apply logic changes  
- Source emails / CandidateLegs restyle  

### What already exists

| Asset | Reuse |
|-------|--------|
| `ReviewCard.whyReview` | Extend filter + render |
| `RISK_CODE_CATEGORY` / `categorizeReason` | Conflict suppress |
| `editing` state on card | Drive left-border class |
| `humanizeReasons` | Keep for bullet text |
| #166 assemble + #168 gate string category | Already on main |

---

## Architecture

```
  criticReview.riskFlags ──┐
                           ├──► filterNeedsAttention() ──► bullets (0..N)
  shipment.reviewReasons ──┘         │
                                     ├─ drop severity? (keep medium/high flags; drop conflict-class when covered)
                                     └─ drop categorize===conflict if conflicts[] or conflict flags

  editing === true ──► wrapper class border-l-2 border-status-warning (+ optional bg 3%)

  Conflict table / ConflictRow ── UNCHANGED
```

### Data paths

| Path | Behavior |
|------|----------|
| Happy | Non-field flags/reasons → 1–2 bullets under one title |
| Nil critic | reviewReasons only (after filter); table may still show |
| Empty after filter | Hide entire Needs attention section |
| Error | N/A (pure render) |

---

## Implementation tasks

### T1 (P1) — Pure filter for Needs attention items

**Files:**  
- Prefer `frontend/src/components/review/needs-attention.ts` (pure, unit-tested)  
- Or keep logic in `ReviewCard.tsx` if &lt;25 lines  

**Logic:**

1. Start from same union as today (`riskFlags` + humanized `reviewReasons` with category suppress when flag already explains category).  
2. **Additionally** exclude any item whose category is `conflict` when:
   - `conflicts.length > 0`, OR  
   - any riskFlag maps to `conflict` via `RISK_CODE_CATEGORY`  
3. Optionally cap display to **2** bullets (design: 1–2 lines). If &gt;2, show top by severity then first-wins; rest not shown in v1 (or “+N more” only if product insists — default **no +N**, cap hard at 2).  
4. **Product default for cap:** hard max 2 bullets (design text). Drop lower severity first (low before medium before high inverted — keep high first).

**Verify:** unit tests in `needs-attention.test.ts`.

### T2 (P1) — ReviewCard render: title once + hide empty

**Files:** `frontend/src/components/review/ReviewCard.tsx`

- Rename section label from `Why review?` → **`Needs attention`** (single string).  
- Keep `data-testid="why-review"` for test stability **or** add `data-testid="needs-attention"` and update tests (prefer **new testid + keep old as alias** if both easy).  
- If filtered list length 0 → render `null` (no empty heading).  
- Bullets: no nested second heading; no prefix “Needs attention:”.

### T3 (P1) — Edit mode subtle highlight

**Files:** `ReviewCard.tsx` (+ optional Tailwind only)

When `editing === true` and section visible:

```
className includes: border-l-2 border-status-warning (or amber token already in design system)
optional: bg-surface-900/80 or bg-status-warning/5 max
```

No glow, no outer ring, no large tint panel.  
When `editing === false`: no left border emphasis.

### T4 (P1) — Tests

**Files:**  
- `frontend/src/components/review/needs-attention.test.ts` (or colocate)  
- `frontend/src/components/review/ReviewCard.test.tsx`

Cases:

1. Flag `INTRA_EMAIL_FIELD_CONFLICT` + reason `3 field conflict(s)` → **no** bare count in Needs attention; conflict table still mounts.  
2. Flag multi-id + reason master miss → both lines, **one** title “Needs attention”.  
3. `editing=true` → container has border class; `editing=false` → not.  
4. Only conflict-class reasons and empty conflicts after filter → section **hidden**.  
5. Existing approve/dismiss/conflict-edit tests still pass.

### T5 (P2) — Copy polish (optional same PR)

Use design EN examples for multi-job / port miss if current humanize strings are long; **prefer reuse** humanize output over hardcoding new strings.

### T6 (P3) — Docs touch

One line in design spec status → “Implementing” / link plan. No AGENTS.md required.

---

## Error & rescue registry

| Codepath | Failure | User sees |
|----------|---------|-----------|
| Filter throws | Should not (pure) | N/A — keep try-free pure code |
| Missing criticReview | reasons-only path | Needs attention from reasons only |
| Empty list | Hide section | Table still usable |

No new network/API. No new silent failures.

---

## Failure modes

| Mode | Handled? |
|------|----------|
| Zero bullets after filter | Hide section |
| 10 risk flags | Cap 2 (severity-ordered) |
| Double title | Single heading only |
| Table regression | No table file edits (or only if test import forced) |

---

## Observability

Presentation only. No new metrics required. Optional: none.

## Deploy / rollback

- Frontend static build.  
- Rollback = revert PR.  
- No migration, no feature flag required.

---

## Implementation order

1. T1 pure filter + tests  
2. T2 wire ReviewCard label/empty  
3. T3 edit highlight  
4. T4 ReviewCard tests  
5. Manual: open Review Queue, expand card, Edit conflicts, confirm left border + no conflict bullets above table  

---

## Implementation checklist

- [ ] **T1 (P1)** — `needs-attention.ts` filter + unit tests  
- [ ] **T2 (P1)** — ReviewCard label once + hide empty  
- [ ] **T3 (P1)** — Edit mode left border on Needs attention only  
- [ ] **T4 (P1)** — ReviewCard tests for suppress / title / edit class  
- [ ] **T5 (P2)** — Copy only if humanize insufficient  
- [ ] **T6 (P3)** — Spec status note  

**Verify:**  
```bash
cd frontend && pnpm exec vitest run src/components/review/
```

---

## TODOS (deferred, not this PR)

| What | Why | Effort | Priority |
|------|-----|--------|----------|
| #167 class grouping UI | Full taxonomy | M | P2 |
| Queue chips for needs-pick / master | List scannability | S–M | P3 |
| Primary CTA banner multi-candidate | Stronger hierarchy | S | P3 |

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | HOLD SCOPE; 0 expansions; approach A; 0 critical gaps |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | not run |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | recommend before/after implement |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | design already approved in chat; optional lite pass |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | n/a |

- **VERDICT:** CEO CLEARED (HOLD SCOPE) — ready to implement. Eng review recommended after code lands (or run `/plan-eng-review` on this plan if preferred before code).
- Completeness of chosen approach A for stated goals: **8/10** (caps 2 bullets; no full taxonomy).

NO UNRESOLVED DECISIONS
