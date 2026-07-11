# ShipTrack — TODO / deferred work

Tags: `[queue]` = cobalt-queue · `[track]` = cobalt_track_system.
Context: see `C:\Users\John\.claude\plans\typed-wondering-moler.md` (merge refactor plan) and the
`merge-refactor-progress` memory. Checkpoints 1–2 + Phase 6 + Iterator→OpenCode are shipped.

## Fabric SQL migration (Postgres → Microsoft Fabric SQL / Kysely) — ✅ COMPLETE 2026-07-10
Plan: `FABRIC-SQL-MIGRATION-PLAN.md`. ADR: `ADR-database-platform-fabric-vs-postgres.md`.
Locked & delivered: Kysely (both apps) + RabbitMQ (replaced pg-boss) + local SQL Server 2022 (dev/CI;
Fabric = deploy target). The track-system `0000_init` T-SQL schema (29 tables) lives in
`backend/src/db/kysely-migrations/` (ships inside `dist/`); codegen types in
`backend/src/db/kysely/db.generated.ts` with the curated overlay `backend/src/db/kysely/db.ts`
(import `DB` from there). All SQL Server specs run UNGATED — mssql IS the engine.

### Phase 2 — track-system data layer → SQL ✅ ALL 13 REPOS PORTED (2026-07-09)
Every Drizzle repository now has a Kysely/SQL Server twin (\`*.repository.kysely.ts\`) built alongside the
original, each with a SQL Server int spec, all green on the local \`mssql-2022\` container + in CI.
| repo | PR | tests | notes |
|---|---|---|---|
| foundation (0000_init T-SQL + codegen + CI) | #49 | 30 | 29-table schema, mssql-2022 CI job |
| masters | #50 | — | data-access + exact-match resolution |
| settings/users/audit (leaf) | #51 | 4 | leaf-repos.kysely.int.spec |
| ingest | #52 | 2 | upsert-from-decision, transactional |
| evidence | #53 | 4 | ingest joins |
| purchase-order | #54 | 5 | listPos/poDetail/upsertPo/CRUD/links |
| alert | #55 | 8 | dedup_key unique (single-NULL safe — always set) |
| field-lock | #56 | 5 | upsert lock (human-wins) |
| review-email | #57 | 5 | queue reads + review-state writes |
| booking | #58 | 8 | nextJobSeq (T-SQL trailing-digit extract) |
| email | #59 | 10 | TOP via modifyFront, thread GROUP BY all cols |
| shipment | #60 | 10 | documents STRING_AGG-over-DISTINCT, linkDocument tx |

**Full SQL Server suite on main: 12 files, 97 tests green** (PR #60 was the final port; the swap —
#61/#62 — then made these the real repositories and the specs run ungated in the main suite).

**Key SQL Server gotchas the ports encode (apply to the swap + Phase 3):**
- Kysely 0.29's \`MssqlDialect\` emits \`.limit(n)\` VERBATIM as \`limit\` (Postgres syntax) → use
  \`.modifyFront(sql\\`top ${sql.lit(n)}\\`)\` for row caps; \`... limit 1\` in raw subqueries → \`select top 1 …\`.
- SQL Server \`STRING_AGG\` has NO \`DISTINCT\` → aggregate over a \`SELECT DISTINCT\` subquery.
- \`order by … nulls last\` → \`case when x is null then 1 else 0 end asc\` + \`expr desc\` (NULLs sort first in ASC).
- \`GROUP BY\` must list EVERY non-aggregated selected column (no Postgres functional-dependency shortcut).
- \`onConflictDoNothing\`/\`onConflictDoUpdate\` → check-then-insert/update catching the unique violation
  (\`dedup_key\` is always set by the evaluator → the single-NULL unique gotcha doesn't bite).
- \`returning\` → \`.output('inserted.col')\` / \`.outputAll('inserted')\` / \`outputAll('deleted')\`.
- \`count(*)::int\` → \`count(*)\` cast to number client-side (codegen types it as string).
- JSON \`nvarchar(max)\` columns (\`match_keys\`, \`country_thresholds\`, \`fields\`, \`match_keys\`) stringified on
  insert; \`ParseJSONResultsPlugin\` parses them back to objects on read — DON'T assert they're strings in tests.
- \`bit\` columns (\`is_current\`, \`is_primary\`, \`enabled\`, \`locked\`) come back as JS \`boolean\` (not 0/1).
- SQL Server returns \`uniqueidentifier\`s UPPERCASE — compare UUIDs case-insensitively (`.toLowerCase())`).
- \`entity_id\`/FKs are \`uniqueidentifier\` — tests must pass real UUIDs (use \`randomUUID()\`), not string literals.
- Cross-test data leaks (one shared DB per file) — assert on SPECIFIC seeded rows, not global counts/positions.
- Kysely 0.29 doesn't export \`Insertable\` — replace* methods take \`Record<string,unknown>[]\` cast \`as never\`.

### Phase 2-swap — ✅ DONE 2026-07-10 (track PR #61 + #62, both merged)
The Kysely ports BECAME the repositories (same class tokens, `@Inject(KYSELY)`); `KyselyModule` +
`SQL_SERVER_URL` boot the app on SQL Server; `test/setup-db.ts` auto-creates + migrates `cobalt_test`
(kysely ledger, `sp_MSforeachtable` reset — dev/CI only, that proc doesn't exist on Fabric); all 22
service-level int specs converted (assertions unchanged); seed/seed-auth-users/sync-masters/load-ports
ported (5 obsolete one-off Postgres backfills deleted); `migrate-cli.ts` (static registry, creates the
DB if missing) wired into the Docker entrypoint; CI = single job on an mssql-2022 service. Drizzle
provider/schema/migrations + `drizzle-orm`/`drizzle-kit`/`pg` deps DELETED (#62); `contracts.ts` = zod
only; enum arrays live in `src/db/enums.ts`. Restored on the way (the ports had exact-match-only stubs
but the LLM Master Matcher that replaces them is deferred BEHIND this migration): the tiered
`portByCodeOrName` (ABBREV_OVERRIDE HCM→VNSGN before IATA; fixes a live wrong-port bug) and the staged
exactly-one-guarded `forwarderIdByName` — in JS over the ERP-mirrored sets (SQL Server 2022 has no
regexp_replace). Suite: 634 backend + 198 frontend green on SQL Server.

### Phase 3 — ✅ DONE 2026-07-10 (cobalt-queue PR #52)
8-table queue/evidence schema → T-SQL (`src/db/kysely-migrations/`, flattened dbo) on Kysely; lazy
`db` handle keeps the fail-fast contract; every call site ported (worker/enqueue, ingest, matcher,
viewer/API, parser master-db/skills, iterator stores w/ runtime DDL, all dev scripts). pg-boss →
**RabbitBoss** (RabbitMQ) behind the worker seam: fixed-TTL retry ladder (60/120/240s, `x-attempts`),
`email.process.dead` terminal queue, broker-native crash requeue — proven live incl. the full
retry→dead path. `pg`/`pg-boss`/`drizzle-*` removed. Suite 697/699 green (2 = broker-gated, run live).

### Phase 4 — ✅ e2e PROVEN 2026-07-10 (both apps on SQL Server + RabbitMQ)
enqueue → RabbitMQ → worker(stub) → `parsed_record` (cobalt_queue) → matcher (deterministic) + critic
(heuristic) + curated facts read live over `GET /api/masters/resolution` → `POST /api/decisions` →
track-system committer: shipment created (provisional + gate reason carried through, PO linked),
`evidence[]` → ingest mirror rows (`email_message`/`parsed_record`), alert evaluator re-ran live.

### Deployment — ✅ SHIPPED 2026-07-10 (prod = ONE Fabric SQL DB, schema-shared)
Prod has exactly one Fabric SQL database (`ShipTrackDB`); Fabric SQL DBs are workspace *items* (no T-SQL
`CREATE DATABASE`), so **both apps share the one DB via schemas** — ship-track owns `dbo.*` (30 tables),
cobalt-queue lives in `queue.*` (8 tables), each with its own `kysely_migration` ledger, both connecting as
the same Entra **Service Principal** (db_owner; SP secret == the Cobalt Mesh web-API client secret). PRs:
ship-track **#70** (Entra SP auth + skip `CREATE DATABASE` on Fabric); cobalt-queue **#55** (same auth + move
all tables into a `queue` schema via `WithSchemaPlugin`), **#56** (viewer `/stats` SUM-subquery → two COUNTs;
SQL Server err 130), **#57** (`CREATE SCHEMA [queue] AUTHORIZATION [dbo]` — a bare CREATE SCHEMA made the SP
the schema owner, Fabric err 33134). Deploy runbook + full detail: `HANDOFF-FABRIC-SQL.md` § Deployment.

### Migration follow-ups (non-blocking)
- [x] `[ops]` **Fabric-deploy verification — DONE 2026-07-10 (PR #70/#71).** The MSSQL layer now speaks Entra
  **Service Principal** auth (`Authentication=Active Directory Service Principal` conn-string keyword, encryption
  forced on) and `migrate-cli` skips `CREATE DATABASE` in that mode (the Fabric DB is pre-provisioned); local
  SQL Server behaviour unchanged. Live-verified end-to-end: `db:migrate` applied the full 30-table schema to the
  real Fabric **ShipTrackDB**. Deploy runbook + one-DB shape in `HANDOFF-FABRIC-SQL.md` § Deployment.
  `sp_MSforeachtable` paths (test-reset, demo-wipe) stay dev-only by design.
- [x] `[queue]` **Corpus re-ingest — DONE 2026-07-10.** The corpus lived in the pre-split `cobalt_new`
  Postgres DB (not `cobalt_queue`); copied wholesale into SQL Server via row_to_json JSONL export +
  kysely import: 797 messages, 398 attachments, 566 normalized parts (~163MB varbinary blobs), 2710
  parsed evidence rows, 4 sender rules. Gotcha encoded: tedious binds an explicit `null` as nvarchar →
  varbinary columns must be OMITTED when null. The deferred full re-parse remains optional (evidence
  came across intact).
- [ ] `[both]` kysely 0.29 ships a native `.top(n)` — optional mechanical sweep to replace the
  `.modifyFront(sql`top …`)` idiom.
- [x] `[both]` docker-compose 2nd-DB provisioning — superseded: each repo's compose is now self-contained
  (track: mssql + app; queue: rabbitmq in-stack + SQL Server via host/Fabric), migrate services create
  their own DB if missing.


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
- [x] `[queue]` **OpenPAVE swap-in — DONE (verified 2026-07-10).** Every seam runs an openpave adapter:
  parser (`parser/openpave.ts`, the ONLY model parser), matcher (`matcher-agent.ts`), critic
  (`critic-agent/openpave.ts`), reconciler, master-matcher (`master-matcher/openpave.ts`), refiner
  (`iterator/refine-openpave.ts`). The OpenCode runtime + adapters were retired (`7a8c279`); config
  seams are `openpave | stub/heuristic/deterministic`. Nothing left to swap.
- [ ] `[queue]` **Iterator trigger.** `run-iterator.ts` is a manual dev pass (not scheduled) and reads
  a sample `corrections.json`. Decide the real corrections source (a corrections store fed by human
  edits / field-locks) and whether/when to schedule a gated pass.

## Masters & validation
- [x] `[track]` **Masters from ERP, not seed — DONE 2026-07-09 (PR #47).** The architect's call: don't
  hardcode masters; pull them daily from Cobalt Mesh. `customers`/`vendors`(=factories+gmtsuppliers)/`forwarders`
  are now a read-only ERP mirror via `sync-masters.ts` (daily cron, upsert-never-delete); `ports` stay seeded;
  demo dataset gated behind `SEED_DEMO`. So `MACAU FUNG TAI → MACFUN` etc. arrive as real vendor masters from
  the ERP (no hand-seeding). `master_resolution` curated facts stay seeded (prod config). consignees/brands/
  carriers not synced (no local master / no endpoint). See the `cobalt-mesh-masters-sync` memory.
- [x] `[both]` **LLM name→master matcher — Phase 0+1 BUILT 2026-07-10** (track PR #64 + queue PR #53).
  Design: `docs/superpowers/specs/2026-07-09-llm-master-matcher-design.md` + T-SQL re-spec
  `docs/superpowers/specs/2026-07-10-master-matcher-tsql-respec.md` (pg_trgm → app-side trigram; the
  masters are a few-k-row ERP mirror, so retrieval scores in TS — portable SQL Server ↔ Fabric).
  SHIPPED: track `POST /api/masters/candidates` (trigram name + domain + region + `prior_correction`
  boost; prior_correction excluded from the consumer resolution GET) + Mesh customer enrichment;
  queue `MasterMatcherAgent` (`MASTER_MATCHER=stub|openpave`, soul `prompts/cobalt-master-matcher.md`,
  candidates-only enforced in code, failure→none→review) wired into the runner before merge, and
  **THE DELETION**: `resolveEntity` + every deterministic name→code tier + SEED name tables +
  resolution indexes + alias-kind overlay reads + `customerResolvedFuzzy` are GONE (value-correcting
  drops converted to pure flags per de-correction). Verified: revalidate 33→0 silent rewrites; gate
  auto 79→102 with unknown-customer count unchanged; live openpave probe resolved MACFUN conf 0.95.
  **Phase 2+3 SHIPPED 2026-07-10 (track PR #66 + queue PR #54):** candidates `context{customerCode,
  poNumbers,brand}` → `cooccur:po`/`cooccur:customer`/`related:customer_vendor`/`brand:match` boosts
  (never filters; context-only hits qualify); review-queue `correct` verdicts auto-write
  `prior_correction` facts (supersede-on-same-raw, never-throws); the matcher-consumer fingerprint
  probes the facts set so a new fact re-triggers matching over existing evidence (the re-match loop).
  Deliberately NOT built: multi-domain table (YAGNI), semantic embeddings (no Fabric extension story —
  escape hatch is a persisted trigram table). Follow-ups: Resolution Rules UI still offers the retired
  alias kinds (rows are audit history — hide/deprecate in UI); short-name forwarder trigram recall
  ("DSV AIR AND SEA" → 0 candidates on a sparse master set) worth a track-side look.
- [x] `[both]` **Forwarder + port join the LLM matcher seam — SHIPPED & MERGED 2026-07-10**
  (spec `docs/superpowers/specs/2026-07-10-all-ai-forwarder-resolution-design.md`; **track PR #73 +
  queue PR #59**, both merged). Shadow metering is live for both (`audit.change_log`
  `changeType='shadow'`, `field='forwarder_link'`/`'port_link'`) — fuzzy-tier deletion is a follow-up
  gated on the shadow count going quiet
  (`select field, note, count(distinct entity_id) from audit.change_log where change_type='shadow'
  and field in ('forwarder_link','port_link') group by field, note`). `recordPriorCorrections` now
  covers `forwarder_name`/`pol`/`pod` (previously customer/vendor codes only). `candidates.service.ts`
  gained a `name:tokens` recall signal + a `port` kind (mode-aware, UN/LOCODE-only).
  **Live openpave probe — DONE 2026-07-10 (3/3, tool `cobalt-queue/src/dev/probe-master-matcher.ts`):**
  forwarder `DSV AIR AND SEA CO LTD` → match `DSV` conf 0.8 (the `name:tokens` rescue live);
  `SHANGHAI`+Sea → `CNSHA` 0.95; `SHANGHAI`+Air → the probe first exposed a retrieval gap (only the
  sea port was retrieved; the LLM correctly REFUSED — sea tag vs Air mode → review) → fixed by a
  **port-only REVERSE token subset** (`tokenSubset`, input⊆master: a bare city name surfaces its
  airport; gated to ports so parties don't flood) → re-probe `CNPVG` conf 0.92 picked BY MODE over
  CNSHA. Fix PR: `fix/port-city-token-recall`.
- [x] ~~**Keep party/shipper fixes deterministic.**~~ SUPERSEDED 2026-07-10 by the matcher decision D
  (the deterministic consignee/alias route is deleted; party fixes now flow raw → LLM matcher →
  review → `prior_correction` retrieval facts). Historical context: the `validate.ts`
  "consignee-resolves-to-a-vendor" rule shipped 2026-06 when the parser ignored per-customer prompt
  guidance. New party-confusion cases now go to the review queue → a `prior_correction` fact
  (Settings → Resolution Rules), NOT validate.ts tables.

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
- [x] `[queue]` **`AZURE_API_KEY` gap — RESOLVED BY DELETION (verified 2026-07-10).** Per the architect
  ("we now go to openpave"): every direct-Azure LLM path was removed upstream (`d87c2c4` "remove all
  direct-Azure paths — cobalt holds no Azure key (it lives in EPM)" + `2ca21d2` openpave-only; the
  opencode runtime retired in `7a8c279`), and `benchmark.ts` no longer exists. Today's grep confirms:
  no `AZURE_API_KEY`, no `openai`/`@azure` dep anywhere; parser=openpave|stub, critic/matcher/
  reconciler/masterMatcher=openpave|deterministic-tier. The only "azure" left is the Entra SP auth in
  the Fabric SQL dialect (required) + comments about the EPM→Azure model's content filter.
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
- [~] `[track]` **Update/identifier coverage (rule 5: "update = change in any tracked field").** Audit
  already covers all LEG fields (`applyFields` diffs every column — atd/scac/qty_unit/cargoReadyDate/pol/pod
  included). **DONE 2026-07-09:** `fillBooking` now audits **brand** (a booking-only field with no leg
  column → previously invisible in change-history). Remaining is genuinely small/ambiguous: customer/vendor/
  forwarder booking-link fills are shown as resolved links (auditing raw UUIDs adds noise) and
  `shipment_identifiers` is identity-only by design — confirm whether any real gap is left before more work.
- [x] `[track]` **`reconcile/merge.ts` FIELD_CLASS coverage — DONE 2026-07-09.** Added the parser's "extract all
  info" fields so the reconcile-from-evidence path (`POST /reconcile`) stops dropping them: `ata`(schedule);
  `pol`/`vessel_name`/`voyage_no`/`flight_no`/`mawb`/`scac_code`/`brand`/`qty_unit`/`gross_weight`/`measurement`(text);
  + a new `list` class (UNION of comma-lists) for `item_style_no`+`hts_code`. NOTE: full parity with queue's
  `critic/merge.ts` is infeasible (it imports queue-only masters/match-keys + runs poQty/identifiers/coherence/
  over-merge passes); track's is a deliberate lightweight subset — this closes the field-coverage gap only.
- [x] `[track]` **cfs_cutoff vs warehouse_end_date — SAME (architect-confirmed 2026-07-09).** The parser only
  ever fills `warehouse_end_date` (截倉時間 = CFS cut-off, soul field 12); `cfs_cutoff` fills solely from a
  human edit. The presentation mapper already displays `cfsCutoff ?? warehouseEndDate`; the fix extended the
  same equating to the **alert evaluator** (`buildFacts`) so cutoff-anchored alerts (A3) fire off the
  parser's warehouse_end_date instead of silently never firing. No schema change (kept both columns; human
  cfs_cutoff still wins). +1 int test.
- [ ] `[track]` **Email disposition (matcher gates review, not the parser).** New PO+known customer→auto;
  new customer / mode-change / moved-shipment / late-PO / dup-number→review; no status update→不需處理
  (store, no human review). All emails parsed; sender-type tagged post-parse for field-trust.

### [queue] — parser — ✅ BOTH SHIPPED (verified end-to-end 2026-07-10)
- [x] `[queue]` **Parser "extract all info" — shipped upstream** (queue `7a268b6` + audit-loops): soul
  fields 21–31 (`vessel_name`/`voyage_no`/`flight_no`/`mawb`/`ata`/`brand`/`qty_unit`/`scac` +
  `gross_weight`/`measurement`/`hts_code` beyond the original list); `cfs_cutoff` deliberately NOT a
  parser field (== `warehouse_end_date` per the 2026-07-09 architect decision — shared.ts omits it on
  purpose). Wiring verified END-TO-END: shared.ts pass-through emits every field (+ `scac`→`scac_code`
  canonical key, `pol`/`pod`), queue `merge.ts` FIELD_CLASS lists them all (incl. pol/pod — the old
  "matcher doesn't emit pol/pod" forward-fix is closed), track `mapFieldsToLegColumns` maps every key
  (with a `scac` alias). **Leftover fixed 2026-07-10 (queue PR #58):** the souls' COMMON-MISTAKES bullet
  + LOGIMARK card still taught the PRE-SPLIT "air MAWB → `mbl`" (contradicting fields 14/24) — both
  souls corrected; `validate.ts` rule 2b added (MAWB-shape in `mbl` → moved to `mawb`, mbl join key
  scrubbed — the twin of the existing hbl rescue) + `mawb-slot.test.ts`. Suite 705 green | 2 broker-gated.
  NO corpus re-parse done (per instruction); a later `revalidate.ts` pass relocates historical values.
- [x] `[queue]` **SCAC extraction (rule 6) — shipped**: soul field 28 (`explicit SCAC > mbl leading 4
  letters > carrier name/issuer`, ⚠ NOT the container BIC prefix) + `validate.ts` step 10 membership
  check against `CARRIER_SCAC` (unknown SCAC → dropped + low flag). The carrier master is REAL data:
  `master-sync.ts` pulls `shiptrack/carriers` from Cobalt Mesh (4151 carriers in `master.generated.json`),
  overlaid by `dbo.master_entity` + ShipTrack resolution facts — no need for the queue to read track's
  `GET /masters/carriers` (same ur-source, richer set). **Added 2026-07-10 (PR #58):** the missing 4th
  tier — carrier-direct sender domain (`@maersk.com`→`MAEU`, never a forwarder/portal domain).
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
- [x] `[track]` **Ingest N+1 — COMPLETE 2026-07-11.** Per-item N+1s + write-side index + committer legs
  (INCREMENT 2) + lookupByMatchKey (INCREMENT 3) + evidence enrichment (INCREMENT 4). Killed the per-item
  N+1s: `lookupByMatchKey` + committer match loop (`poNumbersByBooking`, PR #29), `review.queue` (`findByIds`,
  PR #30), `presentation` alert summaries (PR #31), `posFor` (single query, PR #32), alert-evaluator
  milestones+emails+evidence (PR #33).
  **✅ INCREMENT 1 — write-side strong-key index SHIPPED 2026-07-11 (migration `0003_shipment_match_keys`).**
  The prerequisite below is done, but NOT via `shipment_identifiers` (the mapping note's first guess): that
  table is the wrong home — its source is the agent's `g.identifiers` display *history* (a DIFFERENT source
  than `findExistingLeg`'s `strongKeys(matchKeys)`), its `value` is RAW (matching is normalized), and it's
  agent-path-only. Instead a dedicated **`shipment_match_keys(shipment_id, type, value)`** table holds the
  NORMALIZED `strongKeys(matchKeys)` (the `gk` the committer already computes), indexed `(type,value)`,
  (re)written on EVERY path via `committer.writeMatchKeyIndex` (delete+insert, idempotent) + a frozen-inline
  backfill. Same source + same normalization as the matcher → the future `WHERE (type,value) IN gk` candidate
  query is a PROVABLE superset. Pure `matchKeyIndexRows` unit-tested; committer write side int-tested (create/
  amend/idempotent/strong-keys-only); 698 backend green, tsc clean. **At INCREMENT 1 ship: nothing read it yet
  (inert on behavior). Readers landed in INCREMENT 2 (committer) + INCREMENT 3 (matcher lookup).**
  **✅ INCREMENT 2 — read-side swap SHIPPED 2026-07-11.** `committer.apply` now asks `ShipmentRepository.candidateLegs`
  for an indexed SUPERSET — (legs sharing a strong key via `shipment_match_keys`, 0003) ∪ (legs whose booking shares
  a normalized PO via `purchase_orders.po_number_norm`, new **migration 0004**) — then runs the SAME pure
  `findExistingLeg` over it. The fully-zero-identity branch (no strong key AND no PO) keeps the `allLegs()` scan
  because the A2 `conversation_id` fallback isn't index-covered (rare orphan-thread case, trivially superset-safe).
  Superset proven by new int specs (`committer-candidate-query.int.spec.ts`, 9 tests) incl. the hyphenated-PO case;
  full committer.int + 707 backend green, tsc clean.
  **TWO discoveries during the swap:**
  - The 2026-07-10 note's "PO half is safely indexable via `purchase_orders.po_number`" was WRONG: `findExistingLeg`
    matches POs on `normKey` (strips hyphens/spaces), but `po_number` is stored RAW — a raw-column candidate query
    would MISS a leg whose PO was stored with different punctuation → duplicate shipment. Fixed by the normalized,
    indexed `po_number_norm` column (0004), written on every PO path (`upsertPo`/`createPo`/`updatePo` + the demo
    seed), backfilled — the same "same normalization → provable superset" pattern 0003 used for strong keys.
  - **Prod bug fixed:** migration `0003_shipment_match_keys` was never registered in the STATIC `migrate-cli.ts`
    registry (only the vitest folder-scan provider saw it), so `shipment_match_keys` would never be created on a
    prod/Docker/Fabric migrate → every commit's `writeMatchKeyIndex` would crash. Registered `0003` **and** `0004`.
  - **evidence.allWithMessage() scan** feeds `resolvePoEnrichment`/`unattributedBrandStyle`, which by
    proven test behavior enrich a PO from ANY email in the DB mentioning it (cross-thread, DB-wide-by-PO —
    `committer.int.spec` seeds thread-disconnected evidence linked only by PO string). Its broadcast guard
    ALSO needs per-email completeness (all POs of the relevant emails). So narrowing to the group's own
    messages is a BEHAVIOR CHANGE (breaks those specs); a `WHERE po_no IN g.pos` filter needs a new
    `parsed_record.po_no` index AND still risks the broadcast/no-PO paths. `forMessages()` can't be reused
    as-is (missing id/poNo/matchKeys → silently empty enrichment). Net: this half is a behavior decision,
    not a pure optimization. **UPDATE 2026-07-11: the legs candidate query is DONE (INCREMENT 2, above); the
    `evidence.allWithMessage()` scan remains as a separate behavior decision** (a `WHERE po_no IN g.pos` filter
    needs a new `parsed_record.po_no` index AND still risks the broadcast/no-PO cross-thread enrichment paths).
    Full map in the mapping-agent findings (2026-07-10 session).
  **✅ INCREMENT 3 — matcher lookupByMatchKey read-side swap SHIPPED 2026-07-11.** Same `candidateLegs`
  (strong-key index ∪ po_number_norm) as committer.apply; pure filter unchanged. Specs in
  `matcher-reads.int.spec.ts` (Increment 3 block): committer-written strong-key + hyphenated PO + "no index → invisible".
  **✅ INCREMENT 4 — evidence forCommitEnrichment SHIPPED 2026-07-11.** Migration `0005_parsed_record_po_norm`
  + ingest writes `po_no_norm` (= poKeyOf). Committer PO-enrichment uses `forCommitEnrichment(posNorm, strongPairs)`:
  (A) message-complete for emails that mention a target PO (cross-thread + broadcast siblings), (B) residual
  no-PO-key rows filtered by strongKeys overlap (unattributed brand/style). Pure resolvePoEnrichment /
  unattributedBrandStyle unchanged. `reconcile.run` still uses `allWithMessage()` (full rebuild). Specs:
  evidence.kysely.int (message-complete + unattributed + empty) + existing committer enrichment/de-correction (b).
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
- [~] `[queue]` **Soul/skill iteration is shadowed (audit 2026-07-09) — MOVE 2 DONE + MOVE 1 CORE PROVEN 2026-07-10.**
  Original problem: (1) `validate.ts` + `critic/merge.ts` re-made ~19 reading judgments the prompt states (frozen-code
  shadow); (2) the SOUL path is manual/unscheduled + teacher-dependent. Full map in the `cobalt-queue-soul-iteration-map`
  memory.
  - **✅ MOVE 2 (un-freeze the frozen backstops) SHIPPED — queue PR #63 (`validate.ts`) + #64 (`merge.ts`).**
    8 validate reading-judgment backstops deleted + the merge routing-label twin (soul now authoritative:
    forwarder platform/customs-broker, consignee echo/routing-label/factory/china-origin, port-country,
    customer_code-is-brand; 4 soul sentences added); brand + in_dc_date + the cross-buyer brand guard → keep-value+flag
    (never silent-null). **The 3 merge cross-record judgments (SO↔HBL de-echo, per-PO-qty broadcast, sameName folding)
    STAY — reclassified as spine** (soul is per-email, structurally can't make cross-record calls; they were never
    real un-freeze targets).
  - **✅ MOVE 1 core LIVE-PROVEN — queue PR #65 (`src/dev/probe-refiner.ts`).** The audit's #1 unknown ("does the warm
    openpave refiner GENERALIZE corrections into soul rules, or just memorize pairs?") is answered: fed 3 synthetic
    consignee corrections → path=OPENPAVE (not fallback), it wrote 2 durable rules, not 3 memorized pairs. The
    machinery works. **Remaining move-1 blockers are NOT code:** FUEL (`review_correction` fed by live human review,
    ~empty in dev) + warm-teacher is an OPS/deployment concern (auto-scheduling `batch:iterate` against a COLD teacher
    is harmful). So move 1 = keep openpave warm in prod + let real corrections accumulate.
  - **Still open:** (a) proactive review trigger for brand/in_dc (needs firing-frequency data); (b) MOVE 3 — collapse
    duplicated party facts (`PLATFORM_NOT_FORWARDER` ×3, SCAC map redundant w/ carrier master, validate party lists)
    → master-data (ties to "Code-only rule tables → data — queue half"); (c) full forwarder-platform un-freeze
    (coordinated queue+track+linker). Local DB gotcha for a full `batch:iterate` run: queue `.env` has a stale
    `DATABASE_URL=postgres://…` (no `SQL_SERVER_URL`) + local `cobalt_queue` is `dbo`-flattened while the iterator's
    runtime-DDL assumes a `queue.` schema — reconcile both before a DB-backed run.
