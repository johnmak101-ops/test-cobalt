# ShipTrack — TODO / deferred work

Tags: `[queue]` = cobalt-queue · `[track]` = cobalt_track_system.
Context: see `C:\Users\John\.claude\plans\typed-wondering-moler.md` (merge refactor plan) and the
`merge-refactor-progress` memory. Checkpoints 1–2 + Phase 6 + Iterator→OpenCode are shipped.

## Agents & OpenPAVE
- [x] `[queue]` **LLM refiner for the Iterator — BUILT 2026-06-16 (not yet live-proven).** Was:
  `heuristicRefiner` only memorises correction *pairs* (a brittle lookup; a PROMOTE just means "no
  regression"). Now: `opencodeRefiner` (`src/iterator/refine-opencode.ts`) runs the `cobalt-refiner`
  OpenCode agent (`.opencode/cobalt-refiner.md`) to **generalise corrections into reusable RULES** in
  the soul (e.g. "consignee = the Consignee box, never the Shipper"), behind the same `Refiner`
  contract; `ITERATOR_REFINER=opencode`. Strips the heuristic block first, keeps entity value-mappings
  OUT (→ masters), only *proposes* (gate still promotes), falls back to heuristic on failure. 98 tests
  green. ⚠ Live AI pass needs a warm `opencode serve` (`OPENCODE_ATTACH=…`) — same cold-start caveat as
  the opencode critic.
- [ ] `[queue]` **OpenPAVE swap-in.** parser / matcher / critic / refiner all sit behind contracts
  (`ParserAgent`, `MatcherAgent`, `CriticAgent`, `Refiner`) with OpenCode adapters. Drop OpenPAVE in
  at each seam when ready — no rewiring.
- [ ] `[queue]` **Iterator trigger.** `run-iterator.ts` is a manual dev pass (not scheduled) and reads
  a sample `corrections.json`. Decide the real corrections source (a corrections store fed by human
  edits / field-locks) and whether/when to schedule a gated pass.

## Masters & validation
- [ ] `[track]` **Seed the curated masters facts.** `MACAU FUNG TAI → MACFUN` (and other approved
  `master_resolution` rows) are live DB-only; add them to the track-system seed so they survive a DB
  reset. (Memory: "move master_resolution seed into backend/seed.ts".)
- [ ] **Keep party/shipper fixes deterministic.** The reliable consignee fix is the `validate.ts`
  "consignee-resolves-to-a-vendor → replace with the customer's real consignee" rule + a masters
  alias — NOT parser-prompt edits (the LLM ignored the explicit per-customer guidance). Route new
  party-confusion cases to validate + masters.

## Tracking & review
- [ ] `[both]` **JOB-2026-0006 (optional, not a bug).** Stays provisional on a *genuine* two-booking-ref
  ambiguity (`B1261611448` 中外运订仓号 vs `FEL-GZ-OSA-2842`; `GZOSA2600021` vs `SOKLPO023605A`).
  Correct to flag for a human. OPTIONAL: route `中外运订仓号` → `booking_no` (not `so_no`) to separate
  them, if that convention is confirmed.
- [ ] `[queue]` **Full corpus re-parse.** Only set5/set6 + 4 emails were re-parsed with the current
  soul; set1 (FEL-GZ-OSA) evidence is older. Run one `PARSER=opencode` full re-parse (~2.4h) to refresh
  everything when convenient; re-validate (`revalidate.ts`, seconds) for validator/master changes.

## Tests & infra
- [ ] `[track]` **Integration tests** for the new paths: committer `writeIdentifiers` (history persist +
  idempotency on re-POST), the reconcile review gate (`score.ts` end-to-end), and the masters
  curator/approve endpoints.
- [ ] `[queue]` **`AZURE_API_KEY` gap.** The direct-Azure parser and `benchmark.ts` (parser recall) still
  need the key; matcher + Iterator now run via OpenCode. Either set the key, or add OpenCode paths to
  the remaining azure-only dev tools.
- [ ] `[track]` **Merge de-dup (Phase 4 follow-up).** The two merge copies (`critic/merge.ts` +
  `reconcile/merge.ts`) are hand-kept-in-sync with a "keep in sync" header. If drift becomes a risk,
  do the generated-copy + CI diff-guard from the plan.

## Fields, SCAC & email disposition (added 2026-06-25 — parser-first)
Field source-of-truth = the real `tracking.shipments` schema (`backend/src/db/schema/tracking.ts`) —
comprehensive: pol/pod, vessel, voyage, flight, mawb, ata, cfs_cutoff, qty_unit, brand + the 21 labelling
fields. `C:\Users\John\pave-apps\cobalt_track_system` is the **mock-UI reference ONLY**; real project = this
(D:). Architecture: **cobalt-queue parser is the SOLE extractor (extracts all info); track-system only
displays** — the mock's own `extractor.ts` is reference, not used. Disposition rules: see the
`cobalt-email-disposition` memory.

### [both] — VM1↔Agent candidate-shape contract (audit found this; backend-diff inert until fixed)
- [ ] `[both]` **`GET /shipments` candidates must be `BackendShipment`-shaped** `{ fields:{<snake_case parser names>}, mode, matchKey, lockedFields, matchedBy }`. Today `tracking-client.lookupShipments` returns the raw VM1 response with NO adaptation, and the runner reads `candidate.fields` / `candidate.mode`. If VM1 returns FLAT camelCase legs, `backendDiff` → `backendMismatches=[]` always (the backend-conflict + locked-field review triggers + sea↔air mode-change never fire — unsafe auto-applies). FIX: confirm VM1's actual response; add an adapter in `tracking-client` (camelCase leg → snake_case `fields` + top-level `mode`/`matchedBy`/`lockedFields`) OR have VM1 emit that shape. Add an integration test on the real response.

### [track] — deferred (doing parser first)
- [ ] `[track]` **Add SCAC** — `tracking.shipments.scac_code text` (MISSING from the real schema; rule 6).
  Migration + zod contract + Masters/Detail UI row + carrier-master validation. (Mock UI already has it.)
- [ ] `[track]` **Update/identifier coverage (rule 5: "update = change in any tracked field").** Make the
  change-history + `shipment_identifiers` paths cover the FULL field set (incl. crd, atd, scac, qty_unit,
  brand, pol/pod) — not a stale subset.
- [ ] `[track]` **Sync `reconcile/merge.ts` FIELD_CLASS** with the new fields added to cobalt-queue's
  `critic/merge.ts` (the two are hand-kept-in-sync): `ata`(schedule) + `vessel_name/voyage_no/flight_no/mawb/scac/brand/qty_unit`(text). Without this the tracking-side merge silently drops them.
- [ ] `[track]` **cfs_cutoff vs warehouse_end_date** — confirm distinct vs redundant (cheat sheet groups
  截仓/CFS cut-off = warehouse end). Decide the mapping so the parser fills the right column(s).
- [ ] `[track]` **Email disposition (matcher gates review, not the parser).** New PO+known customer→auto;
  new customer / mode-change / moved-shipment / late-PO / dup-number→review; no status update→不需處理
  (store, no human review). All emails parsed; sender-type tagged post-parse for field-trust.

### [queue] — parser (FOCUS NOW)
- [ ] `[queue]` **Parser "extract all info"** — add the fields the real schema has but the parser doesn't:
  `vessel_name`, `voyage_no`, `flight_no` (air), `mawb` (split out of `mbl`), `ata`, `cfs_cutoff`,
  `qty_unit`, `brand`, `scac`.
- [ ] `[queue]` **SCAC extraction (rule 6):** MBL carrier-prefix → carrier name→carrier master →
  carrier-direct sender domain; NOT container BIC prefix (probe: 0/31 matched a SCAC). Validate vs carrier master.
- note: `pol`/`pod` KEPT — the real schema has `polId`/`podId`; the earlier "take away" was vs the mock UI, now reverted.

## Shipped this session (reference)
supersede ≠ conflict + honest capped confidence · `shipment_identifiers` history + detail-page card ·
legacy reconcile gate · gold→tracking `track-bench --assert` · OpenCode matcher (no Azure key) ·
Phase 6 parser field-discipline (hbl/mbl + deterministic consignee fix) · Iterator scores via OpenCode
(gate 4 runs without Azure key) + per-email parse guard · refiner-boundary docs.
Result: provisional 6/9 → 2/9, confirmed 3 → 7; hbl/mbl recall 100%; 0 IDs lost to review_reasons-only.

## Contracts (deferred to handover)
- [ ] `[track]` **Re-extract the shared `@cobalt/contracts` package.** On 2026-07-07 (branch
  `refactor/inline-contracts-into-backend`) `@cobalt/contracts` was **inlined into `backend/src/db`**
  (schema + zod + `contracts.ts` barrel) with its migrations moved to `backend/drizzle/`, to make track
  self-contained and kill the drizzle shadow-store trap (nested `node_modules` → 2 `drizzle-orm`
  instances → `{}` query results). The original Phase 2 — ONE versioned schema package consumed by BOTH
  cobalt-queue and cobalt-track — is deferred to handover and will be re-extracted fresh (cobalt org,
  git-tagged) then. Spec/plan: `docs/superpowers/{specs,plans}/2026-07-07-inline-contracts-into-backend*`.

## Auth hardening — follow-ups (added 2026-07-08)
Cookie-only JWT login + server-side change-password + SUPERADMIN Users CRUD UI + Outlook-page removal
**shipped & merged to main** (PR #11, `ca55a49`; spec/plan in `docs/superpowers/{specs,plans}/2026-07-07-jwt-auth-user-crud*`).
Non-blocking follow-ups from the whole-branch review (none gate the merge):
- [ ] `[track]` **Make the last-superadmin guard transactional.** `users.service.ts` `assertNotLastSuperadmin`
  is check-then-act; two concurrent deactivations of the final 2 superadmins could both pass and reach 0
  active. Use a conditional `UPDATE … WHERE (count of active superadmins) > 1` or a tx. (SUPERADMIN-only, narrow.)
- [ ] `[track]` **e2e AppModule boot test.** No spec boots the full Nest app, so the global guard ORDER
  (`JwtAuthGuard → MustResetGuard → RolesGuard`) and the login 429 are reasoned about, not asserted. Add a
  supertest that boots `AppModule` (mustReset JWT → non-allowlisted route → 403; 11 logins/min → 429).
- [ ] `[track]` **Resolve `SESSION_TTL_HOURS` via `ConfigService`.** `auth.constants.ts` reads it from
  `process.env` at import (before `.env` loads), so a `.env`-file value is silently ignored (always 12h).
  Read via `ConfigService`, or document it as an OS/compose-env-only knob.
- [ ] `[track]` **Confirm `trust proxy: 1` at deploy.** `main.ts` trusts exactly one proxy hop (correct for
  single-hop nginx same-origin); revisit if a CDN/second proxy is added — throttler client-IP + secure-cookie
  detection depend on it.
- [ ] `[track]` **Unify guard error shape (minor).** `MustResetGuard` throws `403 {code:'MUST_RESET'}` (object)
  while `RolesGuard` throws a bare string; harmonize if a shared FE error handler ever needs it.

## Tech-debt (2026-07-08 whole-codebase `/tech-debt` audit)
The `SettingsPage` + `PresentationService` god-components were already decomposed (PR #9). Remaining:
### Guardrails (highest leverage)
- [ ] `[track]` **No CI.** ~540 tests (373 backend + 167 frontend) + tsc + builds never run on push/PR. Add one
  workflow: `pnpm install --frozen-lockfile`, backend+frontend `tsc` + `vitest run`, both builds (this also runs
  the frontend `no-db-access` guardrail test).
- [ ] `[track]` **No lint/format.** Add ESLint (typescript-eslint) + Prettier + a `lint` script, wired into CI.
- [ ] `[track]` **Docs describe the wrong stack.** `AGENTS*.md` (×4) + `README.md` + `PLAN.md` still say
  "Hono / Cloudflare D1 / SQLite"; the app is NestJS 11 + Node + Postgres. Rewrite (or delete the stale
  role-variants) — they mis-steer every agent.
- [ ] `[track]` **Docker/deploy fragility.** `docker-entrypoint.sh` swallows migrate failures (`|| echo`
  defeats `set -e` → boots on a broken schema); single-stage image ships devDeps + source; no `app`
  healthcheck (though `/health` exists). Abort on migrate failure; add a multi-stage runtime + compose healthcheck.
### Structural
- [ ] `[track]` **`CommitterService` god file (~696 LOC).** `apply()` accretes resolution/matching/qty-guard/
  enrichment/identifiers/milestones with `BUG N` comments. Extract collaborators (MasterResolver, LegMatcher,
  PoQtyReconciler, MilestoneSynchronizer); leave `apply()` an orchestrator.
- [ ] `[track]` **PO domain is homeless.** `pos` vs `purchase-orders` overlap (two read surfaces + duplicate
  mappers), and POs have no repository (~12 methods live inside `BookingRepository`). Confirm the FE no longer
  calls `/api/pos`, delete the orphaned `pos` module, extract a `PurchaseOrderRepository`.
- [ ] `[track]` **Stringly-typed core.** `ReconGroup.fields: Record<string,unknown>` + ~106 `as`-casts thread
  through committer/presentation; a renamed field escapes tsc. Define a typed `ParsedFields` at the decisions
  DTO boundary.
- [ ] `[track]` **Ingest full-table scans / N+1.** `committer.apply()` does `allLegs()` + whole
  `parsed_record⋈queue_message` per commit; `lookupByMatchKey` is a triple N+1 over a full scan. Push candidate
  filtering into indexed SQL.
- [ ] `[track]` **Review-queue apply-back** (`emails/review-queue.service.ts:56`, `TODO(apply-back)`). A
  `correct` verdict is stored to `review_email` but never re-applied to the shipment via the committer + field-locks.
### Hygiene
- [ ] `[track]` **Untrack `tmp/*.png`** (`git rm --cached tmp/*.png`); delete the ~102 MB working-tree `pave.log`.
- [ ] `[track]` **`lucide-react` pinned `^1.8.0`** — a dead-end major (maintained line is `0.x`, caret can never
  update). Re-pin to a current release.

## Cross-system pointers (tracked in memory/docs — recorded here so they're not lost)
- [ ] `[queue]` **Matcher source-fixes** — per-PO qty broadcast, thread-unstable identity over-split, CVP
  `LPO→booking_no` phantoms. Detail in the `matcher-source-fixes` memory; track-system only symptom-guards these.
- [ ] `[both]` **Booking-ingestion gap** — the tracking mailbox only sees To/Cc'd/forwarded mail, so
  person-addressed original booking emails+attachments are never ingested (→ empty-cargo shipments). Structural
  mail-flow fix; safety nets shipped. See `BOOKING-INGESTION-GAP.md` + the `booking-ingestion-gap` memory.

## Architecture — split queue + ShipTrack into SEPARATE databases (added 2026-07-08)
**Goal:** same Postgres instance, but each service owns a **separate database — NO shared `queue`/`evidence`
schemas or tables.** Today (verified 2026-07-08) BOTH cobalt-queue (`D:\cobalt-queue`) and ShipTrack connect to
the ONE database `cobalt` (`…@localhost:5432/cobalt`) and share the `queue`+`evidence` schemas, which ShipTrack
reads **in-process via cross-schema SQL**. Target: cobalt-queue → its own db (owns `queue`/`evidence`); ShipTrack →
its own db (owns `tracking`/`audit`/`alerts` only); integration becomes **HTTP-only** (`POST /api/decisions` +
new read APIs), not a shared DB.

**Enabler:** the `POST /api/decisions` payload already bundles the evidence rows + conflicts per shipment group,
so ShipTrack can persist what it needs from that into its OWN tables instead of reading the `evidence` schema live.
The hard remainder is the **Inbox / email-viewing** path, which reads `queue.queue_message` live.

**Blast radius — ShipTrack reads `queue`/`evidence` in ~16 files; each must move to the API boundary or a local copy:**
- [ ] `[track]` **`db/repositories/evidence.repository.ts`** — the load-bearing `innerJoin(parsed_record ⋈ queue_message)`
  (`allWithMessage`, per-message replay) powering Change-History replay + PO-enrichment (consumed by
  `reconcile/committer.service.ts` + `reconcile/po-enrichment.ts`). Persist from the decisions payload instead of joining live.
- [ ] `[track]` **`db/repositories/email.repository.ts`** — Inbox list / body / attachments / ingestion-status read
  `queue.queue_message` live. cobalt-queue must expose these via API, or replicate messages into a track-owned table.
- [ ] `[track]` Audit + rewire the rest: `db/repositories/{masters,shipment,booking,review-email}.repository.ts`,
  `presentation/{document-presentation.service,presentation.service,field-conflicts,mappers/email.mapper}.ts`,
  `reconcile/reconcile.service.ts`, `db/{zod,seed}.ts`, the one-off `db/*.ts` scripts.
- [ ] `[track]` Drop `queue`+`evidence` from `drizzle.config.ts` `schemaFilter`; delete `db/schema/{queue,evidence}.ts`
  (+ their `contracts.ts`/`zod.ts` exports); fix any `tracking.ts` cross-schema FKs; update `test/setup-db.ts`
  (stop truncating `queue.*`/`evidence.*`).
- [ ] `[queue]` cobalt-queue: point at its own `DATABASE_URL`/db; **expose the reads ShipTrack loses** (parsed-record +
  message for replay/enrichment; inbox messages + attachments) as APIs, or push them via the decisions payload / a sync.
- [ ] `[both]` Provision the 2nd database + migrate existing `queue`/`evidence` data; update `docker-compose.yml`, env,
  and the `cobalt-system-wiring` memory. **This is an architecture change, not a config flip** — the read sites above
  must move to the HTTP boundary first, or ShipTrack breaks the moment the schemas leave its database.
