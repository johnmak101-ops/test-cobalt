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

**2026-07-29:** the desk no longer has to wait for one — `25-two-vendors-two-bls` is now in the
fixture set, and the row was READ on the running app (`Keep current — MACAU FUNG TAI LIMITED`
plus ROKNFT / GOLDEN SUN options, and `Leave blank` on the B/L row that stores nothing). Picking
one on screen was still not driven: the browser pane stopped compositing part-way through the
session, and with no frames neither synthetic clicks nor focus+Space reach React at all — the DOM
`checked` flips and the component never sees it. Do not read that as an app bug; it is the harness.

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

### 1. Lost writes — DISPROVED (2026-07-29)

Reported: "update of review queue fields and keep current, all not linked to backend."
Half of it was item 2 (keep current really did write nothing). The other half does not exist.

Driven end to end on `UXDEMO-22-one-change`, the one leg on the dev desk carrying an
ordinary — not party — field candidate. Take-tick → `Key Dates (1 change)` →
`Apply 2026-09-09`:

    shipments.eta   2026-09-05 → 2026-09-09,  review_status=confirmed, reviewed_by set
    change_log      seq 292157  eta  2026-09-05→2026-09-09  source_type='review'
    field_locks     eta = 2026-09-09

Do not re-open this without a specific leg. The reason it stayed open so long is that
the desk had exactly ONE such leg and nobody had reached it; that is now fixed at the
source — see the fixture note under item 4.

### 2. "Keep current" locks the field — BUILT (2026-07-29)

The spec was right about the shape and understated the trap. A row SEEDS from the
stored value, so `Keep current` is the checked radio on every untouched card before
anyone has looked at it. Reading a ruling off state — the obvious implementation —
would have locked every contested field of every leg on every single approval.

So the ruling is a signal of its own, not a state: `ConflictRow.onKeep`, fired from the
radio's **`onClick`**, because React fires no change event for a click on an
already-checked radio and that click is precisely the gesture that matters. `onChange`
still carries the value; the two are independent and their order does not matter
(`setResolution` only retracts a ruling when the value actually differs from stored).

- `keptFields` adds on that click, retracts on any resolution that changes the value,
  and **`Keep All Current` CLEARS it** — both the expanded bar and the collapsed row
- payload is `{ fields, keep: [...], note }`; `keep` rides `/correct` **and** `/confirm`,
  since a keep-only card writes nothing and so takes the confirm path
- backend locks each at the value read off the LEG, never one from the request; audits it
  `old === new` with `note='review: kept the stored value — nothing written, field locked'`;
  400s a field named in both `fields` and `keep`
- primary reads `Keep ETA` / `Keep 2 Fields` where it used to say "No Changes" — which was
  true of the values and false about the click. `Discard ruling` appears under the grid for
  it, because the bulk decline only renders against a pending change

Verified against the live API (backend rebuilt + restarted), not only in tests:
`confirm {keep:['vendorRaw']}` → `field_locks.vendorRaw`, a `review: kept…` change-log row,
`vendor_raw` untouched. Both rejection paths 400 with the right message.

**Known gap, deliberate.** Only the MULTI-candidate row can carry a ruling. A single-candidate
row's control is the take-tick, whose default is un-ticked — indistinguishable from untouched —
so there is nowhere to put "I looked and ours is right" without a second control on the
commonest row on the desk. Left alone rather than guessed at.

**Still unmeasured** (as flagged before coding): per PR #232 a lock no longer blocks a later
email — it wins and flags CONTESTED. So the observable effect is more contested flags, and
nobody has counted how many. 85 locks exist on the dev DB today for comparison.

### 3. Prod migrations — DONE, Fabric is at 0028 (2026-07-29)

The "no Fabric connection string on the dev box" note was wrong: the string is
assemblable from `backend/.env` — the Entra SP is the SAME app registration as the
Mesh web API, so `MESH_CLIENT_ID` / `MESH_CLIENT_SECRET` / `MESH_TENANT_ID` are the
credentials, and `parseMssqlConnectionString` switches to Entra mode on
`Authentication=Active Directory Service Principal` (it also requires `Tenant Id`).
Endpoint + DB id are in the `cobalt-prod-access-topology` memory.

Ledger read FIRST, as this section always said to: prod was at **0022**, not 0020 —
0021/0022 landed 2026-07-23. Six were missing and all six applied clean:
0023→0028.

