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

### Dashboard — two decisions left open (2026-07-28)

- The 2nd KPI card still reads **Warning Alerts**; the mockup called it *At Risk*. Unclear whether
  that is a rename or a different measure (shipments at risk, not alerts), so it was left alone.
- The pipeline counts non-cancelled legs across all six stages. "Only active shipments" was NOT
  applied because **Delivered is the largest bar** (10 of 27 on seeded data) — excluding it guts the
  chart. Either drop the column or count it over a trailing window.

### The browser pane still composites no frames (2026-07-28)

`read_page` reports `viewport [0,0]` and screenshots are unavailable, so nothing this session was
*seen*. The review-desk work below it WAS driven against the running app (vite :5173 + backend :3000,
both serving `D:\`) via DOM reads and synthetic clicks on a live queue leg — the take-tick, its
reversal, the `(1 change)` group header, the button-bar swap and the day-formatted Current were all
confirmed on real data, not only on fixtures. Still unviewed: the pipeline chart, the dashboard row
alignment, the PO tick boxes, and an attachment click end-to-end.

### Review desk — what the 2026-07-28 conflict-default work did NOT reach

Landed: rows seed from the stored value, a take-tick on single-candidate rows, `Keep current` /
`Leave blank` as the first radio on multi-candidate rows, and ISO instants day-formed at the point of
use (`resolutionForm` in `ConflictRow.tsx`).

Not covered by the live check: **no active leg carries a multi-candidate row**, so the `Keep current`
radio and its un-pick are proven by unit tests only. Worth a look the next time a two-vendor or
two-B/L leg reaches the queue.

**Corrected 2026-07-28.** An earlier note here claimed the `Edited` header and the `→ will write X`
override span were unreachable. They were not: `handleSaveAndApprove` called `setEditing(false)`
*before* the request, so a save that 400s dropped the card into READ mode still holding the typed
values — rendered as text, no input, no Cancel. An operator hit exactly that and had no way to clear
it. Fixed by leaving edit mode only after the write lands, plus a `Discard changes` control under the
grid (see below). Do not re-assert "unreachable" about UI without driving the failure path.

### Dropdowns inside the decision grid must not use `absolute` (2026-07-28)

The party/port pickers rendered their suggestion list `absolute z-30` inside their own `relative`
wrapper. Measured on the running desk, that list has **seven** clipping ancestors: `REVIEW_TD`
(`overflow-hidden`, so a long value cannot blow out a `table-fixed` cell) cuts 259px off a 266px
list, the decision-grid wrapper (`overflow-x-auto`, which computes `overflow-y: auto`) cuts another
206px, and five more above that. Operators saw one truncated option on a tall row and a ~7px sliver
on a short one, which reads as "search is broken".

`z-index` cannot fix clipping. Both pickers now position the list `fixed` via
`use-anchored-listbox.ts`, which also flips it above the input near the viewport bottom. Anything new
that drops a menu inside this grid needs the same treatment — and note the caveat in that file: a
`transform`, `filter` or `contain` on an ancestor would become the containing block and reintroduce
the bug.

### Mode change is a reclassification — the design, and what shipped (2026-07-28)

A mode change invalidates one set of transport fields and requires another. Treating it as an
ordinary field edit is what orphaned data. Four pieces were designed; all four shipped. Mockup:
`mode-change-mockup.html` (desktop).

- **1 · never hide a populated field.** Off-mode AND empty hides; off-mode AND populated always
  shows, tagged, with a one-click clear on the edit form. Before this, `SEA` + `flightNo` was
  invisible in the read view, the edit form AND the desk (`fieldsToApply` skips empty, so empty means
  "no decision" there) — present in the DB, the API and every export, reachable from nothing.
- **2 · carry-over panel on the edit form.** A pending mode change lists what it strands, ticked to
  clear, values struck through and still on screen. Rides on the same Save.
- **3a · the desk carries the consequence.** Taking a Mode from an email clears the old mode's fields
  in the same Apply, and the count includes them. This is what forced the explicit clear signal:
  `clearedColumns` posts `''` per column, because an empty resolution already means "undecided".
  `coerceLegField` maps `''` → null for every column, so a clear is an ordinary field write.
- **3b · the desk states a contradiction it did not cause.** A leg holding the other mode's fields
  gets `i-mode-mismatch` — stated, never acted on. Enumerated in `DESK_DECISION_LINE_IDS` because an
  unmapped lineId defaults to `fyi`, which the desk filters out entirely.

**Clear-by-default is deliberate and is the OPPOSITE of the review desk's take-tick default.** On the
desk, un-taking is free because the email's value is never lost. Here the values are preserved by the
shipment history, so clearing is filing rather than deletion — and a sea leg still reporting a flight
number is wrong in every downstream consumer.

**Deliberately NOT done: filtering contested rows by mode on the review desk.** Mode is itself a
contested row there, so filtering would mean choosing between the stored mode and the proposed one,
and rows would appear and vanish as the operator ticks Mode. One field silently changing which other
fields are decidable is worse than showing a contradiction.

Mode vocabulary lives in `lib/mode-fields.ts` — one place, because it was private to
ShipmentDetailPage and the desk could not ask the question. An unknown mode claims neither set, so an
unclassified leg is never called contradictory.

## Do not re-open

- Postgres / Drizzle as primary store
- Static gold as production learning fuel (queue ADR-0002; lab gold optional on queue only)
- Treating pure 9+ digit packing tokens (`31900…`) as customer POs
