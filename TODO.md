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
Follow-ups from the whole-branch review — done on branch `feat/auth-hardening-followups` (2026-07-08):
- [x] `[track]` **Last-superadmin guard is transactional.** `UsersRepository.updateGuardingLastActiveSuperadmin`
  locks active SUPERADMIN rows `FOR UPDATE` + re-counts in a tx (throws `LastActiveSuperadminError`); `users.service`
  update()/remove() route deactivation/demotion through it. Deterministic int test (side-tx holds the lock) — proven
  red on the old check-then-act, green now.
- [~] `[track]` **e2e AppModule boot test — PARTIAL.** Guard ORDER (JwtAuth→MustReset→Roles) + the global
  ThrottlerGuard are now pinned structurally (`auth/guard-wiring.spec.ts`); per-guard behaviour + the login 10/min
  metadata stay covered by the `*.guard.spec` / `login-throttle.spec` files. A full HTTP boot (supertest mustReset→403,
  11 logins→429) is DEFERRED: vitest's esbuild transform drops `emitDecoratorMetadata`, so Nest DI can't build the graph
  under the runner (hard abort at `NestFactory.create`). To do it behaviourally, add an SWC transform to
  `backend/vitest.config.ts` (`unplugin-swc` + `@swc/core`).
- [x] `[track]` **`SESSION_TTL_HOURS` via ConfigService.** `auth.constants.sessionTtlSeconds(config)` replaces the
  import-time `process.env` read; used by the JWT `registerAsync` factory + injected into `AuthController` for the cookie
  maxAge. A `.env` value is now honoured (was always 12h). Unit-tested.
- [x] `[track]` **`trust proxy: 1` documented.** `main.ts` annotates the single-hop intranet-nginx assumption
  (X-Forwarded-Proto → secure cookie; X-Forwarded-For → throttler IP); revisit if a CDN / 2nd proxy is added.
- [x] `[track]` **Unified guard error shape.** `RolesGuard` now throws `403 {code:'FORBIDDEN',message}` to match
  `MustResetGuard`'s `{code:'MUST_RESET',…}`; FE `apiErrorMessage` reads `.message`, so no break.

### Prod-readiness — from `Server Information.pdf` review (2026-07-08, intranet single-origin)
Authoritative server map: `.18` vmseacbfstapp1 = **StatusTrack**.Cobaltknitwear.com = the APP (VM1); `.19`
vmseacbfstwbp1 = **StatusTrackAgent** = the AGENT (VM2). Earlier notes had these flipped (fixed in the
`cobalt-production-url` memory). Recommended shape = single-origin HTTPS: NestJS serves SPA + `/api`; one nginx TLS hop.
- [x] `[track]` **Frontend API base fixed for HTTPS.** `frontend/src/lib/api.ts` `resolveApiBase()` was port-only and
  sent the prod HTTPS host (port '') to `http://localhost:3000` (mixed-content-blocked → app dead). Now relative `/api`
  for any same-origin host; absolute localhost only for a different LOCAL port (PAVE/dev). Unit-tested.
- [x] `[track]` **CORS default corrected.** `config/cors.ts` had pinned the agent host; now
  `https://statustrack.cobaltknitwear.com` (the app). Same-origin makes CORS moot for the browser — set `CORS_ORIGINS`
  explicitly in prod. Agent→app POST is server-to-server Bearer (CORS doesn't apply).
- [ ] `[ops]` **HTTPS + `NODE_ENV=production` in prod.** The session cookie is `secure` only then; over plain HTTP it
  silently won't set (login breaks). Serve HTTPS internally (cert for statustrack.cobaltknitwear.com) + set
  NODE_ENV=production. If HTTP-only is unavoidable, add a `COOKIE_SECURE` env valve.

## Governance — Config-Page Access Control + Review Policy (2026-07-09, MERGED)
Both live on main. Permission model: business tunables → EDITOR, governance → ADMIN, page-access → SUPERADMIN.
- [x] `[track]` **Config-Page Access Control (PR #17).** Superadmin-managed matrix (page × role → None/View/Edit) over the
  config pages, backed by `app_settings.page_access` + a code registry (`src/access/pages.ts`). `PageAccessGuard` +
  `@PageRead`/`@PageWrite` replace static `@Roles` on alert-rules + resolution endpoints; superadmin **Access Control** panel
  at `/settings/access`; frontend `PageAccessRoute` + `usePageAccess`. Backend-authoritative for writes.
- [x] `[track]` **Review Policy (PR #19).** Configurable human-review triggers (`decisions/review-policy.ts`:
  conflict/no_strong_id/no_po/cancellation/platform_only/sparse) that DOWNGRADE an auto-confirm to review (safe direction
  only); hooked in `decisions.service.ingest`; governed as page `review_policy` (EDITOR-editable). No confidence-score knob.
- [ ] `[track]` **Access-control v2 — hard read-gating.** `none` hides the page + blocks writes (backend-authoritative) but
  does NOT hard-block a direct API *read* of shared/agent-consumed endpoints (`GET /masters/resolution`, read by the parser).
  Split the endpoint or add a service-account carve-out if hard read-gating is wanted.
- [ ] `[track]` **Review-policy v2 — lookup triggers.** Add cross-leg triggers (new/unknown customer, sea↔air mode change,
  moved shipment, duplicate number, late PO) — they need context the payload alone can't satisfy; the agent gate flags most.

## Tech-debt (2026-07-08 whole-codebase `/tech-debt` audit)
The `SettingsPage` + `PresentationService` god-components were already decomposed (PR #9). Remaining:
### Guardrails (highest leverage)
- [x] `[track]` **CI — DONE 2026-07-09.** `.github/workflows/ci.yml`: one workspace `pnpm install --frozen-lockfile`,
  backend + frontend `tsc --noEmit` + `vitest run` (Postgres service for the int tests), both builds. Runs on
  push-to-main + every PR. (~660 tests now: 460 backend + 198 frontend + the `no-db-access` guardrail.)
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
- [x] `[track]` **Alert-rules write guard — SUPERSEDED by Config-Page Access Control (PR #17, 2026-07-09).** PUT `/alert-rules`
  is now `@PageWrite('alert_rules')` (GET `@PageRead('alert_rules')`); editability is superadmin-configurable via the access
  matrix instead of a static `@Roles('ADMIN')`. Frontend gates on `usePageAccess().canEdit('alert_rules')`.