Only 0023 touches DATA (`SEA_FCL`/`SEA_LCL` → `SEA`, then narrows the CHECK) and its
`down` cannot restore the granularity, so the blast radius was measured before
running: **5 legs total on prod**, one of them `SEA_LCL`. After: 3 AIR + 2 SEA, the
CHECK reads `mode IS NULL OR mode IN ('AIR','SEA')`, and all nine new columns are
present. The other five migrations are additive nullable columns.

`createManual` no longer fails on an unknown column.

    -- the read-only check to run before ANY future prod migration
    SELECT name, timestamp FROM kysely_migration ORDER BY name;

### 4. The suite does not reach this surface

Nine defects shipped into PR #412's branch and every one was caught by a human
looking at the screen; 1064 tests stayed green through all of them. Two were
introduced while fixing the previous one. Worth a deliberate pass: the conflict
row's rendering (miss tags, chips, option colours, which control appears) is
almost entirely unasserted, and the deskGroups filter is inline in `ReviewCard`
where no unit test can reach it — extract it to a pure function.

**The desk had no multi-candidate leg at all — fixed at the fixture (2026-07-29).**
`_inject-review-queue-samples.ts` gained `25-two-vendors-two-bls`: three vendors and two
co-current B/Ls on one leg. Every other card offers ONE value per row, which is why the
`Keep current` radio and its un-pick had only ever been seen by unit tests, and why item 1
took a whole session to disprove. Re-run the injector (`--yes`) to arm it; it restores
first, so it is safe to repeat and it re-arms `22-one-change` after that card is spent.
Note `backend/src/dev/_*` is gitignored, so this card exists on this box only — a clone gets a
desk with no multi-candidate leg again.

Watch the interaction with the auto-link below: a fixture whose "master miss" names a
company Mesh actually holds will now HEAL ITSELF on the next sync. `04-master-miss-party`
survives only because its forwarder (LEADWAY EXPRESS) is genuinely absent from Mesh —
its vendor line will disappear.

### 6. Two false warnings, both fixed (2026-07-29)

**"No Final B/L" on an air leg.** 202601256B — AIR, DELIVERED, MAWB 098-32230085,
HAWB GZL26258522, every milestone except `FINAL_BL_RECEIVED` — carried a CRITICAL
"175 days after ETD. Chase Final B/L with forwarder". `buildFacts` read the milestone and
nothing else, while the line directly above it (`so`) already read milestone OR column.

Two fixes, either of which alone clears this one: `finalDocumentReceived()` treats an
AIR leg's MAWB as its final transport document (there is no B/L to wait for), and
`isFiring` stands down every PRE_ARRIVAL_WATCHES rule once the cargo is delivered — a
document chase you cannot act on is noise. `telex` and `invoice` deliberately stay live
after delivery. The alert auto-resolved on the first evaluator tick after the restart.

Deliberately NOT `|| !!leg.hblAwbFcrNo`, which looks like the same fix: that same leg
proves a house B/L number arrives at DRAFT stage, so accepting it would silence the
genuine sea-freight chase this rule exists for.

**"in Mesh, not linked — edit the field and pick it"** over a name spelled identically to
the master. That is a lookup with one unambiguous answer, not a decision — which is why
auto-filling it does not breach de-correction: no value is corrected, the raw name is left
exactly as parsed, and only a null FK moves. The desk already refuses to make a conflict
row of it ("a row has to present a CHOICE") and then left the advice line with nothing
behind it.

`PartyRelinkService` runs after each successful Mesh sync, because timing is the whole bug:
masters mirror daily and lag ~2 months, so the commit that created the leg genuinely had no
master to link, and nothing re-asked once one arrived. Uses the same `*Exact` resolvers the
human-edit and confirm paths already call; audits each as `sourceType='system'`.

Dry run on the dev DB: 16 candidate legs → would link 4 vendors + 2 customers, and **zero
forwarders** — SEH, LOGWIN, TCI, LOGIMARK, LEADWAY EXPRESS, 纯通国际物流 are all
abbreviations with no exact master, correctly left to the LLM matcher.

Not verified live: the sweep itself only runs behind a real Mesh sync, which hits the
production ERP, so only its SQL was exercised (above) plus unit tests.

### 5. Agent churn on `consigneeAddress`

`change_log` shows the agent rewriting `\n` → space and back on the WYSE legs
across separate commits. A cobalt-queue extraction question, not track-system's to
normalise (de-correction), but it will keep generating review noise.
