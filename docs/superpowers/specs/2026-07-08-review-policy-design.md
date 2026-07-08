# Review Policy — configurable human-review triggers

- **Date:** 2026-07-08
- **Branch:** `feat/review-policy`
- **Status:** Design (approved, pre-plan)

## Problem

The review gate today is opaque and, on the live path, largely inert:

- The Agent VM (cobalt-queue) sends each decision with an authoritative `autoApply` boolean **and** an informational `confidence` score (`decisions/dto.ts`).
- On the **live agent path**, routing is `autoApply ? confirmed : provisional` — the `confidence_threshold` (85, in `app_settings`) is **ignored** (`decisions/decisions.service.ts:59-62`). The threshold only routes the **legacy manual reconcile** path (`POST /reconcile/run`, `reconcile/score.ts`).
- So the one "configurable" review knob does not affect live traffic, and "confidence ≥ 85" is not legible to an admin.

We want an **admin-legible, actually-effective** way to say *"send a decision to human review when &lt;condition&gt;"* — one that also gates live agent decisions.

## Goals

- **Legible:** checkbox triggers ("send to human review when X"), not a magic number.
- **Effective on live traffic:** applies to live agent decisions **and** the manual reconcile path.
- **Safe:** can only **ADD** review (downgrade an auto-confirm → provisional). It can never force an auto-confirm the agent withheld.
- **Extensible:** adding a trigger = one code entry (`{ id, label, predicate }`); the API and UI adapt automatically.
- **Runtime-tunable:** EDITOR+ toggles triggers with no deploy.

## Non-goals (v1)

- **No confidence-score knob.** The critic's `confidence` stays informational (shown on the leg, never a routing input).
- **No runtime rule-builder / rules engine.** Developer-extensible *catalog* only (chosen over an admin-authored engine).
- **v2 lookup triggers deferred:** new/unknown customer, sea↔air mode change, moved shipment, duplicate number, late PO — they need cross-leg lookups and the agent's own gate already flags most.
- **No change to the agent gate (VM2).**

## Design

### 1. Trigger registry (catalog)

`backend/src/decisions/review-policy.ts` exports a single ordered list. Each entry is a fully self-describing unit:

```ts
interface ReviewTrigger {
  id: string                                   // stable key stored in config
  label: string                                // plain-language UI text ("… when there's a conflict")
  predicate: (d: CreateDecisionDto) => boolean // pure, reads only the decision payload
}
```

**v1 catalog:**

| id | label ("send to review when…") | predicate |
|----|-------------------------------|-----------|
| `conflict` | there's an unresolved conflict | `(d.conflicts?.length ?? 0) > 0` |
| `no_strong_id` | there's no strong identity key (SO / booking / B-L / AWB / container) | no strong key present in `d.matchKey` |
| `no_po` | no PO is linked | `(d.pos?.length ?? 0) === 0` |
| `cancellation` | it's a cancellation notice | `d.cancelled === true` |
| `platform_only` | it's a platform-only notification (CVP / TradeLinkOne) | `d.fromPlatform === true` |
| `sparse` | the data is sparse (fewer than 2 populated fields) | populated values in `d.fields` `< 2` (matches `reconcile/score.ts`) |

Helpers (same file): `hasStrongKey(matchKey)` (checks `so_no`, `booking_no`, `hbl_awb_fcr_no`, `mbl`, `container_no`) and `populatedShipmentFields(fields)`.

**Adding a trigger later = append one row.** No API or UI change.

### 2. Config storage

- New `app_settings` key **`review_policy`** = `{ enabled: string[] }` — the list of enabled trigger ids.
- **Default `{ enabled: [] }`** (all off → zero behaviour change on deploy; admins opt in). The agent already routes genuine conflicts to review on its own; enabled triggers are an *extra* net.
- Unknown ids are ignored on read (forward/backward compatible when the catalog changes).

### 3. Evaluator

`evaluate(policy: { enabled: string[] }, decision: CreateDecisionDto): string[]` — returns the **labels** of the enabled triggers whose predicate matches. Pure, no I/O, trivially unit-testable.

### 4. Hook point (downgrade-only)

In `decisions/decisions.service.ts` `ingest()`, immediately after the existing base decision (`reviewStatus` at line ~59):

