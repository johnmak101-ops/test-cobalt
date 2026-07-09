# ShipTrack — TODO / deferred work

Tags: `[queue]` = cobalt-queue · `[track]` = cobalt_track_system.
Context: see `C:\Users\John\.claude\plans\typed-wondering-moler.md` (merge refactor plan) and the
`merge-refactor-progress` memory. Checkpoints 1–2 + Phase 6 + Iterator→OpenCode are shipped.

## De-correction — dissolve code-side model-corrections so the soul/skills can iterate (2026-07-09)
PRINCIPLE: track-system code that SILENTLY corrects the LLM/matcher masks the error → no human correction →
the Iterator gets no signal → the soul never learns. **A fix is a freeze.** The move is "stop silently fixing,
start surfacing": convert silent-corrections to review-flags, delete pure backstops, hold classifiers until the
soul catches up. Full 3-agent sweep of backend/src on 2026-07-09; ties to `matcher-source-fixes` memory.

### (a) Pure backstops — DELETE (done, PR "de-correct batch 1"): honest null, no wrong data written
- [x] `scacFromMbl` (committer-helpers) — no longer guess SCAC from the MBL prefix; the parser owns SCAC (rule 6).
- [x] origin-country GUESS in `deriveOriginCountry` (committer-leg-mapping) — keep the resolved-port country; drop the LOCODE-prefix + free-text `COUNTRY_TO_ISO2` guessing.
- [x] `qty_unit ?? 'cartons'` default (committer.service) — a missing unit stays null, not guessed.
- KEPT ON PURPOSE: `dedupeCsv` — dedup of legitimate multi-source aggregation (same style across PO sheets + B/L rider), NOT a model-error mask.

### (b) Silent drops → CONVERT to review-flags (keep the raw model value + surface it) — DONE 2026-07-09
All three now ride the existing `dataIssues`→`provisional`+`reviewReasons`+audit path (committer.apply). Spec/plan:
`docs/superpowers/specs/2026-07-09-de-correction-b-c-flags-shadow-design.md`.
- [x] per-PO qty BROADCAST guard (`po-enrichment.ts`) — no longer nulls the qty: a genuine per-PO qty still
  wins, but when ONLY a broadcast exists the value is KEPT (`total_quantity` filled) + `broadcastSuspected`;
  committer flags `PO X: total_quantity N looks like a broadcast total … verify`. Upstream: task_d1d3e8d4 / BX876110.
- [x] brand/style "latest-wins" (`po-enrichment.ts`) — newest still wins (written value unchanged) but a
  per-PO ≥2-distinct `brandConflict`/`styleConflict` (comma-subset = narrowing, not a conflict) is surfaced.
- [x] no-PO drop (`po-enrichment.ts` `poKeyOf`) — per the architect: "LLM decides, human reviews, code only
  flags". `unattributedBrandStyle` returns no-PO brand/style with match-keys; committer flags it on the
  shipment whose identity it shares (when no PO there already carries the field) — NOT leaked onto every PO,
  NOT silently dropped.

### (c) Classifiers — SOUL-FIRST, then delete (removing now floods phantoms/duplicates — currently load-bearing)
Plan: (1) SHADOW-FLAG first — keep current behavior BUT record "code would have corrected X" as evidence, so the
gap (how often the model is wrong) is measurable; (2) fix the soul rule upstream (cobalt-queue parser/matcher +
Iterator generalization); (3) when the shadow flag stops firing, DELETE the track guard.
- [x] **STEP 1 (shadow) DONE 2026-07-09.** All three guards STILL FIRE unchanged; each model-correction now
  writes an `audit.change_log` row with `changeType='shadow'` (excluded from `listForEntity` → never in the
  history/timeline). Measure: `select field, note, count(distinct entity_id) from audit.change_log where
  change_type='shadow' group by field, note`. Covered: `forwarder_name` platform scrub (`committer.service` c1,
  also wipes `forwarderRaw`); `classifyKind` DOCUMENT demotions — only rules (b) `invoice_so_ref` + (c)
  `platform_only` (CVP phantom, task_9d91d677 / LPO→booking_no), NOT (a) `bare_orphan` (genuine doc) — via new
  `classifyKindDetail` in `state.ts`; `normBookingKey` revision fold measured committer-side (compare
  `normBookingKey` vs `normKey`) so the pure fn stays byte-identical to the matcher's mirror (parity intact).
