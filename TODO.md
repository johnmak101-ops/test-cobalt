# ShipTrack — deferred / open work

Fabric SQL migration and Kysely ports are **done** (see `docs/architecture/fabric-sql-migration.md`,
`docs/architecture/adr-database-platform.md`).

## Active themes

- Mesh / master miss UX (forwarders not in Mesh still surface as review ops notes)
- Review desk / Hybrid-C residual polish
- Docker + dual-stack test deploy with cobalt-queue (`docs/ops/docker-deploy.md`)

### Committer party re-resolve — no integration test (2026-07-28)

`CommitterService.reResolveBookingParties` cures the third stale-master-FK path: the committer writes
`vendor_raw` / `customer_raw` onto the LEG while the party master hangs off the BOOKING, and
`fillBooking` is first-writer-wins — so a later email naming a different factory left the original
master linked and winning display (leg 20260405F1: `vendor_raw ELSMCO`, `booking.vendor_id SOUOCE`).

Called on all three branches (amend, sibling leg, new booking). **Covered only by reasoning and by the
sibling rule's tests in `review.service.spec.ts` — nothing exercises the committer path itself.**

What a test should prove:
- the amend path re-points the FK when a later email's raw party resolves elsewhere
- it UNLINKS (not leaves stale) when the raw matches no master
- it writes nothing when the link already agrees — no audit noise on every commit
- the two create branches do not regress a fresh booking's FK
- the raw value itself is never modified (de-correction)

The other two paths (detail edit, review correct/confirm) DO have tests — see
`ReviewService.correct — party/port corrections re-resolve the master FK` and
`ReviewService.confirm — re-links the party master to the raw the leg names`.

### Field conflicts still open pre-applied (2026-07-28) — UNBLOCKED, next up

A card opens reading `Apply 2026-09-09` before the operator has decided anything: `initialResolutions`
seeds every row from `proposedResolutionOf`. That is the same default `AI Proposed` was, one press
from overwriting a value the pipeline examined and declined — `openDecisions` strips the conflicts
the commit settled, so a row that survives to the table is one where the commit did NOT take the
email's value.

PR #397 removed the structural blocker (the cell rendered the resolution and looked up a matching
candidate, so re-seeding made the email's value vanish). Measured on the attempt: **32 failures across
3 files before, 16 after** — and the 16 are all the intended default change asserted the old way.

Remaining work:
- seed `initialResolutions` from `existingValue` instead of the proposal
- a **take** affordance on single-candidate rows (tick, same gesture as the PO grid) — without it the
  email's value is readable and unreachable except by retyping it in Edit
- **Keep current** as the first radio option on multi-candidate rows — a radio cannot be un-picked,
  so a chosen candidate currently has no way back
- 16 tests, each needing a "take the value first" step against its own fixture — not a find-replace

Cost, accepted knowingly when specced: one extra click on every leg where the agent is right. The
trade is a deliberate act instead of a default.

### Native date inputs follow the browser, not the app (2026-07-28)

`<input type="date">` renders its format and calendar in the **browser UI language**; `index.html`
already declares `lang="en"` and Chrome ignores it. Not fixable from the page — the widget is
user-agent shadow DOM.

The language is cosmetic; the **format order is not**. zh-HK and en-GB give D/M/Y, en-US gives M/D/Y,
so two operators can read the same ETD filter differently — `03/04` is 3 April or 4 March. Stored data
is safe either way (the element always emits ISO).

7 inputs across 4 files (`DateRangeSelect`, `DateTimeField`, `AlertsPage`, `PurchaseOrdersPage`).
Options: leave it; swap the range **filters** to a text input pinned to `YYYY-MM-DD` (loses the
calendar, which filters rarely need); or a custom picker. Not started.

### 515 of 611 attachments have no bytes to serve (2026-07-28)

Measured on the dev DB: `611 attachments, 96 with raw_bytes, 0 with graph_attachment_id`. PR #396
made the evidence panel's list openable, so the 96 work and the rest fail with the backend's
`ATTACHMENT_UNAVAILABLE` reason shown inline instead of silently.

The remaining 515 are an **ingestion** gap, not a UI one — nothing was captured at match time and the
Graph re-fetch cannot even be attempted without a `graph_attachment_id`.

### Review grid prints a raw timestamp in Current (2026-07-28)

Date conflicts show `2026-09-05T00:00:00.000Z` on the left and a clean `2026-09-09` on the right.
`open-decisions.ts` builds `liveValues` with `toISOString()` and `currentValueOf` prints it verbatim;
nothing day-formats it for display. That file already has `DATE_COLUMNS` and a `day()` helper used by
`sameStoredValue`, so only the display path is inconsistent. Format at the point of use — formatting
at the source risks changing comparison semantics for other consumers.

### Dashboard — two decisions left open (2026-07-28)

- The 2nd KPI card still reads **Warning Alerts**; the mockup called it *At Risk*. Unclear whether
  that is a rename or a different measure (shipments at risk, not alerts), so it was left alone.
- The pipeline counts non-cancelled legs across all six stages. "Only active shipments" was NOT
  applied because **Delivered is the largest bar** (10 of 27 on seeded data) — excluding it guts the
  chart. Either drop the column or count it over a trailing window.

### Nothing from 2026-07-28 was verified visually

The browser pane reported `viewport [0,0]` all session — it composites no frames, so every check was
structural (DOM assertions, class parity, measured row heights) rather than seen. Unviewed: the
pipeline chart, the dashboard row alignment, the PO tick boxes, and an attachment click end-to-end.
Tests and builds are green; that is not the same as looking right.

## Do not re-open

- Postgres / Drizzle as primary store
- Static gold as production learning fuel (queue ADR-0002; lab gold optional on queue only)
- Treating pure 9+ digit packing tokens (`31900…`) as customer POs
