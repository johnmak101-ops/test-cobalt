# Task 2 report — Capture on confirm / correct / dismiss

## Status
**DONE**

## Summary
`ReviewService` now injects global `CriticCalibrationRepository` and, after successful confirm / correct / dismiss work, snapshots the pre-mutation leg’s critic confidence band plus human outcome via best-effort `recordCalibration` (try/catch + `Logger.warn` — never fails the human action).

## Changes
- `backend/src/review/review.service.ts`
  - Constructor: `CriticCalibrationRepository`
  - Private: `bandFromLeg`, `recordCalibration`
  - `confirm` → `outcome: 'approved'`, `correctedFieldCount: 0`, optional note as `reasons`
  - `correct` → `outcome: 'corrected'`, `correctedFieldCount: corrected.length`, optional `dto.reason`
  - `dismiss` (per successful id) → `outcome: 'dismissed'`, count 0, optional note
  - Band read from **pre-mutation** `leg` already loaded for the action
- `backend/src/review/review.service.spec.ts`
  - `makeService` wires mock `calibration.insert`
  - New describe: Phase 3 critic calibration capture (5 cases)

## Tests
```
pnpm --filter backend test -- src/review/review.service.spec.ts
```
- TDD: 4 fail (no insert) → after impl: **25 passed**

## Commit
`feat(review): snapshot critic band vs human outcome on confirm/correct/dismiss`

## Concerns
- Nest DI: repo is `@Global()` via `RepositoriesModule` — no module wiring change needed.
- `restore` intentionally does **not** write calibration (out of scope / not a terminal outcome in the brief).
- Insert failures only log a warn; no metric/counter yet (fine for Phase 3 capture).

## Review fix
- `backend/test/review.int.spec.ts`: both `new ReviewService(...)` call sites now pass `r.criticCalibration` as the 6th constructor arg (matches production ctor / unit `makeService`).
- Verify: `pnpm --filter backend test -- test/review.int.spec.ts src/review/review.service.spec.ts` → **33 passed** (2 files).
- Commit: `fix(review): pass criticCalibration into ReviewService int tests`