```ts
if (reviewStatus === 'confirmed') {
  const fired = evaluate(await this.settings.reviewPolicy(), dto)   // enabled + matched labels
  if (fired.length) {
    reviewStatus = 'provisional'
    reviewReasons = [...(dto.reviewReasons ?? []), ...fired]        // shown in the review queue
  }
}
```

Structurally downgrade-only: the block only runs when the base is `confirmed`, and only ever sets `provisional`. The `skip` (不需處理) disposition is untouched.

### 5. Backend API

Extend `SettingsService` + `SettingsController` (reuse the `app_settings` upsert):

- `SettingsService.reviewPolicy(): Promise<{ enabled: string[] }>` (default `{ enabled: [] }`).
- `SettingsService.reviewPolicyView()`: joins the catalog with enabled state → `{ triggers: { id, label, enabled }[] }`.
- `SettingsService.setReviewPolicy(enabled: string[], actorId)`: validates `enabled ⊆ catalog ids`, stores `{ enabled }`.
- `GET /api/settings/review-policy` → `{ triggers: [{id,label,enabled}] }` — **any signed-in user reads**.
- `PUT /api/settings/review-policy` body `{ enabled: string[] }` — **`@Roles('EDITOR')`**; rejects ids not in the catalog (400).

### 6. Settings UI

Fill the empty **General** tab (`frontend/src/pages/SettingsPage.tsx`) with a **"Review policy"** section:

- New `components/settings/ReviewPolicySettings.tsx` + `hooks/use-review-policy.ts` (`useQuery`/`useMutation` → the endpoints), mirroring `AlertRulesSettings`.
- Renders one checkbox per catalog trigger (label + enabled from the API), so it auto-adapts when a trigger is added.
- **EDITOR+ can edit; VIEWER read-only** (disable inputs + hide save when `role ∉ {EDITOR, ADMIN, SUPERADMIN}`), surfacing backend guard errors as toasts.

### 7. Permissions

Reads: any authenticated. Writes: EDITOR+ (`@Roles('EDITOR')` = EDITOR/ADMIN/SUPERADMIN). Governance surfaces (Users, Alert Rules, Resolution Rules) unchanged.

## Data flow

```
Agent VM ──POST /api/decisions──▶ decisions.service.ingest()
                                    │ base = autoApply ? confirmed : provisional   (skip untouched)
                                    │ if confirmed: fired = evaluate(review_policy, dto)
                                    │   if fired: reviewStatus = provisional; reviewReasons += fired
                                    ▼
                                 committer.apply()  ──▶ leg persisted (provisional ⇒ review queue, with reasons)

Admin (EDITOR) ──Settings ▸ General ▸ Review policy──▶ PUT /api/settings/review-policy { enabled }
                                                         └▶ app_settings.review_policy
```

## Testing

- **Evaluator unit** (`review-policy.spec.ts`): each predicate fires on the right payload and not otherwise; `evaluate` returns only enabled+matched labels; unknown ids ignored; empty policy → `[]`.
- **decisions integration** (`decisions.int.spec.ts`): agent `autoApply:true` + a conflict, `review_policy.enabled=['conflict']` → `provisional` with the reason recorded; with `enabled=[]` → `confirmed` (unchanged); a genuinely clean `autoApply:true` with the trigger enabled but not matching → `confirmed`; policy never upgrades a `provisional`/`skip`.
- **Controller** (`settings.controller.spec` / int): `GET` returns the catalog for a VIEWER; `PUT` succeeds for EDITOR, 403 for VIEWER, 400 for an unknown id.

## Out of scope / future

- **v2 lookup triggers** (new customer, mode change, moved, duplicate, late PO) — separate phase; need cross-leg context.
- **Runtime rule-builder** (admin-authored field/operator/value rules) — only if the developer catalog proves insufficient.
- **Agent-gate config (VM2)** — the real live gate; its own cross-service effort.

## Files touched

- **New:** `backend/src/decisions/review-policy.ts` (+ `.spec.ts`); `frontend/src/hooks/use-review-policy.ts`; `frontend/src/components/settings/ReviewPolicySettings.tsx` (+ test).
- **Edit:** `backend/src/decisions/decisions.service.ts` (hook); `backend/src/settings/settings.service.ts` + `settings.controller.ts` (API + DTO); `frontend/src/pages/SettingsPage.tsx` (General-tab section).
- **Tests:** `backend/test/decisions.int.spec.ts` (extend).