- [x] `[queue]` **Matcher source-fixes — ALL THREE upstream cures SHIPPED 2026-07-10 (queue PR #62).**
  (1) task_9d91d677 CVP phantoms: validate rule 1d nulls the vendor-portal alpha PO (`<code>PO<digits><letter>`)
  out of `booking_no`+join key, souls forbid it, and the Decision now SENDS **`fromPlatform`** (ALL-of over
  senders — track's dto has been waiting for it: the dead `platform_only` review-policy trigger comes alive)
  + the queue gate refuses to auto-apply a portal-only group with no carrier identity. (2) task_d1d3e8d4
  qty broadcast: `poQty` collapses only when qty AND unit agree — 184-cartons-vs-184-pieces now drops+flags
  (the exceeds-ordered-total half stays track-side by design: needs the PO master). (3) BX836573 over-split:
  `reconcileIdentitySlots` pre-grouping pass retypes thread-disjoint tokens to the highest-DOC_RANK slot
  (LOGIMARK reused-ref triple untouched; dual-id records left alone). 19 new tests, suite 731|2, tsc clean.
  Track's symptom-guards stay as defense-in-depth until shadows go quiet. Historical detail: the
  `matcher-source-fixes` memory —
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
- [x] `[both]` **docker-compose 2nd-DB provisioning — SUPERSEDED 2026-07-10** (see § "Migration follow-ups"). Each repo's compose is self-contained and migrate services create their own DB if missing; prod = the one shared Fabric SQL DB (`dbo` + `queue` schemas), not compose.
- [x] `[track]` **Retire `seed-entity-facts.ts` + reconcile `SEH` — DONE 2026-07-08** (branch `feat/master-resolution-management`; folded into the master_resolution management feature below). SEH now bootstraps as `customer_group→PRIMARK` (fail-safe) and is editable in the UI.
- [x] `[track]` **`backfill-shipment-ports.sql` — DONE** (already names `ingest.parsed_record`, fixed in `039fc7a`; the only remaining `evidence.parsed_record` hits are frozen drizzle migration snapshots, correctly immutable).
- [x] `[queue]` minor test coverage: `graphAttachmentId` on the zip/msg-flag normalize paths — DONE
  2026-07-10 (queue PR #61). Writing the msg-flag case exposed a REAL bug: msgreader parses garbage
  .msg bytes leniently (no throw) → the original bytes were silently dropped; a nothing-yielded
  expansion now keeps rawBytes+downloadMime like msgFlag.

## master_resolution runtime management (shipped 2026-07-08, branch `feat/master-resolution-management`)
Curated resolution facts (alias/group/canonical/role incl. SEH) are now **ADMIN-managed at runtime** — Settings → **Resolution Rules** (create/edit/deactivate + curator proposals inbox) backed by an `active` flag on `tracking.master_resolution` (mig `0018`) + ADMIN CRUD API (`POST/PATCH /masters/resolution*`; consumer `GET /masters/resolution` now filters `active=true`, so cobalt-queue honours deactivation with no change). **Seed is non-destructive**: `master_resolution`/`app_settings`/`alert_rules`/`users` are no longer truncated (seeded `onConflictDoNothing`) so runtime edits survive a reseed. Spec/plan: `docs/superpowers/{specs,plans}/2026-07-08-master-resolution-management*`. e2e-proven (auth→create→active-serve→deactivate→consumer-hides→unauth-401). Follow-ups:
- [x] `[track]` **Test-infra — DONE 2026-07-09.** `setup-db.ts` now keeps a `_test_migrations` ledger and
  applies only un-recorded migrations, so a NEWLY-ADDED migration auto-applies on the next run — no manual
  `DROP DATABASE cobalt_test`. A pre-ledger DB is recreated once (guarded to a DB literally named `cobalt_test`;
  race-free under `fileParallelism:false`). Verified green on both the transition run and the steady-state run.
- [x] `[track]` **Code-only rule tables → data — track half DONE 2026-07-10 (PR #68).** The four hardcoded
  port tiers are now `master_resolution` facts (`port_abbreviation`/`port_alias`/`port_iata`/`port_fragment`,
  migration 0002, seeded from the former tables, ADMIN-managed live in Settings → Resolution Rules), and a
  new **`carriers` master** (scac UNIQUE + name, 14 seeded, `GET /masters/carriers` + ADMIN CRUD) gives SCAC
  its data home — this unlocks rule 6 (SCAC extraction) below. The Resolution Rules create-form now hides
  the 4 retired alias kinds and offers prior_correction + the port kinds.
- [ ] `[queue]` **Code-only rule tables → data — queue half remains** (belongs with the soul-iteration
  session): the soul's embedded port map + FORWARDER CARDS + carrier-prefix rules in
  `prompts/cobalt-parser.md`, and `validate.ts` party lists (`PLATFORM_NOT_FORWARDER`/`SELF`/
  `GENUINE_SHORT_BRANDS`/…). Externalizing these means assembling soul sections from data at parse time —
  design it together with the Iterator mechanics (see the soul-iteration map memory). The queue can now
  also read `GET /masters/carriers` for its `CARRIER_SCAC` membership check when rule 6 lands.
- [x] `[track]` **Alert-rules write guard — SUPERSEDED by Config-Page Access Control (PR #17, 2026-07-09).** PUT `/alert-rules`
  is now `@PageWrite('alert_rules')` (GET `@PageRead('alert_rules')`); editability is superadmin-configurable via the access
  matrix instead of a static `@Roles('ADMIN')`. Frontend gates on `usePageAccess().canEdit('alert_rules')`.