- [ ] **STEP 2/3 remain:** fix the soul upstream (cobalt-queue), then DELETE each track guard once its shadow
  goes quiet. `normBookingKey` delete must move WITH the matcher's mirrored copy (comment mandates parity).

### (d) Legacy reconcile path — same disease, low live impact
`merge.ts` FIELD_CLASS-allowlist drop + `sameId`/`sameName` folding + higher-rank silent supersede; `reconcile.service`
group re-derivation + PO split. Manual rebuild path only; apply the (b)/(c) principle when it is next touched.

### KEEP — these FEED iteration or are safety (do NOT remove)
- review-flags (the good pattern): `poQtyIssue`→provisional, empty-cargo flag, `review-policy` triggers, equal-rank conflict emission.
- safety invariants: field-locks (human-wins), audit, commit idempotency (`findExistingLeg` + BUG-4 `strongKeysConflict`), `writeParties` primary-recompute. (The committer docstring already says these live in code on purpose.)

### Reference tables → move to data/soul (ties to the "code-only rule tables → data" item below)
masters.repository: `PORT_ALIASES` / `IATA_TO_UNLOCODE` / `ABBREV_OVERRIDE {HCM:VNSGN}` / `NAME_CONTAINS_ALIASES` / `GENERIC_HOSTS` / legal-form fold; `PLATFORM_NOT_FORWARDER` (+ `cleanup-platform-forwarder` script); state.ts `MILESTONE_OF` / `DERIVED_MILESTONE_OF` / mode-map; merge.ts `FIELD_CLASS` / `DOC_RANK`; match-keys `STRONG`. (`MASTER_RESOLUTION_FACTS` already externalized to the editable `master_resolution` table.)

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
- [x] `[track]` **Integration tests — DONE 2026-07-09.** writeIdentifiers: committer int test (identifier
  history — cross-type dedup + is_current + idempotency; was 0 int coverage). Reconcile review gate: already
  covered (`score.spec.ts` unit + `decisions.int.spec` e2e). Masters curator/approve: added
  `masters-resolution.int.spec` (create → active-serve/consumer-reads → deactivate/consumer-hides → manage-still-
  shows; single-active invariant; reactivate).
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
- [x] `[track]` **SCAC — ALREADY DONE (verified 2026-07-09).** `tracking.shipments.scac_code` exists (schema
  line ~219), zod contract has `scac_code`, the committer writes it (`mapFieldsToLegColumns`), the presentation
  mapper exposes `scacCode` (+ `shipment.mapper.spec`), and the email-timeline adapter maps it. Stored "as-is"
  by design — no carrier-master validation (deliberate, per the schema comment). Nothing to add.
- [ ] `[track]` **Update/identifier coverage (rule 5: "update = change in any tracked field").** Make the
  change-history + `shipment_identifiers` paths cover the FULL field set (incl. crd, atd, scac, qty_unit,
  brand, pol/pod) — not a stale subset.
