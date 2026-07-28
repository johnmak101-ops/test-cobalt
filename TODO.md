# ShipTrack — deferred / open work

Fabric SQL migration and Kysely ports are **done** (see `docs/architecture/fabric-sql-migration.md`,
`docs/architecture/adr-database-platform.md`).

## Active themes

- Mesh / master miss UX (forwarders not in Mesh still surface as review ops notes)
- Review desk / Hybrid-C residual polish
- Docker + dual-stack test deploy with cobalt-queue (`docs/ops/docker-deploy.md`)

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

## Review desk — picked up 2026-07-29 (after PRs #407–#412)

All six merged to `main` (`d50a1cc`). frontend 1064 · backend 1312 · typecheck clean.
CI has been blocked on GitHub billing all along — everything below rests on local
verification plus browser walkthroughs.

### 1. Lost writes — UNRESOLVED, do this first

Reported: "update of review queue fields and keep current, all not linked to backend."
Not reproduced, and not disproved either.

Found no evidence: the one write driven end to end landed correctly —
`forwarder_raw` = LOGWIN AIR & OCEAN HONG KONG LTD, `forwarder_id` = 367,
`change_log` row with `source_type='review'`.

Two innocent explanations that fit the symptom, both correct behaviour:
- an APPROVED leg renders read-only — controls and buttons vanish, so clicking
  saves nothing because there is nothing to save with
- verdict-shape cards stage no field changes by design, yet still show fields

What was never done: drive a leg whose button actually reads `Apply N Change(s)`.
That is the only state where a write is even attempted. Of 10 provisional legs,
7 are in the queue; JOB-2026-0006 deep-links to the list instead of a card, and
UXDEMO-02 has no candidate checkboxes at all — no ordinary field candidate was
ever in front of me.

    -- after ticking an ordinary candidate (a vessel or a date, NOT a party) and applying:
    SELECT vessel_name, eta, review_status FROM shipments WHERE id = '<leg>';
    SELECT TOP 5 field, old_value, new_value, source_type
      FROM change_log WHERE entity_id = '<leg>' ORDER BY seq DESC;

Column moved + a `source_type='review'` row ⇒ writes are fine, and the real defect
is that a read-only card does not say so loudly enough. Neither ⇒ genuine lost
write, and item 2 waits.

If there is a specific leg where this was seen, that beats hunting for one.

### 2. "Keep current" should lock the field — designed, NOT built

Today it is a no-op: `fieldsToApply` only includes a field when `changesStoredValue`
is true, so keeping the stored value contributes nothing and the approve posts an
empty field set. Meanwhile the DETAIL page locks every field a human edits
(`editFields`). Same person, same judgement, two outcomes.

Lock the per-row pick, never the bulk button. Selecting "Keep current — LOGWIN"
with five alternatives underneath is the same work as typing a value. "Keep All
Current" is frequently "not now", not a per-field ruling.

- `ReviewCard` gains `keptFields: Set<string>`; the per-row radio adds, any other
  option removes, and **`Keep All Current` CLEARS it** — that line is the whole
  point and the one most likely to be written backwards
- approve payload carries them apart from `fields`: `{ fields, keep: [...], note }`
  — `fields` means "write this", these mean "do not write, but record that I ruled"
- backend approve locks each at its stored value via the same `fieldLocks.lock(...)`
  `editFields` uses; no value write, an audit of a DECISION
- write the NEGATIVE test first: `Keep All Current` on a 3-row card ⇒ `keep: []`

Decide before coding: per PR #232 a lock no longer blocks a later email — it wins
and flags CONTESTED. So the entire observable effect is that the next disagreement
surfaces as contested instead of passing silently. That is probably right, but it
will generate more contested flags and nobody has measured how many.

### 3. Prod migration 0028 — local only

`shipments.created_manually` is applied to local `cobalt` + `cobalt_test` only.
Fabric `ShipTrackDB` needs it, and per the earlier note was still missing 0021 and
0022 — so a run there applies 0021→0028 at once, with the SOUOCE fact INSERT
hanging off 0022. No Fabric connection string exists on the dev box. Until it runs,
`createManual` fails on the unknown column. Start with a read-only ledger query.

### 4. The suite does not reach this surface

Nine defects shipped into PR #412's branch and every one was caught by a human
looking at the screen; 1064 tests stayed green through all of them. Two were
introduced while fixing the previous one. Worth a deliberate pass: the conflict
row's rendering (miss tags, chips, option colours, which control appears) is
almost entirely unasserted, and the deskGroups filter is inline in `ReviewCard`
where no unit test can reach it — extract it to a pure function.

### 5. Agent churn on `consigneeAddress`

`change_log` shows the agent rewriting `\n` → space and back on the WYSE legs
across separate commits. A cobalt-queue extraction question, not track-system's to
normalise (de-correction), but it will keep generating review noise.
