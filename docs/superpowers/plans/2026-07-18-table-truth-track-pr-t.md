# Table-truth track PR-T (P4 + P5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development.

**Goal:** Harden track PO style enrichment (specific beats superset), truthful conflict flags, backfill broadcast styles, collapse PO card UI.

**Architecture:** Change pure `resolvePoEnrichment` / `planPoReconcile` first (TDD); wire reason strings; UI collapse; ops backfill script over stored evidence.

**Tech Stack:** NestJS, Kysely, Vitest, React.

## Global Constraints

- De-correction: T1b is flag-only (never drop model values).
- Specific-beats-superset for `item_style_no` (fewest comma-tokens, newest among ties); #124 OCR family still among specifics.
- Conflict message: symmetric-diff only via `summarizeStyleConflict`; `isRecomputedDataIssueReason` accepts old + new formats.
- Backfill: dry-run default, `--apply` to write; never demo DB; no re-parse.
- PR-T only — queue P1/P2/P3/P6 are separate PRs.

---

### Task 1: T1a + T1b in po-enrichment
### Task 2: T2 summarizeStyleConflict + planPoReconcile + isRecomputed
### Task 3: Frontend review-reason patterns + PO card collapse
### Task 4: Backfill script
### Task 5: Verify + commit
