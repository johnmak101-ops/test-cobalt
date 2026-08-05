# Alert rules and messages

_How the threshold rules and operator-facing text work (as shipped)._

## Product rules (customer Settings)

**Two single-severity rules.** Thresholds are **days after ETD**; the severity is the user's choice,
not a second row.

| Rule | Watch | Factory default | Factory severity |
|------|-------|-----------------|------------------|
| **A1** | Draft B/L still missing | ETD + **1 day** (`thresholdHours: 24`) | WARNING |
| **A3** | Final B/L still missing | ETD + **3 days** (`thresholdHours: 72`) | WARNING |

- Settings UI edits **days** (`thresholdDays`); the DB and evaluator store **hours**
  (`thresholdHours` = days × 24) so deadlines land on real timestamps.
- Optional **country overrides** — `CN`, `BD`, `KH` (`ALERT_COUNTRY_CODES`) — are also absolute days
  after ETD in the UI, stored as hours. Looked up by **key presence**, so an explicit `0` is honoured.
- The factory catalogue is `backend/src/alerts/alert-rule-defaults.ts`. `pnpm --filter backend seed`
  is the one way back to factory thresholds (`POST /alert-rules/reset` was removed with its button,
  2026-07-23). Re-seeding never clobbers user-owned thresholds, severity or country overrides.

> **A2 and A4 are RETIRED** (migration `0019_retire_alert_rule_pairs`, 2026-07). They were the
> CRITICAL tiers of the old warn/critical pairs. The rows are disabled + locked and their open alerts
> resolved — kept, never deleted, because `alerts.rule_id` is an FK and the history matters. A single
> missing document no longer escalates WARNING → CRITICAL on its own; one rule carries one threshold
> and the severity the customer chose.

A5/A6 (telex / delivery) and A7 (CRD revision) are not on the customer Settings page; A7 is a built-in
evidence check.

## When a rule stands down

`isFiring` (`backend/src/alerts/alert-rules.ts`) suppresses an alert when:

- the rule is disabled, or the leg is not in the rule's configured staircase state;
- the anchor date (`triggerReference`, e.g. ETD) has not been reached — not applicable yet;
- `watchMet` — the awaited thing arrived;
- **the cargo is delivered and the watch is pre-arrival.** `PRE_ARRIVAL_WATCHES` = `so`, `draft_bl`,
  `final_bl`, `sailed`: a document chase you cannot act on is noise. This is what let a DELIVERED leg
  carry a CRITICAL *"175 days after ETD; chase Final B/L"* banner. `telex` and `invoice` deliberately
  stay live after delivery — freight payment and the commercial invoice are routinely still outstanding.

An AIR leg's MAWB counts as its final transport document (`finalDocumentReceived`) — there is no B/L
to wait for.

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
  severity + message when thresholds change. Cadence: `ALERT_EVAL_INTERVAL_MS`, default 15 min;
  `0` disables the schedule. Manual tick: `POST /api/alerts/evaluate` (EDITOR).
- Stale wording on an ACTIVE alert clears on the next successful evaluate after deploy.
- Retirement is permanent: `0019` resolved SNOOZED as well as ACTIVE alerts for A2/A4, so a snoozed
  alert of a dead rule cannot resurface.

## Code map

| Piece | Path |
|-------|------|
| Pure rule + message | `backend/src/alerts/alert-rules.ts` |
| Factory catalogue + country codes + retired ids | `backend/src/alerts/alert-rule-defaults.ts` |
| Fire / resolve / insert | `backend/src/alerts/alert-evaluator.service.ts` |
| Seed (structural sync only — never thresholds/severity/enabled) | `backend/src/db/seed.ts` |
| Settings days UI | `frontend/src/components/settings/AlertRulesSettings.tsx` |
| Alert card | `frontend/src/components/alerts/AlertCard.tsx` |
| Endpoints | [api.md](api.md#alerts) |