- [x] `[track]` **`reconcile/merge.ts` FIELD_CLASS coverage — DONE 2026-07-09.** Added the parser's "extract all
  info" fields so the reconcile-from-evidence path (`POST /reconcile`) stops dropping them: `ata`(schedule);
  `pol`/`vessel_name`/`voyage_no`/`flight_no`/`mawb`/`scac_code`/`brand`/`qty_unit`/`gross_weight`/`measurement`(text);
  + a new `list` class (UNION of comma-lists) for `item_style_no`+`hts_code`. NOTE: full parity with queue's
  `critic/merge.ts` is infeasible (it imports queue-only masters/match-keys + runs poQty/identifiers/coherence/
  over-merge passes); track's is a deliberate lightweight subset — this closes the field-coverage gap only.
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
- [~] `[ops]` **HTTPS + `NODE_ENV=production` — `COOKIE_SECURE` valve DONE 2026-07-09.** The session cookie is
  `secure` only in production; over plain HTTP it silently won't set (login breaks). Prefer HTTPS internally (cert
  for statustrack.cobaltknitwear.com) + NODE_ENV=production. If HTTP-only is unavoidable, set `COOKIE_SECURE=false`
  (now supported via `auth.constants.cookieSecure`; login-set + logout-clear now share attrs so a Secure cookie
  actually clears). **Remaining = the ops decision** to serve HTTPS / set the env — no code left.

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
- [x] `[track]` **Lint/format — DONE 2026-07-09 (PR #21).** ESLint 9 flat config (`eslint.config.mjs`,
  typescript-eslint + react-hooks), 0 errors, enforced in CI (`pnpm lint`). Prettier config + `format`/
  `format:check` scripts shipped as a dev tool (repo not mass-reformatted; format-check not CI-gated).
- [x] `[track]` **Docs stack corrected — DONE 2026-07-09.** Rewrote `README.md` + `AGENTS.md` to the real
  stack (NestJS 11 + Node + Postgres + pnpm workspace) and **deleted** the 3 stale PAVE role-variants
  (`AGENTS.{reviewer,strategist,uiux-designer}.md`, which described Hono/Cloudflare D1/SQLite). No `PLAN.md`
  exists. Only remaining stale-stack mention is this TODO's own historical note.
- [~] `[track]` **Docker/deploy fragility — PARTIALLY DONE 2026-07-09.** Fixed the two safe issues:
  migrate now ABORTS boot on failure (dropped `|| echo` so `set -e` fires → never serve on a broken
  schema), and the image has a `HEALTHCHECK` (node hits `GET /api/health`; no curl in the slim image).
  **Still deferred:** multi-stage runtime to drop devDeps + source — the entrypoint's `drizzle-kit migrate`
  (devDep) + `seed` (ts-node + source) need reworking to a prod-only path first, so it's not a safe
  drop-in. `docker build` verified.
