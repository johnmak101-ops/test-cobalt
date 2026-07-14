# Issue #133 — Review-queue noise: reason filter, bulk dismiss, multi-HBL separation guard

Design for the track-system (cobalt-shiptrack) share of
[#133](https://github.com/johnmak101-ops/cobalt-shiptrack/issues/133). Written autonomously from the
issue's own cause analysis + acceptance criteria (the user was not available for interactive review).

## Problem

The shipment Review Queue (`/review-queue`, provisional legs) is ~68 deep; ~45 are portal/TradeLink
echoes and other non-move noise. The only action is **Approve**, which is wrong twice over for noise:
it asserts the data is correct in the audit trail, and it emits a per-field `confirm` sentinel to the
queue learning feed (ReviewService.emitConfirms) — approving a portal echo teaches the soul that the
echo's fields were right. There is no way to filter by reason and no way to clear noise in bulk.

Separately, the KOHL/YAQI thread (5 factory invoices, ≥5 distinct HBL/container identities, booking_no
always null) raised the question whether PO overlap can fuse different-identity legs into one.

## Decisions

### 1. Dismiss = stamp `dismissed_at`, keep `review_status = 'provisional'`

- `shipments.dismissed_at` already exists (used by the Unlinked-Documents dismiss). Reusing it for
  kind='SHIPMENT' legs needs **no migration** and cannot collide: every DOCUMENT surface filters
  `kind='DOCUMENT'`, and `dismissDocument` guards on kind.
- `review_status` stays `provisional`. It must NOT become `confirmed`: `activeConfirmedLegs()` feeds
  alerts/automation, and a dismissed portal echo must stay out of that surface. The DB CHECK constraint
  (`provisional|confirmed`) also stays untouched.
- Dismiss is **sticky against re-amend**: the committer's metaPatch rewrites `review_status` on every
  amend but never touches `dismissed_at`, so the daily portal re-echo does not resurface the same row.
  This is deliberate — recurring echoes are the dominant case. New evidence with a *different* strong
  identity lands on a new leg anyway (strongKeysConflict), so real moves are not hidden by a dismiss.
- Dismiss emits **no** learning confirms and **no** field locks — it says "not a trackable shipment,"
  not "these fields are right." It writes one audit row per shipment
  (`review: dismissed — not a trackable shipment`, plus the reviewer's note) — de-correction principle:
  the human verdict is recorded, nothing is silently corrected.
- **Restore** (single-row) clears `dismissed_at` + audits, so bulk mistakes are recoverable.
- Dismissed legs remain visible in the Shipments list/detail. Hiding them from tracking is the
  "stricter portal→DOCUMENT" follow-up the issue explicitly deferred; conflating it here would change
  KPI/list semantics ops did not sign off on.

### 2. Queue views + counts

- `GET /api/shipments/review-queue?view=pending|dismissed` (default `pending`).
  `pending` = provisional ∧ kind=SHIPMENT ∧ legStatus≠SUPERSEDED ∧ `dismissed_at IS NULL`;
  `dismissed` = same but `dismissed_at IS NOT NULL`.
- `reviewQueueCounts` returns `{ provisional, dismissed }`; the nav badge keeps reading `provisional`
  (now excluding dismissed). `provisionalLegs()` (the older `/api/review` list) also excludes dismissed.

### 3. Actions API (mirrors existing `/api/review` verbs, EDITOR+)

- `POST /api/review/dismiss` `{ shipmentIds: string[], note?: string }` — per id: must exist, be
  kind='SHIPMENT' and provisional; stamps `dismissed_at`/`reviewed_by`/`reviewed_at`, audits. Skips
  (does not fail the batch on) rows that are already dismissed or no longer provisional; returns
  `{ dismissed: n }`.
- `POST /api/review/:id/restore` — clears `dismissed_at`, audits, returns `{ shipmentId, restored: true }`.

### 4. Reason-category filter (client-side)

The queue endpoint already returns every row with raw `reviewReasons`; pagination is client-side, so
categorisation and filtering stay in the frontend next to the existing humanizer
(`frontend/src/lib/review-reasons.ts`):

`categorizeReason(raw) → 'portal' | 'conflict' | 'multi_id' | 'no_identity' | 'master_miss' | 'extraction' | 'other'`

- portal — committer hint `platform/portal email without carrier identity…`, policy label `…only a portal alert…`
- conflict — `backend conflict on…`, `N unresolved field conflict(s)`, policy `…disagrees with what's already on the shipment`, mode change, brand conflict
- multi_id — identity supersede, ≥2 co-current strong ids, matched multiple legs, PO/reference belongs to another shipment, moved/reassigned
- no_identity — bare-orphan hint, `neither a strong identity key nor a PO`, policy no-strong-id / no-PO, `insufficient identity…`
- master_miss — `did not exact(/curated)-match…`, unknown/new customer, `PO present but customer not known`
- extraction — vision_pending, input/output_truncated, content_filter, missing attachment, missing cargo detail, unlabeled screenshot, broadcast total
- other — everything else (cutoff notes, cancellation, …)

A shipment's category set = union over its reasons. UI: one chip row with per-category counts,
single-select (All default), composing with the Pending/Dismissed tabs and pagination.

### 5. Review Queue UI

Pending tab rows gain a checkbox column (+ header select-all for the filtered set), a per-row
**Dismiss** button beside Approve, and a bulk bar ("N selected → Dismiss") with an optional note input,
inline-confirmed (no new modal infra). Dismissed tab shows the same table with **Restore** replacing
the actions. The review detail page (ReviewShipmentPage) gets a **Dismiss** action (reuses the notes
box) and, when the leg is dismissed, a banner + Restore instead of the approve actions
(`dismissedAt` added to the shipment DTO mapper).

### 6. Multi-HBL separation — regression test only (AC1/AC2)

`findExistingLeg` already refuses to fuse legs whose strong keys conflict (same type, different value),
even when POs overlap — the exact KOHL/YAQI shape. Record-level splitting of one email into per-HBL
records is the queue repo's `groupRecords` (out of scope here). We pin the track-side guarantee with a
committer integration test: 3 decisions, same conversation, booking/SO null, distinct HBL+container+MBL,
one PO shared across two of them → 3 legs, shared PO linked to both, no fusion.

## Acceptance criteria → this design

| AC (issue #133) | Coverage |
|---|---|
| One trackable unit per conflicting HBL/container | Regression test (§6); splitting itself lives in cobalt-queue `groupRecords` |
| booking/SO null must not force a fused leg | Same test — PO overlap + conflicting strong ids ⇒ separate legs |
| Review Queue can filter / bulk-dismiss noise | §§1–5 |
| Message stays re-traceable via Graph/queue ids | Untouched — dismiss never deletes; audit adds provenance |

## Out of scope (tracked in the issue as follow-ups)

- Queue-repo (cobalt-queue) grouping/matcher changes, incl. emitting per-HBL records.
- Portal-only → kind='DOCUMENT' reclassification (changes Unlinked-Documents semantics; ops decision
  2026-07-12 currently reserves DOCUMENT for Invoice/Billing).
- "Split this email by HBL" UX on the email review queue (`review_email` is 1-email↔1-shipment today).
- Bulk restore (single-row restore only).

## Testing

- `review.int.spec.ts`: dismiss stamps + audits + skips non-provisional; restore; no learning posts on
  dismiss; provisionalLegs excludes dismissed.
- `shipment.kysely.int.spec.ts`: reviewQueue pending/dismissed views + counts.
- `committer.int.spec.ts`: multi-HBL scenario (§6).
- Frontend `review-reasons` unit tests for `categorizeReason` over the real reason strings.
