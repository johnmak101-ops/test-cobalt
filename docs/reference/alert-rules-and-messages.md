# Alert rules and messages

_How A1–A4 thresholds and operator-facing text work (as shipped)._

## Product rules (customer Settings)

Two product cards, each with a **warning** and **critical** row. Thresholds are **days after ETD**.

| Rule | Severity | Default (days after ETD) | Watch |
|------|----------|--------------------------|--------|
| **A1** | WARNING | 1 | Draft B/L still missing |
| **A2** | CRITICAL | 2 | Draft B/L still missing |
| **A3** | WARNING | 3 | Final B/L still missing |
| **A4** | CRITICAL | 7 | Final B/L still missing |

- Settings UI edits **days** (`thresholdDays`).
- DB / evaluator store **hours** (`thresholdHours` = days × 24) so deadlines use real timestamps.
- Optional **country overrides** (CN / BD / KH / …) are also absolute **days after ETD** in the UI, stored as hours.
- A5/A6 (telex / delivery) and A7 (CRD revision) are not on the customer Settings page; A7 is a built-in evidence check.

## Severity UX

| Badge | Meaning |
|-------|---------|
| **WARNING** | Soft overdue — chase soon (A1 / A3) |
| **CRITICAL** | Hard overdue — escalate (A2 / A4) |

Same missing document can show WARNING then CRITICAL as days past ETD grow past each tier.

## Flexible messages (not seed text)

When an alert fires, the stored `alerts.message` is built live by
`formatThresholdAlertMessage(rule, facts, now)` in `backend/src/alerts/alert-rules.ts`:

- **What is missing** — from `watchFor` (e.g. Draft B/L, Final B/L)
- **Anchor date** — from `triggerReference` (product rules: **ETD** + calendar day)
- **Elapsed** — days after that anchor at evaluate time
- **Threshold** — configured days (including country override)
- **Next step** — derived from `watchFor`, not from a hardcoded rule-id map

Example:

> No Draft B/L — 2 days after ETD (2026-02-01); threshold is ETD + 1 day. Contact forwarder for Draft B/L.

`alert_rules.description` remains a static Settings / docs blurb only. The Alerts UI shows
`alert.message` (no separate frontend `ACTION_BY_RULE` map).

A7 already used a fact-based sentence; threshold rules now follow the same idea.

## Evaluate cycle

- Scheduler / `AlertEvaluatorService.evaluate()` fires new rows and **refreshes** ACTIVE
  severity + message when thresholds change.
- Stale wording on an ACTIVE alert clears on the next successful evaluate after deploy.

## Code map

| Piece | Path |
|-------|------|
| Pure rule + message | `backend/src/alerts/alert-rules.ts` |
| Fire / resolve / insert | `backend/src/alerts/alert-evaluator.service.ts` |
| Seed defaults | `backend/src/db/seed.ts` (`ALERT_RULE_ROWS`) |
| Settings days UI | `frontend/src/components/settings/AlertRulesSettings.tsx` |
| Alert card | `frontend/src/components/alerts/AlertCard.tsx` |
