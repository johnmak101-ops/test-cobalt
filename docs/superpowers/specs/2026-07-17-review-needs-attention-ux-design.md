# Review Card — Needs attention UX (simple)

**Date:** 2026-07-17  
**Status:** Approved direction (mockups 5 / 9–11); awaiting implement plan  
**Repo:** cobalt-shiptrack (`frontend` Review Queue / ReviewCard)  
**Related:** #166 (ingest reason dedupe — shipped), #168 (bare field-conflict bullets — shipped), #167 (full taxonomy — **out of scope for this slice**)

## Problem

Operators see a flat “Why review?” list that:

- Mixes **decision context** (which shipment, master miss) with **field-conflict noise** (counts / duplicate prose)
- Sometimes **repeats** section labels or the same idea as the conflict table below
- In edit mode, nothing **gently** draws the eye to non-table issues

The conflict table already owns **System vs Email** comparison. Why/Needs attention must not re-teach that.

## Goals

1. **Needs attention** is a short, non-repeating block: one title, 1–2 concrete lines.
2. **No field diffs** in that block when a conflict table is present (or when conflict riskFlags already cover the category).
3. **Edit mode** only: subtle highlight of the Needs attention block (left border), not a redesign of the table.
4. **Conflict table** stays as today (columns, interaction, layout) — no big visual rewrite.
5. Build on existing `whyReview` union + `humanizeReasons` / `categorizeReason` (#168).

## Non-goals

- Full #167 layman class cards / multi-class taxonomy UI
- Wizard flow (pick job → fields → approve)
- Queue list redesign
- Changing gate/matcher auto-apply logic
- Redesigning Source emails or CandidateLegsPanel chrome (may stay as-is; only Needs attention styling changes)

## Information architecture

| Region | Responsibility |
|--------|----------------|
| Identity header | Customer, booking, route, band (unchanged) |
| **Needs attention** | **Only** non-field decision context |
| Field conflict table | **Only** place for field comparison (unchanged behavior) |
| Candidate legs / identify | Unchanged components |
| Actions | Approve / Dismiss / Save & Approve as today |

### What belongs in Needs attention

Include (examples):

- Multiple matching legs / ambiguous match
- PO already on another shipment (if not collapsed into one line with multi-match later)
- Master miss (forwarder / port / customer)
- Weak identity / bare orphan (“is this a real booking?”)
- Extraction / missing attachment (if still medium+ and not better owned elsewhere)

Exclude when conflict table or conflict-class flags already explain:

- `N field conflict(s)` / unresolved field conflict counts
- `backend conflict on …` (table + riskFlags own this)
- Any bullet that only restates table fields (Qty, G.W., CBM)

Rule (implementation): when building display list for Needs attention, **drop** reasons where `categorizeReason(raw) === 'conflict'` **if** either:

- `criticReview.conflicts.length > 0`, or
- any riskFlag maps to category `conflict` via `RISK_CODE_CATEGORY`

(Aligns with #168 suppress logic; may already be partially true — make explicit for this section.)

### Title once

- Section label appears **exactly once**: `Needs attention` (or keep `Why review?` if product prefers one string — pick **one** product string; default **Needs attention**).
- Do **not** nest a second heading with the same words inside a card.
- Bullets are content only (“Matched 2 jobs — pick below”), not “Needs attention: …”.

## Visual design (edit vs view)

### View mode

- Muted section label
- 1–2 plain text lines (or empty section hidden if no items)
- No strong color wash

### Edit mode

- **Only** the Needs attention container gets:
  - ~2px left border in warning/amber token (e.g. `border-status-warning` or existing warning color at low emphasis)
  - Optional background: at most ~3–5% brighter than card surface — **no glow, no outer ring, no large tint panel**
- Conflict table: **no** new edit-mode chrome beyond what exists today

### Reference mockups (session)

- Structure baseline: simple card (session `images/5.jpg`)
- Subtle edit highlight: `images/9.jpg` / `images/11.jpg`
- Scope: only Needs attention changes; table stays — `images/10.jpg` intent
- Rejected: heavy grouped cards repeating field comparison (early `images/4.jpg` style for conflicts)

## Component mapping

| Today | Change |
|-------|--------|
| `ReviewCard` `whyReview` list (`data-testid="why-review"`) | Rename label to Needs attention (or alias); filter conflict-class when table/flags cover; edit-mode class on wrapper when `editing === true` |
| Conflict table / `ConflictRow` | **No intentional visual redesign** |
| `review-reasons.ts` | Reuse; no new taxonomy system in this slice |
| `editing` state (already on card for conflict edit) | Drive Needs attention highlight |

## Copy examples

| Situation | Bullet (EN) |
|-----------|-------------|
| Multi candidate | Matched more than one job — pick the right one below |
| Master port miss | Port of Loading not linked to the port list |
| Weak identity | No booking/SO/HBL — confirm this is a real shipment |

Do not use bare `3 field conflict(s)` in this section.

## Empty states

- If after filtering there are **zero** Needs attention lines: **hide** the whole section (do not show empty “Needs attention”).
- Field-only provisional legs: operators still see the conflict table; optional one-line AI summary above remains as today if present.

## Accessibility

- Edit highlight is not color-only: left border + optional background.
- Section remains a list (`ul`/`li`) or equivalent with accessible name “Needs attention”.
- Do not rely on glow for meaning.

## Testing

1. Unit/component: with conflict riskFlags + `3 field conflict(s)` in `reviewReasons` → Needs attention does **not** show the bare count line; conflict table still renders.
2. Unit/component: multi_id + master_miss only → both appear under single “Needs attention” title (title once).
3. Component: `editing === true` → wrapper has edit highlight class; `editing === false` → no highlight.
4. Regression: existing ReviewCard approve/dismiss/conflict edit flows unchanged.

## Rollout

- Frontend-only presentation.
- No API contract change.
- Can ship behind no flag if risk is low (presentation only).

## Success criteria

- Operators do not see repeated “Needs attention” headings.
- Operators do not see field-conflict restated above a table that already compares values.
- Entering edit mode makes the Needs attention block **noticeable but quiet** (left border).
- Conflict table looks and behaves as before.

## Follow-ups (not this slice)

- #167 full class grouping UI
- Queue list chips for “needs pick / needs master”
- Primary CTA banner for multi-candidate (optional later)

## Approval

- Product direction confirmed in chat: like simple card (5), edit highlight subtle (9/11), **only** Needs attention changes, no big table changes, **no repeating** section title.
