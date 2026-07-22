# Alert Rules — Single-Severity Redesign (Design Spec)

Approved interactively on 2026-07-22 (mockup iterated in-chat; final revision confirmed by the user: "one threshold for rule. then choose severity, no state, Both rules fire days after ETD" + "yes" to dropping auto-escalation).

## Goal

Replace the paired warning/critical alert-rule model with two single-severity rules, each with one editable threshold (days after ETD), a user-chosen severity, and per-rule country overrides — presented mockup-style in the existing Settings → Alert Rules tab.

## Rule catalog (after this change)

| DB id | Name | Anchor | Watch-for | Factory default | Editable |
|-------|------|--------|-----------|-----------------|----------|
| A1 | No Draft BOL received | days_after `etd` | `draft_bl` | 1 day, WARNING, enabled | threshold 0–30d, severity (Critical/Warning/Info), enabled, country overrides |
| A3 | No Final BOL received | days_after `etd` | `final_bl` | 3 days, WARNING, enabled | same |
| A2, A4 | *(retired critical tiers)* | — | — | disabled + locked | not shown, not editable |
| A7 | CRD revision built-in | — | — | disabled + locked (unchanged) | not shown |

- **Auto-escalation is dropped** (user-confirmed): each rule fires once at its chosen severity. A2/A4 are retired by migration (disabled + locked, open alerts resolved), never deleted (alerts FK/history preserved).
- Display uses the real DB ids (A1, A3) as small mono chips.

## UX (per approved mockup)

Settings → Alert Rules tab (route, page-access gating `alert_rules`, tab visibility unchanged). Per non-locked rule, one Card:
- Header row: mono id chip · rule name · severity Badge (reflects current draft severity) · enable toggle (right).
- Description line.
- Controls row: "Threshold — days after ETD" DaysStepper (0–30) · "Severity" select (Critical / Warning / Info). **No State field.**
- "Country of origin (custom days)" sub-panel: five tiles — CN China, BD Bangladesh, KH Cambodia, VN Vietnam, IN India — each an optional DaysStepper (1–30, "Default" = inherit). Override = that rule's absolute days-after-ETD for that origin (no warn/critical delta math).
- Page header buttons: **Reset to defaults** (true factory reset via new endpoint, with a browser confirm) and **Save changes** (dirty-gated). The old Discard button is dropped (approved mockup has exactly these two).

## API / backend behavior

- `GET /alert-rules` unchanged (UI days shape via `toUiAlertRule`).
- `PUT /alert-rules` gets a real class-validator DTO (`SaveAlertRulesDto`): id required; thresholdDays int 0–30; severity ∈ CRITICAL/WARNING/INFO; enabled boolean; countryThresholds free-form map sanitized server-side (codes ∈ {CN,BD,KH,VN,IN}, days int 1–30 → stored ×24 hours). Severity pinning (A1/A3→WARNING, A2/A4→CRITICAL) is **removed**; client severity is honored. Locked-rule skip now checks the **server** row, not the client payload. `countryThresholds` absent from a payload item = leave stored overrides untouched (explicit null clears). Active-alert presentation sync + disable-resolve + immediate re-eval behavior unchanged; sync message now sourced from the server row's description.
- New `POST /alert-rules/reset` (`@PageWrite('alert_rules')`): restores factory defaults for A1/A3 (threshold, severity WARNING, no country overrides, enabled) by reusing the save path, so it also re-evaluates and returns `{ rules, eval }`.
- Factory catalogue shared between seed and reset via new `backend/src/alerts/alert-rule-defaults.ts`.
- Migration `0018`: resolve open A2/A4 alerts (ACTIVE + SNOOZED, dedup-key freeing like `resolveAllActiveForRule`), then set A2/A4 `enabled=0, locked=1`.
- Seed rework: two-row catalog; retire everything else as `enabled=0, locked=1`; structural sync for A1/A3 updates identity fields only (name/description/anchors) and **never clobbers user-tuned thresholdHours/severity/enabled/countryThresholds** (today's seed resets all of these every run — that stops).

## Cleanup (stale surfaces removed)

- Standalone `frontend/src/pages/AlertRulesPage.tsx` + `/alerts/rules` route + the "Alert Rules" button on AlertsPage (it edits with the old semantics and no page-gated write UX). Settings tab is the single editor.
- Ungoverned duplicate read `GET /alerts/rules` on AlertsController (+ `AlertsService.rules()` if otherwise unused) — the governed `GET /alert-rules` is the one true read path.

## Out of scope

- Alert engine (`alert-rules.ts`, evaluator, scheduler) — untouched; it already supports everything above.
- Alerts list page, dashboard tiles, notifications — unchanged (they read fired alerts, not rules).
- The fuller PRD A1–A6 catalog (cutoff/telex/ETA rules) — explicitly rejected by the user in favor of the two ETD rules.
