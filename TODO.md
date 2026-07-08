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

### [both] — VM1↔Agent candidate-shape contract — RESOLVED 2026-07-08 (verified already-fixed + pinned)
- [x] `[both]` **`GET /shipments` candidates are `BackendShipment`-shaped end-to-end.** Investigated 2026-07-08:
  the adapter already exists and is WIRED. cobalt-queue `matcher/backend-adapter.ts` (`adaptBackendCandidates`)
  maps VM1's flat camelCase leg → `{ fields:{snake_case}, mode, matchKey, lockedFields, matchedBy }`, called
  inside `tracking-client.lookupShipments`; `runner.ts` sets `backendMode`/`backendMatch`/`backendMismatches`
  from it; the gate's sea↔air check normalises via `modeClass` (handles VM1's UPPERCASE `SEA`/`SEA_FCL`/`AIR`),
  and the locked-field camel→snake map is idempotent-safe. Confirmed VM1's REAL emit: `lookupByMatchKey`
  spreads `{...leg}` from `allLegs()` (`SELECT *`), so each candidate carries `mode` + `matchKeys` (snake_case
  JSONB) + camelCase identity columns. **No live bug.** Pinned the contract with a new integration test in
  `backend/test/matcher-reads.int.spec.ts` (asserts `mode` + camelCase columns + `matchKeys` on the real
  service output) so a future projection-narrowing of `allLegs()`/`lookupByMatchKey` can't silently re-inert
  the diff. Green: queue-side adapter + tracking-client tests (15), this VM1 int spec (8).
  - Original risk (kept for context): had VM1 returned FLAT camelCase with NO adaptation, `backendDiff` →
    `backendMismatches=[]` always → the backend-conflict + locked-field + sea↔air triggers never fire (unsafe
    auto-applies). That adaptation IS present; the new test guards it against regression.

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
**STATUS (2026-07-08): ✅ COMPLETE — both sides MERGED.** The two services are now **HTTP-only** (`POST /api/decisions`
with `evidence[]` + `GET /api/masters/resolution`) + Microsoft Graph for email body/attachments — **NO shared DB schema.**
e2e-proven cobalt_queue → ShipTrack (ingest.* populated incl. graph attachment id; 16 curated facts flow over HTTP).
- ShipTrack owns `cobalt` (`tracking`/`audit`/`alerts`/`ingest`) — **PR #12** (+ curated-facts seed **#13**).
- cobalt-queue owns `cobalt_queue` (`queue`/`evidence`) — **PR #49** (+ curated-facts HTTP read **#50**).
Spec/plan: `docs/superpowers/{specs,plans}/2026-07-08-separate-shiptrack-database*` (track) + `cobalt-queue/docs/superpowers/.../2026-07-08-cobalt-queue-own-db-and-evidence-send*`. Details in the `cobalt-system-wiring` memory.

**Done:**
- [x] `[track]` (PR #12) own **`ingest`** mirror (`email_message`/`email_attachment`/`parsed_record`); dropped queue/evidence (mig `0016`); **Graph-on-demand** for body/attachments (`GraphService.fetchAttachments`, local-seed-first); `evidence[]` receive side (`IngestRepository.upsertFromDecision`, upsert idempotent on `(graph_message_id, record_idx)` + `message_id NOT NULL`, mig `0017`).
- [x] `[queue]` (PR #49) own db `cobalt_queue`; **SENDS** `evidence[]` (parsed record + metadata + attachments incl. `graph_attachment_id`) via `buildDecisionFromGroup`; captures the Graph attachment id in ingestion; `tracking-client` auth via **cookie→Bearer** (fixed a PRE-EXISTING PR#11 break — the agent couldn't auth at all).
- [x] `[both]` (PR #13 + #50) curated `master_resolution` facts → **ShipTrack single source of truth** (seeded there, `vendor_group` enum added) + cobalt-queue parser reads them via `GET /api/masters/resolution` HTTP; retired cobalt-queue's local `seed-entity-facts.ts`.

**Remaining follow-ups (non-blocking):**
- [ ] `[both]` **docker-compose 2nd-DB provisioning** — dev creates `cobalt_queue` manually; wire each repo's `docker-compose.yml`/env to its own DB. (Prod = AliCloud VMs, not compose → dev/demo convenience only.)
- [x] `[track]` **Retire `seed-entity-facts.ts` + reconcile `SEH` — DONE 2026-07-08** (branch `feat/master-resolution-management`; folded into the master_resolution management feature below). SEH now bootstraps as `customer_group→PRIMARK` (fail-safe) and is editable in the UI.
- [x] `[track]` **`backfill-shipment-ports.sql` — DONE** (already names `ingest.parsed_record`, fixed in `039fc7a`; the only remaining `evidence.parsed_record` hits are frozen drizzle migration snapshots, correctly immutable).
- [ ] `[queue]` minor test coverage: `graphAttachmentId` on the zip/msg-flag normalize paths.

## master_resolution runtime management (shipped 2026-07-08, branch `feat/master-resolution-management`)
Curated resolution facts (alias/group/canonical/role incl. SEH) are now **ADMIN-managed at runtime** — Settings → **Resolution Rules** (create/edit/deactivate + curator proposals inbox) backed by an `active` flag on `tracking.master_resolution` (mig `0018`) + ADMIN CRUD API (`POST/PATCH /masters/resolution*`; consumer `GET /masters/resolution` now filters `active=true`, so cobalt-queue honours deactivation with no change). **Seed is non-destructive**: `master_resolution`/`app_settings`/`alert_rules`/`users` are no longer truncated (seeded `onConflictDoNothing`) so runtime edits survive a reseed. Spec/plan: `docs/superpowers/{specs,plans}/2026-07-08-master-resolution-management*`. e2e-proven (auth→create→active-serve→deactivate→consumer-hides→unauth-401). Follow-ups:
- [ ] `[track]` **Test-infra:** `backend/test/setup-db.ts` only runs migrations when the `tracking` schema is ABSENT, so a NEW migration needs a one-time `DROP DATABASE cobalt_test`. Track applied migrations (or use drizzle `migrate`) so new migrations auto-apply.
- [ ] `[both]` **Code-only rule tables → data** (the deeper "don't code-bind facts" work the audit surfaced): ShipTrack `masters.repository.ts` port maps (`PORT_ALIASES`/`IATA_TO_UNLOCODE`/`ABBREV_OVERRIDE`/`NAME_CONTAINS_ALIASES`) — **ports have no data home anywhere**; cobalt-queue soul (`prompts/cobalt-parser.md`) port map + FORWARDER CARDS + carrier-prefix rules, and `validate.ts` party lists (`PLATFORM_NOT_FORWARDER`/`SELF`/`GENUINE_SHORT_BRANDS`/…). Extend the resolution/data model to cover these.
- [x] `[track]` **Alert-rules write guard — DONE 2026-07-08.** `ui.controllers.ts` PUT `/alert-rules` now `@Roles('ADMIN')` (rank-based → ADMIN + SUPERADMIN, i.e. "admin or above"); paired frontend `AlertRulesPage.canEdit` gates on `role ∈ {ADMIN, SUPERADMIN}`. Regression test in `ui.controllers.spec.ts` asserts the metadata so it can't be silently removed again.
