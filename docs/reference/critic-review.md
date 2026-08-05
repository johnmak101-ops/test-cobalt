# Critic review (advisory)

_The agent's per-shipment assessment, carried on the decision and surfaced on the review desk.
Advisory by design: it **never** changes confirmed/provisional routing._

## What decides routing (and what doesn't)

Routing is the gate's, not the Critic's:

| Signal | Effect |
|---|---|
| `autoApply` | **Authoritative.** `true` → confirmed, `false` → provisional (route to a human) |
| `disposition` | `auto` \| `review` \| `skip`. `skip` (不需處理) acknowledges a notification/invoice with no actionable shipment data — no leg is committed |
| `confidence` (0-100) | Informational. Compared against `settings/threshold` only in the legacy score-routing path, when `autoApply` is omitted |
| `criticReview` | **Advisory only.** Displayed; never routes |
| `recommendedRouting` | Queue band-routing recommendation — shadow-only under the default `critic_routing_mode=gate` |

`GET /api/settings/routing-shadow` and `/api/settings/critic-calibration` report how the shadow band
would have routed versus what the gate actually did.

## Where it lives

| Piece | Where |
|---|---|
| Column | `shipments.critic_review` `nvarchar(max)` NULL — migration `0012_shipment_critic_review` (register new migrations in `migrate-cli.ts`) |
| Calibration | migration `0014_critic_calibration` |
| Ingest | optional `criticReview?: object` on `POST /api/decisions` (`CreateDecisionDto`) → persisted on the leg |
| Shape | `backend/src/decisions/critic-review.types.ts` (loose object at the HTTP boundary) |
| Desk UI | `frontend/src/components/review/`, `frontend/src/lib/critic-review.ts` |
| Agent fixture | cobalt-queue `test/fixtures/critic-review.sample.json` (`CRITIC_REVIEW=deterministic\|openpave`), including `conflicts[]` for contested fields |

## Payload

```jsonc
{
  "confidence": { "score": 88, "band": "high", "label": "…" },
  "summary": "…",
  "observations": ["…"],
  "priorState": { "headline": "…", "fields": [] },
  "proposedChanges": [],
  "riskFlags": [{ "code": "…", "severity": "medium", "message": "…" }],
  "conflicts": [                                  // what the desk renders as decidable rows
    { "field": "vendor_raw", "label": "Vendor", "rationale": "…",
      "candidates": [{ "value": "MACAU FUNG TAI LIMITED", "source": "…", "confidence": "high",
                       "master": { "code": "…", "name": "…" } }] }
  ],
  "recommendedHumanAction": "…",
  "reasons": ["…"],
  "matchAmbiguity": { },        // closed-set legs the email matched (≥2) → candidate picker
  "masterMisses": [{ "type": "vendor", "rawName": "…", "field": "…" }],
  "splitAudit": { "expected": 3, "actual": 2 },   // multi-booking fan-out shortfall
  "multiBookingOrigin": { "index": 1, "total": 3, "bookingNo": "…" }
}
```

Notes that matter when reading it:

- **`conflicts[]` is what the desk shows** — not `proposedChanges`. A row has to present a *choice*.
- **`candidates[].master`** is attached at response time against the Mesh mirror: an object = resolved
  (code chip), `null` = a letter-bearing name absent from Mesh ("not in Mesh" tag), absent = no claim.
- **`masterMisses`** feeds the ops worklist (`GET /api/admin/mesh-misses`). Names carrying no letter in
  any script are excluded — those are PO/booking/container numbers that leaked into a party field, and
  "add it in Mesh" is not actionable for a bare number.
- **`refusedCandidates`** is attached on read, never stored: it reconciles the queue's candidate set
  against what ShipTrack's committer would actually amend (`shipments/candidate-reconcile.ts`).

## Review desk

The queue has four views — `pending` (Active), `waiting`, `dismissed` (Rejected), `approved` —
via `GET /api/shipments/review-queue?view=`. Cards show a confidence band badge and a conflict-only
expansion. Legacy decisions with no `criticReview` render without the band or the expansion.

The conflict grid's columns are **Field · Current · AI proposed · Reference Email**
(`REVIEW_HEAD` in `frontend/src/components/review/review-table-layout.ts`). Two things the
*AI proposed* column deliberately does **not** assert:

- **Nothing in it is awaiting an apply.** Conflicts the commit settled are stripped upstream
  (`openDecisions`), so every value reaching that column is one the committer read and declined to
  write. Rows seed from the stored value, and taking one is a deliberate tick or radio.
- **Not every value came off an email.** An unlinked party's row also offers Mesh masters — each with
  its own master-code chip and an empty reference-email cell.
