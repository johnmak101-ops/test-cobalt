# Master-Resolution Management — Design Spec

- **Date:** 2026-07-08
- **Branch:** `feat/master-resolution-management`
- **Status:** approved (design), pending plan

## Problem

`tracking.master_resolution` holds the highest-churn business facts in the system — vendor aliases, customer/vendor groups, canonical folds, roles (e.g. `SEH → Primark`, `MACAU FUNG TAI → MACFUN`, `AEOW/BLUI → AMERICAN_EAGLE`). These change as customers, vendors, and buying groups change. Yet they have **no runtime edit path**:

- The only way to create most kinds (`vendor_alias`, `customer_canonical`, `customer_group`, `customer_role`, `vendor_group`) is to edit a hardcoded TypeScript array in `backend/src/db/seed.ts` (or the legacy `seed-entity-facts.ts`) and reseed. `vendor_name_marker` / `forwarder_ref` are read by the vendor/forwarder guard but nothing ever writes them.
- The curator loop (`POST /masters/curate`) only auto-proposes `consignee_for_customer` and `customer_vendor`, and only from ≥3 evidence emails; a human approves/rejects — but there is **no UI** for even that.
- `seed.ts` **truncates** `tracking.master_resolution` (plus `app_settings` and `alerts.alert_rules`) on every run, so any runtime correction — an approved proposal, an admin-tuned alert threshold, an admin-changed confidence threshold — is **wiped on the next reseed**.
- Two seed sources disagree on `SEH`: `seed.ts` seeds it as `customer_canonical → PRMK` (auto-fold), while `seed-entity-facts.ts` seeds it as `customer_group → PRIMARK` (sibling, "stays reviewed"). Contradictory, and both survive because `(kind,lhs,rhs)` differs.

The **read side is already correct** — the ShipTrack committer (`canonicalCode`, `customerGroupOf`) and the cobalt-queue parser (`GET /api/masters/resolution` → `overlayDbFacts`) both consume the table as data. Only the **write / manage side** is missing. This spec builds it.

## Goals

1. ADMIN can **create / edit / deactivate / reactivate** any `master_resolution` fact at runtime through a Settings tab.
2. The **curator proposals inbox** (approve / reject) gets a UI.
3. `seed.ts` becomes **non-destructive** for admin-owned config (`master_resolution`, `app_settings`, `alert_rules`) so runtime edits survive a reseed.
4. Retire `seed-entity-facts.ts`; `seed.ts` is the single bootstrap.
5. `SEH` becomes editable data with a safe bootstrap default, not a code decision.

## Non-goals (separate follow-ups — logged in `TODO.md`, not built here)

- Code-only resolver tables in `masters.repository.ts` (`PORT_ALIASES`, `IATA_TO_UNLOCODE`, `ABBREV_OVERRIDE`, `NAME_CONTAINS_ALIASES`) and cobalt-queue's soul (`prompts/cobalt-parser.md`) + `validate.ts` party rules. Ports especially have no data home — its own migration later.
- Making ERP-owned masters (customers / vendors / forwarders / ports / consignees) editable — governance keeps them read-only mirrors.
- The other DB-split items: cobalt-queue `docker-compose` DB name → `cobalt_queue`, and the `graphAttachmentId` test (both live in `/d/cobalt-queue`).
- Fixing the pre-existing commented-out `SUPERADMIN` guard on the alert-rules write endpoint (noted, out of scope).

## Data model

Add one column to `tracking.master_resolution`:

```
active boolean NOT NULL DEFAULT true
```

- **Deactivate** = `active = false` (keeps the row + audit; reversible). **Reactivate** = `active = true`.
- All **consumers** read `status = 'approved' AND active = true`.
- Rationale for a flag over reusing `status = 'rejected'`: `rejected` means "a proposed fact a human declined"; deactivation means "a live fact we turned off". Keeping them distinct preserves the proposal lifecycle and audit meaning. Mirrors the existing `users.active` column.

Migration (drizzle, additive + snapshot):
1. `ALTER TABLE tracking.master_resolution ADD COLUMN active boolean NOT NULL DEFAULT true;` (backfills existing rows to active).
2. One-time SEH cleanup so the new bootstrap default doesn't coexist with the stale fold: `DELETE FROM tracking.master_resolution WHERE kind = 'customer_canonical' AND lhs = 'SEH' AND source = 'seed';` (only removes the seed-sourced stale row; prod is empty, demo DBs get cleaned).

## Backend (NestJS — extend `masters.controller` / `masters.service` / `masters.repository`)

Endpoints (all new writes `@Roles('ADMIN')`; existing consumer read unchanged):

| Method + path | Role | Behaviour |
|---|---|---|
| `POST /masters/resolution` | ADMIN | Create `{ kind, lhs, rhs, reason }` → `status='approved'`, `source='ops'`, `active=true`, `createdBy=user`. **Supersede-then-insert:** first deactivate any existing active row with the same `(kind,lhs)`, then upsert the `(kind,lhs,rhs)` row (an exact deactivated duplicate is reactivated via `onConflictDoUpdate` setting `active`/`reason`/`updatedAt`). |
| `PATCH /masters/resolution/:id` | ADMIN | Edit `{ reason }` only (metadata). Changing a mapping = add a new fact (which supersedes the old), since `rhs` is part of the `(kind,lhs,rhs)` identity. |
| `POST /masters/resolution/:id/deactivate` | ADMIN | `active=false`. |
| `POST /masters/resolution/:id/reactivate` | ADMIN | `active=true` — also supersedes any other active fact with the same `(kind,lhs)`. |
| `GET /masters/resolution/manage` | ADMIN | All `status='approved'` facts incl. deactivated — the admin table source. |
| `GET /masters/resolution` | (unchanged) | **Contract preserved**; now filters `status='approved' AND active=true`. This is what cobalt-queue + the committer overlay consume. |
| `GET /masters/proposals`, `POST /masters/curate`, `POST /masters/proposals/:id/approve\|reject` | unchanged | Existing curator loop. |