### Structural
- [~] `[track]` **`CommitterService` god file — PARTIALLY DONE 2026-07-09.** Pure helpers extracted:
  `committer-helpers.ts` (dedupeCsv/scacFromMbl/countryToIso2, PR #26) + `committer-leg-mapping.ts`
  (`mapFieldsToLegColumns`/`deriveOriginCountry`, PR #28); `LegMatcher` (`findExistingLeg`) already pure.
  **Remaining:** extract the stateful collaborators (MasterResolver, PoQtyReconciler, MilestoneSynchronizer)
  so `apply()` reads as a thin orchestrator.
- [x] `[track]` **PO domain — RESOLVED 2026-07-09.** `PurchaseOrderRepository` extracted from `BookingRepository`
  (PR #27). The `/pos` module is **NOT orphaned** — the FE reads via `/purchase-orders` (`UiPosController`), but
  **cobalt-queue's matcher `src/matcher/tracking-client.ts:72` calls `GET /pos?open=true`** (verified against the
  checked-out queue repo), so `/pos` is a LIVE cross-service agent contract. KEEP it; do not delete.
- [x] `[track]` **Stringly-typed core — DECIDED NOT TO DO 2026-07-09.** Typed `ParsedFields` was evaluated and
  declined: the `fields` bag is a generic agent→app wire boundary read with DYNAMIC keys (`fields[k]`) in
  merge/state/the derived-milestone loop, which forces an index signature `[key:string]:unknown` — and that
  cancels typo-safety anyway. `Record<string,unknown>` at the boundary + `str`/`num`/`date` coercion in the
  committer is the correct split (loose in, strict at point-of-use). Do not re-propose.
- [~] `[track]` **Ingest N+1 — per-item round-trips DONE 2026-07-09, full-scans remain.** Killed the per-item
  N+1s: `lookupByMatchKey` + committer match loop (`poNumbersByBooking`, PR #29), `review.queue` (`findByIds`,
  PR #30), `presentation` alert summaries (PR #31), `posFor` (single query, PR #32), alert-evaluator
  milestones+emails+evidence (PR #33). **Remaining:** `committer.apply()` still `allLegs()` full-scans + loads
  whole `evidence.allWithMessage()` per commit — push candidate filtering into indexed SQL.
- [x] `[track]` **Review-queue apply-back — DONE 2026-07-09.** A `correct` verdict now re-applies to the linked
  shipment via `ShipmentsService.applyExtractionCorrection` (new): parser fields (`booking_no`) → leg columns
  (`bookingNo`) via `PARSER_TO_LEG`, routed through the existing `editFields` (write + human-wins field-lock +
  audit-with-note → feeds soul iteration). Master-resolved fields (customer/forwarder/ports) skipped; unmatched
  emails (no `shipmentId`) record the verdict without touching a shipment. Wiring: `ShipmentsModule` exports
  `ShipmentsService`, `EmailsModule` imports it (acyclic; DI boot-verified). +5 int tests.
### Hygiene
- [x] `[track]` **Untrack `tmp/*.png` — DONE 2026-07-09.** `git rm --cached` on the 4 tracked screenshots
  (committed before `tmp/` was gitignored). `pave.log` is already gone from the working tree + gitignored.
- [x] `[track]` **`lucide-react` bumped to `^1.17.0` — DONE 2026-07-09.** The old note's premise was wrong:
  lucide-react's maintained line IS 1.x (npm `latest` = 1.17.0), so `^1.8.0` was never a dead end — the caret
  updates within 1.x. Bumped to `^1.17.0` (resolved 1.21.0) for freshness; frontend tsc + build + 198 tests green.

## Cross-system pointers (tracked in memory/docs — recorded here so they're not lost)
- [ ] `[queue]` **Soul/skill iteration is shadowed (audit 2026-07-09).** Iterating the parser soul feels inert because
  (1) `validate.ts` + `critic/merge.ts` re-make ~19 reading judgments the prompt already states (frozen-code shadow),
  and (2) the Iterator's fast path only produces tabular SKILLS while the SOUL path is manual/unscheduled
  (`pnpm cli batch:iterate`, ≥10-gated, needs a warm openpave teacher — else it just memorizes pairs). 3 moves:
  unblock the loop (schedule + warm teacher + lower gates), relax the frozen backstops, collapse duplicated party
  facts (`PLATFORM_NOT_FORWARDER` ×3, SCAC map redundant w/ carrier master) → master-data. Full map in the
  `cobalt-queue-soul-iteration-map` memory. NEEDS a dedicated cobalt-queue session w/ its benchmark — not a blind edit.
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
- [x] `[track]` **Test-infra — DONE 2026-07-09.** `setup-db.ts` now keeps a `_test_migrations` ledger and
  applies only un-recorded migrations, so a NEWLY-ADDED migration auto-applies on the next run — no manual
  `DROP DATABASE cobalt_test`. A pre-ledger DB is recreated once (guarded to a DB literally named `cobalt_test`;
  race-free under `fileParallelism:false`). Verified green on both the transition run and the steady-state run.
- [ ] `[both]` **Code-only rule tables → data** (the deeper "don't code-bind facts" work the audit surfaced): ShipTrack `masters.repository.ts` port maps (`PORT_ALIASES`/`IATA_TO_UNLOCODE`/`ABBREV_OVERRIDE`/`NAME_CONTAINS_ALIASES`) — **ports have no data home anywhere**; cobalt-queue soul (`prompts/cobalt-parser.md`) port map + FORWARDER CARDS + carrier-prefix rules, and `validate.ts` party lists (`PLATFORM_NOT_FORWARDER`/`SELF`/`GENUINE_SHORT_BRANDS`/…). Extend the resolution/data model to cover these.
- [x] `[track]` **Alert-rules write guard — SUPERSEDED by Config-Page Access Control (PR #17, 2026-07-09).** PUT `/alert-rules`
  is now `@PageWrite('alert_rules')` (GET `@PageRead('alert_rules')`); editability is superadmin-configurable via the access
  matrix instead of a static `@Roles('ADMIN')`. Frontend gates on `usePageAccess().canEdit('alert_rules')`.