Repository changes:
- `listResolution('approved')` (consumer path) → add `active = true`.
- New `listResolutionManage()` → `status='approved'` regardless of `active`, ordered by kind then lhs.
- New `createOpsFact({kind,lhs,rhs,reason,createdBy})` → deactivate same-`(kind,lhs)` actives, then upsert `(kind,lhs,rhs)` as active (reactivates an exact duplicate).
- New `patchReason(id, reason)`, `setActive(id, boolean)` (reactivate also supersedes same-`(kind,lhs)` actives).
- `canonicalCode()` and `customerGroupOf()` → add `active = true` to their WHERE.

**Invariant:** at most one `active` fact per `(kind, lhs)`. `canonicalCode` / `customerGroupOf` (and the cobalt-queue overlay's last-write-wins per key) take a single value per subject, so a second active fact would be nondeterministic. `create` and `reactivate` enforce it by superseding.

DTOs / validation: `kind ∈ MASTER_RESOLUTION_KIND`; `lhs` non-empty (trim); `rhs` optional (nullable per schema — some kinds carry the payload in `lhs`); `reason` optional string.

## Seed (`backend/src/db/seed.ts`) — non-destructive

- **Remove** `tracking.master_resolution`, `tracking.app_settings`, and `alerts.alert_rules` from the `truncate … restart identity cascade` statements.
- Seed `master_resolution` facts with `onConflictDoNothing` (bootstrap-if-absent) — admin edits, deactivations, and `ops` facts survive a reseed.
- `app_settings.confidence_threshold` (85) → `onConflictDoNothing` (don't clobber an admin value).
- `alert_rules` A1/A2 → `onConflictDoNothing` on `id` (preserve admin-tuned thresholds).
- Demo **transactional** data (bookings, shipments, review_email, ingest.*, milestones) still truncates + reseeds — that's an intended demo reset. `master_resolution` stores codes (not FKs to masters), so it is independent of the masters truncate.
- **Retire `seed-entity-facts.ts`:** its unique rows are either redundant with cobalt-queue's own parser baseline (`vendor_alias` / `customer_vendor` / `consignee_for_customer` — verified in the audit; ShipTrack never reads those kinds) or deliberately trimmed groups (`TORY`-self / `TOJP` / `CFUK` / `CLLC`). Delete the file and remove the `seed:entity-facts` script from `backend/package.json`.
- **SEH reconciliation:** change `seed.ts`'s SEH row from `customer_canonical → PRMK` to `customer_group → PRIMARK` (fail-safe: stays distinct, routes to review), now editable in the UI.

## Frontend (React — mirror the existing `UsersSettings` + `use-users` + api-layer pattern)

- `pages/SettingsPage.tsx`: add nav item `{ to: '/settings/resolution', label: 'Resolution Rules' }` + path detection + render `<ResolutionRulesSettings/>`.
- Router (`App.tsx`): register `/settings/resolution`, ADMIN-gated like the other settings routes.
- New `components/settings/ResolutionRulesSettings.tsx`:
  - **Facts table** (from `GET /masters/resolution/manage`), grouped by `kind`, columns: kind · lhs · rhs · reason · source · active. Row actions: **Edit** (rhs/reason), **Deactivate / Reactivate**.
  - **Add fact** form: `kind` select, `lhs`, `rhs`, `reason`.
  - **Proposals inbox** (from `GET /masters/proposals`): pending rows with **Approve / Reject**.
- New `hooks/use-resolution.ts`: mirror `use-users.ts` — queries (manage list, proposals) + mutations (create, patch, deactivate, reactivate, approve, reject) with the repo's refetch/optimistic pattern.
- api layer: add the endpoints.
- Tab + actions gated to ADMIN+.

## Testing (TDD)

**Backend (vitest):**
- `masters.service`: `createOpsFact` sets `source='ops'` / `status='approved'` / `active=true`; `deactivate`/`reactivate` flip `active`; `patch` edits `rhs`/`reason`; `manage` list includes deactivated; consumer `resolution()` **excludes** deactivated.
- `masters.repository`: upsert **reactivates** a deactivated duplicate; creating a fact for a `(kind,lhs)` that already has an active fact **deactivates the old** (single-active invariant); `canonicalCode` / `customerGroupOf` ignore `active=false` rows.
- seed: a reseed **preserves** an existing `ops` fact and a deactivated fact (assert the truncate list excludes these tables and the inserts use `onConflictDoNothing`).
- migration applies cleanly; `active` backfills `true`.

**Frontend (vitest + testing-library):**
- `use-resolution`: each mutation hits the correct endpoint; lists query correctly.
- `ResolutionRulesSettings`: renders grouped facts, add/edit/deactivate flows, proposals approve/reject.

## Consumers / compatibility

- **cobalt-queue:** no code change. `GET /api/masters/resolution` keeps its row shape and now returns only `active` facts, so deactivation is honoured automatically over HTTP.
- **committer:** `canonicalCode` / `customerGroupOf` gain the `active` filter.
- No breaking API changes — the consumer GET contract (shape) is preserved; only its filter tightens.

## Risks / notes

- After this change, `pnpm seed` no longer resets `master_resolution` to pristine on a **dirty demo DB** — a full reset is a fresh schema + migrate. Acceptable (YAGNI on a `--reset-facts` flag); document in the seed header.
- Deactivating a fact hides it from consumers by design — document in the UI.
- The green baseline to protect: 328 backend + 62 frontend tests, tsc/build clean (per `build-infra-gotchas`).
